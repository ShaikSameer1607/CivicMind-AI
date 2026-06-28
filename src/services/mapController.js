/**
 * Dashboard map — clustering, filters, heatmap, hotspot overlays.
 * Uses Leaflet + MarkerCluster + heat plugins loaded from CDN.
 */

const DEFAULT_CENTER = [12.9716, 77.5946];

export const MAP_FILTERS_DEFAULT = {
  categories: ['Infrastructure', 'Safety', 'Environment'],
  severities: ['low', 'medium', 'high', 'critical'],
  departments: ['Public Works', 'Safety & Traffic', 'Environment', 'General'],
  showHeatmap: true,
  showHotspots: true,
  showClustering: true,
};

function severityColor(severity, status) {
  if (status === 'Resolved') return '#10B981';
  if (severity === 'critical') return '#F43F5E';
  if (severity === 'high') return '#F59E0B';
  if (severity === 'medium') return '#6366F1';
  return '#38BDF8';
}

export function filterMapIssues(issues, filters = MAP_FILTERS_DEFAULT) {
  return issues.filter(i => {
    if (!Number.isFinite(i.latitude) || !Number.isFinite(i.longitude)) return false;
    if (filters.categories?.length && !filters.categories.includes(i.category)) return false;
    if (filters.severities?.length && !filters.severities.includes(i.severity)) return false;
    if (filters.departments?.length && !filters.departments.includes(i.department || 'General')) return false;
    return true;
  });
}

export function buildHeatmapPoints(issues) {
  return filterMapIssues(issues).map(i => [i.latitude, i.longitude, i.severity === 'critical' ? 1 : i.severity === 'high' ? 0.7 : 0.4]);
}

export function extractHotspotOverlays(issues) {
  const hotspots = [];
  issues.forEach(i => {
    const geo = i.agentAnalysis?.geo;
    if (!Number.isFinite(i.latitude) || !Number.isFinite(i.longitude)) return;
    const level = geo?.hotspotLevel || geo?.hotspot;
    if (!level || level === 'Low Activity Zone' || level === 'N/A') return;
    const radius = level.includes('Critical') ? 400 : level.includes('Elevated') ? 280 : 180;
    hotspots.push({
      lat: i.latitude,
      lng: i.longitude,
      radius,
      level,
      issueId: i.issueId,
      riskZone: geo?.riskZone,
    });
  });
  return hotspots;
}

function buildPopupHtml(issue, escapeHtml) {
  const media = getIssueMediaUrls(issue);
  const thumbs = media.images.slice(0, 3).map(url =>
    `<img src="${escapeHtml(url)}" alt="evidence" style="width:48px;height:48px;object-fit:cover;border-radius:6px;margin:2px" />`
  ).join('');

  const reporter = issue.reporterName
    ? `${escapeHtml(issue.reporterName)} (${escapeHtml(issue.reporterEmail || '')})`
    : escapeHtml(issue.createdBy || 'Unknown');
  const lat = issue.latitude !== null ? issue.latitude.toFixed(6) : 'N/A';
  const lng = issue.longitude !== null ? issue.longitude.toFixed(6) : 'N/A';
  
  let createdTime = 'N/A';
  if (issue.createdAt) {
    if (issue.createdAt.toDate) {
      createdTime = issue.createdAt.toDate().toLocaleString();
    } else if (issue.createdAt.seconds) {
      createdTime = new Date(issue.createdAt.seconds * 1000).toLocaleString();
    } else {
      createdTime = new Date(issue.createdAt).toLocaleString();
    }
  }

  const aiSummary = issue.agentAnalysis?.vision?.summary || 'Pending AI pipeline...';
  const prediction = issue.agentAnalysis?.prediction?.prediction || issue.agentAnalysis?.prediction?.recommendation || 'Pending AI pipeline...';
  const resolutionRec = issue.agentAnalysis?.resolution?.recommendation || 'Pending AI pipeline...';
  const trustScore = issue.trustScore !== undefined ? issue.trustScore.toFixed(1) : '5.0';

  return `
    <div style="min-width:260px; max-width:320px; font-family:var(--font-sans, system-ui); color:var(--text-main, #fff); font-size:12px; line-height:1.4; padding:2px">
      <div style="font-size:10px; color:#888; font-weight:600; text-transform:uppercase; margin-bottom:2px">Issue ID: ${escapeHtml(issue.issueId)}</div>
      <div style="font-size:13px; font-weight:700; margin-bottom:6px; color:#a5b4fc">${escapeHtml(issue.title)}</div>
      
      <div style="font-size:11px; margin-bottom:8px; max-height:48px; overflow-y:auto; color:#d1d5db; padding:2px 0">${escapeHtml(issue.description)}</div>
      
      <div style="display:grid; grid-template-columns:1fr; gap:3px; margin-bottom:8px; background:rgba(255,255,255,0.05); padding:6px; border-radius:6px">
        <div><b>Category:</b> ${escapeHtml(issue.category)}</div>
        <div><b>Severity:</b> <span style="text-transform:capitalize; font-weight:600; color:${severityColor(issue.severity, issue.status)}">${escapeHtml(issue.severity)}</span></div>
        <div><b>Department:</b> ${escapeHtml(issue.department || 'Unassigned')}</div>
        <div><b>Status:</b> <span style="font-weight:600; color:#cbd5e1">${escapeHtml(issue.status || 'Open')}</span></div>
      </div>

      <div style="font-size:10.5px; border-top:1px solid rgba(255,255,255,0.1); padding-top:6px; margin-bottom:8px; color:#9ca3af; display:flex; flex-direction:column; gap:2px">
        <div><b>Reporter:</b> ${reporter}</div>
        <div><b>Coords:</b> ${lat}, ${lng}</div>
        <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis" title="${escapeHtml(issue.formattedAddress || '')}"><b>Address:</b> ${escapeHtml(issue.formattedAddress || issue.locationAddress || 'N/A')}</div>
        <div><b>Reported At:</b> ${createdTime}</div>
        <div><b>Trust Score:</b> ⭐ ${trustScore}/10.0</div>
      </div>

      <div style="border-top:1px solid rgba(255,255,255,0.1); padding-top:6px; display:flex; flex-direction:column; gap:4px">
        <div><b>AI Summary:</b> <span style="color:#d1d5db">${escapeHtml(aiSummary)}</span></div>
        <div><b>AI Prediction:</b> <span style="color:#d1d5db">${escapeHtml(prediction)}</span></div>
        <div><b>Resolution Rec:</b> <span style="color:#d1d5db">${escapeHtml(resolutionRec)}</span></div>
      </div>
      
      ${thumbs ? `<div style="display:flex; margin-top:8px; gap:4px; border-top:1px solid rgba(255,255,255,0.1); padding-top:6px">${thumbs}</div>` : ''}
    </div>`;
}

export function getIssueMediaUrls(issue) {
  const images = [...(issue.imageUrls || [])];
  if (issue.imageUrl && !images.includes(issue.imageUrl)) images.unshift(issue.imageUrl);
  return {
    images,
    videos: issue.videoUrls || [],
    audio: issue.audioUrls || [],
  };
}

export function renderMediaGallery(issue, escapeHtml) {
  const { images, videos, audio } = getIssueMediaUrls(issue);
  if (!images.length && !videos.length && !audio.length) return '';
  return `
    <div class="media-gallery">
      ${images.map(url => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" class="media-thumb" alt="Evidence" /></a>`).join('')}
      ${videos.map(url => `<video src="${escapeHtml(url)}" class="media-thumb media-video" controls></video>`).join('')}
      ${audio.map(url => `<audio src="${escapeHtml(url)}" class="media-audio" controls></audio>`).join('')}
    </div>`;
}

let mapInstance = null;
let mapLayers = { markers: null, heat: null, hotspots: [] };

export function destroyDashboardMap() {
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
    mapLayers = { markers: null, heat: null, hotspots: [] };
  }
  if (window._userLocationMarker) {
    window._userLocationMarker = null;
  }
}

/**
 * Initialize or refresh the dashboard map.
 * @param {HTMLElement} containerEl
 * @param {Array} issues
 * @param {Object} filters
 * @param {Function} escapeHtml
 */
export function refreshDashboardMap(containerEl, issues, filters, escapeHtml) {
  if (!containerEl || !window.L) return;

  // If the container has zero dimensions (not yet laid out by browser), defer entirely
  // to avoid leaflet-heat's canvas _reset crash (IndexSizeError: source width is 0)
  if (containerEl.clientWidth === 0 || containerEl.clientHeight === 0) {
    console.warn('[CivicMind] Map container not ready — deferring initialization');
    setTimeout(() => {
      const el = document.getElementById('dashboard-map');
      if (el && el.clientWidth > 0) {
        refreshDashboardMap(el, issues, filters, escapeHtml);
      }
    }, 200);
    return;
  }

  try {
    return _refreshDashboardMapInner(containerEl, issues, filters, escapeHtml);
  } catch (err) {
    console.error('[CivicMind] Map error:', err);
  }
}


function _refreshDashboardMapInner(containerEl, issues, filters, escapeHtml) {
  // If a map instance exists but belongs to a different container, destroy it
  if (mapInstance && mapInstance.getContainer() !== containerEl) {
    destroyDashboardMap();
  }

  const mapped = filterMapIssues(issues, filters);

  // Calculate average location
  let center = DEFAULT_CENTER;
  if (mapped.length > 0) {
    let sumLat = 0, sumLng = 0;
    mapped.forEach(i => {
      sumLat += i.latitude;
      sumLng += i.longitude;
    });
    center = [sumLat / mapped.length, sumLng / mapped.length];
  }

  // Clear existing layers on reused instance
  if (mapInstance) {
    if (mapLayers.markers) {
      mapLayers.markers.clearLayers();
      mapInstance.removeLayer(mapLayers.markers);
      mapLayers.markers = null;
    }
    if (mapLayers.heat) {
      mapInstance.removeLayer(mapLayers.heat);
      mapLayers.heat = null;
    }
    if (mapLayers.hotspots.length) {
      mapLayers.hotspots.forEach(h => mapInstance.removeLayer(h));
      mapLayers.hotspots = [];
    }
  } else {
    // Create new map instance
    if (containerEl._leaflet_id) {
      containerEl._leaflet_id = undefined;
    }
    mapInstance = window.L.map(containerEl, { zoomControl: false, attributionControl: false });
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapInstance);
  }


  // Set map view
  if (mapped.length === 1) {
    mapInstance.setView(center, 12);
  } else if (mapped.length === 0) {
    mapInstance.setView(center, 11);
  }

  const bounds = [];

  // Heatmap layer
  if (filters.showHeatmap && window.L.heatLayer) {
    const heatPoints = buildHeatmapPoints(issues);
    if (heatPoints.length) {
      try {
        mapLayers.heat = window.L.heatLayer(heatPoints, { radius: 28, blur: 22, maxZoom: 17 }).addTo(mapInstance);
      } catch (heatErr) {
        // Silently skip heatmap if canvas isn't ready — will be added on next refresh
        console.warn('[CivicMind] Heatmap deferred:', heatErr.message);
      }
    }
  }

  // Hotspots layer
  if (filters.showHotspots) {
    extractHotspotOverlays(issues).forEach(h => {
      const circle = window.L.circle([h.lat, h.lng], {
        radius: h.radius,
        color: '#F43F5E',
        fillColor: '#F43F5E',
        fillOpacity: 0.12,
        weight: 1,
      }).addTo(mapInstance);
      circle.bindPopup(`<b>${escapeHtml(h.level)}</b><br/>${escapeHtml(h.riskZone || '')}<br/><span style="font-size:10px">${escapeHtml(h.issueId)}</span>`);
      mapLayers.hotspots.push(circle);
    });
  }

  // Markers & clustering
  if (filters.showClustering && window.L.markerClusterGroup) {
    mapLayers.markers = window.L.markerClusterGroup({ maxClusterRadius: 50 });
  } else {
    mapLayers.markers = window.L.layerGroup();
  }

  mapped.forEach(m => {
    const color = severityColor(m.severity, m.status);
    const icon = window.L.divIcon({
      className: '',
      html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,0.3);box-shadow:0 0 12px ${color}80"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    const marker = window.L.marker([m.latitude, m.longitude], { icon });
    marker.bindPopup(buildPopupHtml(m, escapeHtml));
    mapLayers.markers.addLayer(marker);
    bounds.push([m.latitude, m.longitude]);
  });

  mapInstance.addLayer(mapLayers.markers);

  // Center/Fit bounds
  if (bounds.length > 1) {
    mapInstance.fitBounds(bounds, { padding: [30, 30] });
  }

  // User location marker
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(position => {
      const { latitude, longitude } = position.coords;
      if (mapInstance && Number.isFinite(latitude) && Number.isFinite(longitude)) {
        const userIcon = window.L.divIcon({
          className: '',
          html: `<div style="width:16px;height:16px;border-radius:50%;background:#3B82F6;border:3px solid white;box-shadow:0 0 8px #3B82F6;position:relative"><div style="position:absolute;width:100%;height:100%;border-radius:50%;background:#3B82F6;opacity:0.4;animation:pulsate 1.8s infinite ease-out;transform-origin:center;box-sizing:border-box;left:0;top:0"></div></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        });
        
        if (window._userLocationMarker) {
          window._userLocationMarker.setLatLng([latitude, longitude]);
        } else {
          window._userLocationMarker = window.L.marker([latitude, longitude], { icon: userIcon })
            .addTo(mapInstance)
            .bindPopup('Your Current Location');
        }
      }
    }, () => {}, { timeout: 5000 });
  }

  window._dashboardMap = mapInstance;
  return mapInstance;
}

export function mapZoomIn() {
  window._dashboardMap?.zoomIn();
}

export function mapZoomOut() {
  window._dashboardMap?.zoomOut();
}

let reportMapInstance = null;
let reportMarker = null;

export function destroyReportMap() {
  if (reportMapInstance) {
    reportMapInstance.remove();
    reportMapInstance = null;
    reportMarker = null;
  }
}

export function initReportMap(containerEl, lat, lng, isManual = false, onMapClick = null) {
  if (!containerEl || !window.L) return null;
  
  if (reportMapInstance) {
    reportMapInstance.remove();
    reportMapInstance = null;
    reportMarker = null;
  }

  const startLat = lat || DEFAULT_CENTER[0];
  const startLng = lng || DEFAULT_CENTER[1];

  reportMapInstance = window.L.map(containerEl, { zoomControl: true, attributionControl: false })
    .setView([startLat, startLng], 14);

  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(reportMapInstance);

  if (lat && lng) {
    reportMarker = window.L.marker([lat, lng]).addTo(reportMapInstance);
  }

  if (onMapClick) {
    reportMapInstance.on('click', async (e) => {
      const { lat, lng } = e.latlng;
      if (reportMarker) {
        reportMarker.setLatLng([lat, lng]);
      } else {
        reportMarker = window.L.marker([lat, lng]).addTo(reportMapInstance);
      }
      onMapClick(lat, lng);
    });
  }

  return reportMapInstance;
}

