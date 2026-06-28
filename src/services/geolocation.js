/**
 * Geolocation Service — Browser GPS + Reverse Geocoding
 * Captures full device location data and converts to address.
 * Gracefully handles all error cases without crashing.
 */

// ─── Default empty location object ───────────────────────────
export const EMPTY_LOCATION = {
  latitude: null,
  longitude: null,
  locationAccuracy: null,
  altitude: null,
  heading: null,
  speed: null,
  locationCapturedAt: null,
  locationAddress: null,
  formattedAddress: null,
  city: null,
  state: null,
  country: null,
  postalCode: null,
  coordinates: { latitude: null, longitude: null },
};

// ─── Error messages ──────────────────────────────────────────
const GEO_ERRORS = {
  PERMISSION_DENIED: 'Location access denied. You can still submit without location.',
  POSITION_UNAVAILABLE: 'Location unavailable. Please enter address manually.',
  TIMEOUT: 'Location request timed out. Continuing without GPS.',
  NOT_SUPPORTED: 'Your browser does not support geolocation.',
  OFFLINE: 'You appear to be offline. Location saved without address.',
};

/**
 * Request the browser's current GPS position.
 * Returns a full location object with all available fields.
 * Never throws — returns EMPTY_LOCATION on failure.
 *
 * @param {Object} [options]
 * @param {boolean} [options.enableHighAccuracy=true]
 * @param {number} [options.timeout=15000]
 * @param {number} [options.maximumAge=60000]
 * @returns {Promise<{location: Object, error: string|null}>}
 */
export async function captureDeviceLocation(options = {}) {
  // Check browser support
  if (!navigator.geolocation) {
    return { location: { ...EMPTY_LOCATION }, error: GEO_ERRORS.NOT_SUPPORTED };
  }

  const geoOptions = {
    enableHighAccuracy: options.enableHighAccuracy ?? true,
    timeout: options.timeout ?? 15000,
    maximumAge: options.maximumAge ?? 60000,
  };

  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, geoOptions);
    });

    const { coords, timestamp } = position;

    const location = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      locationAccuracy: coords.accuracy ?? null,
      altitude: coords.altitude ?? null,
      heading: coords.heading ?? null,
      speed: coords.speed ?? null,
      locationCapturedAt: new Date(timestamp).toISOString(),
      locationAddress: null,
      formattedAddress: null,
      city: null,
      state: null,
      country: null,
      postalCode: null,
      coordinates: {
        latitude: coords.latitude,
        longitude: coords.longitude,
      },
    };

    return { location, error: null };
  } catch (err) {
    let errorMessage;
    switch (err?.code) {
      case 1: // PERMISSION_DENIED
        errorMessage = GEO_ERRORS.PERMISSION_DENIED;
        break;
      case 2: // POSITION_UNAVAILABLE
        errorMessage = GEO_ERRORS.POSITION_UNAVAILABLE;
        break;
      case 3: // TIMEOUT
        errorMessage = GEO_ERRORS.TIMEOUT;
        break;
      default:
        errorMessage = err?.message || 'Unknown geolocation error.';
    }
    return { location: { ...EMPTY_LOCATION }, error: errorMessage };
  }
}

/**
 * Reverse geocode lat/lng into a structured address.
 * Uses the free Nominatim (OpenStreetMap) API.
 * Never throws — returns partial data on failure.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Promise<{address: Object, error: string|null}>}
 */
export async function reverseGeocode(latitude, longitude) {
  const emptyAddress = {
    locationAddress: null,
    formattedAddress: null,
    city: null,
    state: null,
    country: null,
    postalCode: null,
  };

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { address: emptyAddress, error: 'Invalid coordinates' };
  }

  // Check online status
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { address: emptyAddress, error: GEO_ERRORS.OFFLINE };
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1&accept-language=en`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'CivicMindAI/1.0' },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return { address: emptyAddress, error: `Geocoding returned ${response.status}` };
    }

    const data = await response.json();
    const addr = data.address || {};

    const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || null;
    const state = addr.state || addr.region || null;
    const country = addr.country || null;
    const postalCode = addr.postcode || null;

    // Build a concise location address (road + locality)
    const roadParts = [addr.road, addr.neighbourhood, addr.suburb].filter(Boolean);
    const locationAddress = roadParts.length > 0
      ? roadParts.join(', ')
      : data.display_name?.split(',').slice(0, 2).join(',').trim() || null;

    const formattedAddress = data.display_name || null;

    return {
      address: {
        locationAddress,
        formattedAddress,
        city,
        state,
        country,
        postalCode,
      },
      error: null,
    };
  } catch (err) {
    const errorMsg = err?.name === 'AbortError'
      ? 'Geocoding request timed out'
      : `Geocoding failed: ${err?.message || 'Unknown error'}`;
    return { address: emptyAddress, error: errorMsg };
  }
}

/**
 * Full location capture: GPS + reverse geocoding.
 * Single call to get everything needed for Firestore.
 * Never throws — always returns a usable location object.
 *
 * @param {Object} [options] - GPS options
 * @returns {Promise<{location: Object, geoError: string|null, geocodeError: string|null}>}
 */
export async function captureFullLocation(options = {}) {
  const { location, error: geoError } = await captureDeviceLocation(options);

  // If GPS failed, return empty location
  if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
    return { location, geoError, geocodeError: null };
  }

  // Attempt reverse geocoding
  const { address, error: geocodeError } = await reverseGeocode(location.latitude, location.longitude);

  // Merge address into location
  const fullLocation = {
    ...location,
    ...address,
  };

  return { location: fullLocation, geoError, geocodeError };
}
