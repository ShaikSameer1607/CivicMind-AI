/** Canonical agent names — used for logging and pipeline ordering */
export const AGENT_NAMES = {
  VISION: 'Vision Inspector',
  GEO: 'Geo Intelligence',
  DUPLICATE: 'Duplicate Detection',
  VERIFICATION: 'Community Verification',
  PREDICTION: 'Predictive Infrastructure',
  RESOLUTION: 'Resolution Recommendation',
  NOTIFICATION: 'Notification',
};

/** Sequential pipeline order for every new issue */
export const PIPELINE_ORDER = [
  AGENT_NAMES.VISION,
  AGENT_NAMES.GEO,
  AGENT_NAMES.DUPLICATE,
  AGENT_NAMES.VERIFICATION,
  AGENT_NAMES.PREDICTION,
  AGENT_NAMES.RESOLUTION,
  AGENT_NAMES.NOTIFICATION,
];

export const AGENT_STATUS = {
  PROCESSING: 'processing',
  COMPLETE: 'complete',
  ACTIVE: 'active',
  FAILED: 'failed',
  IDLE: 'idle',
};

/** Default radius (km) for geo / duplicate proximity checks */
export const PROXIMITY_RADIUS_KM = 0.5;

/** Duplicate detection time window (days) */
export const DUPLICATE_WINDOW_DAYS = 14;
