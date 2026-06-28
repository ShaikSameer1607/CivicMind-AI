import { AGENT_NAMES, AGENT_STATUS, PROXIMITY_RADIUS_KM } from './constants.js';

import { haversineKm, inferWard, inferHotspot, inferRiskZone, clamp } from './utils.js';

import { generateJSON, isGeminiAvailable, finalizeAgentResult } from './aiProvider.js';



function buildNearbySummary(issue, allIssues) {

  const { latitude, longitude } = issue;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { nearby: [], ward: 'Unknown Ward' };



  const nearby = allIssues.filter(other => {

    if (other.issueId === issue.issueId) return false;

    if (!Number.isFinite(other.latitude) || !Number.isFinite(other.longitude)) return false;

    return haversineKm(latitude, longitude, other.latitude, other.longitude) <= PROXIMITY_RADIUS_KM;

  });



  return { nearby, ward: inferWard(latitude, longitude) };

}



async function runHeuristic(context) {

  const start = performance.now();

  const { issue, allIssues } = context;

  const { latitude, longitude } = issue;



  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {

    return finalizeAgentResult({

      issueId: issue.issueId,

      agentName: AGENT_NAMES.GEO,

      status: AGENT_STATUS.IDLE,

      confidence: 0,

      executionTime: 0,

      output: 'No coordinates available for geo analysis.',

      data: {

        riskZone: 'Unknown',

        hotspotLevel: 'N/A',

        nearbyIssueSummary: 'Geolocation not captured',

        infrastructureObservation: 'Cannot assess without coordinates',

        recommendations: ['Enable GPS on report submission'],

        locationInsights: 'Geolocation not captured',

        nearbyDuplicateCount: 0,

        ward: 'Unknown Ward',

        hotspot: 'N/A',

      },

    }, { source: 'heuristic', latencyMs: Math.round(performance.now() - start) }, start);

  }



  const { nearby, ward } = buildNearbySummary(issue, allIssues);

  const hotspot = inferHotspot(nearby.length);

  const visionSeverity = context.agentResults?.[AGENT_NAMES.VISION]?.data?.severity || issue.severity;

  const riskZone = inferRiskZone(visionSeverity, nearby.length);

  const confidence = clamp(60 + nearby.length * 6 + (nearby.length > 0 ? 10 : 0), 55, 98);



  const nearbyIssueSummary = nearby.length

    ? `${nearby.length} issue(s) within ${PROXIMITY_RADIUS_KM}km in ${ward}.`

    : `No nearby issues within ${PROXIMITY_RADIUS_KM}km.`;



  const locationInsights = `${nearbyIssueSummary} Hotspot: ${hotspot}. Zone: ${riskZone}.`;



  return finalizeAgentResult({

    issueId: issue.issueId,

    agentName: AGENT_NAMES.GEO,

    status: AGENT_STATUS.COMPLETE,

    confidence,

    executionTime: 0,

    output: locationInsights,

    data: {

      riskZone,

      hotspotLevel: hotspot,

      nearbyIssueSummary,

      infrastructureObservation: nearby.length >= 3 ? 'Cluster suggests recurring infrastructure stress' : 'Isolated or low-density reporting',

      recommendations: nearby.length >= 3 ? ['Schedule ward inspection', 'Cross-reference duplicate reports'] : ['Continue monitoring'],

      locationInsights,

      nearbyDuplicateCount: nearby.length,

      ward,

      hotspot,

      latitude,

      longitude,

      nearbyIssueIds: nearby.slice(0, 5).map(i => i.issueId),

    },

  }, { source: 'heuristic', latencyMs: Math.round(performance.now() - start) }, start);

}



async function runWithGemini(context) {

  const start = performance.now();

  const { issue, allIssues } = context;

  const { nearby, ward } = buildNearbySummary(issue, allIssues);

  const density = allIssues.filter(i => Number.isFinite(i.latitude)).length;



  const nearbyPayload = nearby.slice(0, 12).map(i => ({

    issueId: i.issueId,

    category: i.category,

    severity: i.severity,

    status: i.status,

    title: i.title,

  }));



  const { data, aiMetrics } = await generateJSON({

    agentName: AGENT_NAMES.GEO,

    requiredKeys: ['riskZone', 'hotspotLevel', 'nearbyIssueSummary', 'infrastructureObservation', 'recommendations'],

    prompt: `Analyze geo intelligence for a civic issue.



Coordinates: ${issue.latitude}, ${issue.longitude}

Ward estimate: ${ward}

Nearby issues within ${PROXIMITY_RADIUS_KM}km (${nearby.length}): ${JSON.stringify(nearbyPayload)}

Historical geolocated issue density in system: ${density}

Current issue category: ${issue.category}

Vision severity: ${context.agentResults?.[AGENT_NAMES.VISION]?.data?.severity || issue.severity}



Return JSON:

- riskZone (string, e.g. High Risk / Moderate Risk / Standard Risk)

- hotspotLevel (string)

- nearbyIssueSummary (string)

- infrastructureObservation (string)

- recommendations (array of strings)`,

  });



  const output = data.nearbyIssueSummary || data.infrastructureObservation;

  return finalizeAgentResult({

    issueId: issue.issueId,

    agentName: AGENT_NAMES.GEO,

    status: AGENT_STATUS.COMPLETE,

    confidence: clamp(65 + nearby.length * 5, 55, 98),

    executionTime: 0,

    output: String(output),

    data: {

      riskZone: data.riskZone,

      hotspotLevel: data.hotspotLevel,

      nearbyIssueSummary: data.nearbyIssueSummary,

      infrastructureObservation: data.infrastructureObservation,

      recommendations: Array.isArray(data.recommendations) ? data.recommendations : [String(data.recommendations)],

      locationInsights: String(output),

      nearbyDuplicateCount: nearby.length,

      ward,

      hotspot: data.hotspotLevel,

      latitude: issue.latitude,

      longitude: issue.longitude,

      nearbyIssueIds: nearby.slice(0, 5).map(i => i.issueId),

    },

  }, aiMetrics, start);

}



export async function run(context) {

  if (isGeminiAvailable()) {

    try {

      return await runWithGemini(context);

    } catch (err) {

      console.warn('[Geo Intelligence] Gemini fallback:', err.message);

    }

  }

  return runHeuristic(context);

}



export { runHeuristic };


