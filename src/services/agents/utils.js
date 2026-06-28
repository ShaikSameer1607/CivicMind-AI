import { db, collection, getDocs } from '../firebase.js';

/** @returns {number} distance in kilometres */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function inferWard(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'Unknown Ward';
  const wardNum = (Math.abs(Math.floor(lat * 100) + Math.floor(lng * 100)) % 12) + 1;
  return `Ward ${wardNum}`;
}

export function inferHotspot(nearbyCount) {
  if (nearbyCount >= 5) return 'Critical Hotspot';
  if (nearbyCount >= 3) return 'Elevated Hotspot';
  if (nearbyCount >= 1) return 'Emerging Hotspot';
  return 'Low Activity Zone';
}

export function inferRiskZone(severity, nearbyCount) {
  if (severity === 'critical' || nearbyCount >= 5) return 'High Risk';
  if (severity === 'high' || nearbyCount >= 2) return 'Moderate Risk';
  return 'Standard Risk';
}

export function textSimilarity(a = '', b = '') {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  if (!wordsA.size || !wordsB.size) return 0;
  let overlap = 0;
  wordsA.forEach(w => { if (wordsB.has(w)) overlap += 1; });
  return overlap / Math.max(wordsA.size, wordsB.size);
}

export function toIssueDate(timestamp) {
  if (!timestamp) return null;
  if (timestamp.toDate) return timestamp.toDate();
  if (timestamp.seconds) return new Date(timestamp.seconds * 1000);
  return new Date(timestamp);
}

export function daysBetween(dateA, dateB) {
  return Math.abs(dateB - dateA) / 86400000;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function severityRank(severity) {
  const ranks = { low: 1, medium: 2, high: 3, critical: 4 };
  return ranks[severity] ?? 2;
}

export function inferSeverityFromText(description = '', category = '', fallback = 'medium') {
  const text = `${description} ${category}`.toLowerCase();
  if (/\b(critical|emergency|collapse|fire|gas leak|injury)\b/.test(text)) return 'critical';
  if (/\b(danger|hazard|blocked|flooding|accident|broken)\b/.test(text)) return 'high';
  if (/\b(minor|cosmetic|small|slight)\b/.test(text)) return 'low';
  return fallback;
}

export async function fetchAllIssues() {
  const snapshot = await getDocs(collection(db, 'issues'));
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function computeCategoryCounts(issues) {
  const counts = {};
  issues.forEach(i => {
    const cat = i.category || 'General';
    counts[cat] = (counts[cat] || 0) + 1;
  });
  return counts;
}

export function summarizeOutput(data) {
  try {
    return JSON.stringify(data, null, 0).slice(0, 500);
  } catch {
    return String(data);
  }
}
