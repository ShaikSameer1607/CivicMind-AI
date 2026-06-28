import { AGENT_NAMES, AGENT_STATUS, PROXIMITY_RADIUS_KM, DUPLICATE_WINDOW_DAYS } from './constants.js';

import { haversineKm, textSimilarity, toIssueDate, daysBetween, clamp } from './utils.js';

import { generateJSON, isGeminiAvailable, finalizeAgentResult } from './aiProvider.js';



function scoreCandidates(issue, allIssues) {

  const now = new Date();

  const candidates = allIssues.filter(other => {

    if (other.issueId === issue.issueId) return false;

    if (other.category !== issue.category) return false;



    const created = toIssueDate(other.createdAt);

    if (created && daysBetween(created, now) > DUPLICATE_WINDOW_DAYS) return false;



    if (

      Number.isFinite(issue.latitude) &&

      Number.isFinite(issue.longitude) &&

      Number.isFinite(other.latitude) &&

      Number.isFinite(other.longitude)

    ) {

      return haversineKm(issue.latitude, issue.longitude, other.latitude, other.longitude) <= PROXIMITY_RADIUS_KM * 2;

    }



    return textSimilarity(issue.description, other.description) >= 0.35;

  });



  return candidates.map(other => {

    const textScore = textSimilarity(issue.description, other.description);

    let locScore = 0;

    if (Number.isFinite(issue.latitude) && Number.isFinite(other.latitude)) {

      const dist = haversineKm(issue.latitude, issue.longitude, other.latitude, other.longitude);

      locScore = clamp(1 - dist / (PROXIMITY_RADIUS_KM * 2), 0, 1);

    }

    const created = toIssueDate(other.createdAt);

    const recencyScore = created ? clamp(1 - daysBetween(created, now) / DUPLICATE_WINDOW_DAYS, 0, 1) : 0;

    const duplicateScore = Math.round((textScore * 0.4 + locScore * 0.4 + recencyScore * 0.2) * 100);

    return { ...other, duplicateScore, textScore, locScore, recencyScore };

  }).sort((a, b) => b.duplicateScore - a.duplicateScore);

}



async function runHeuristic(context) {

  const start = performance.now();

  const { issue } = context;

  const scored = scoreCandidates(issue, context.allIssues);

  const topMatch = scored[0];

  const duplicateScore = topMatch?.duplicateScore ?? 0;

  const confidence = clamp(duplicateScore > 0 ? duplicateScore : 40, 35, 99);



  const references = scored.slice(0, 5).map(i => ({

    issueId: i.issueId,

    title: i.title,

    duplicateScore: i.duplicateScore,

    status: i.status,

  }));



  const explanation = duplicateScore >= 60

    ? `Potential duplicate (${duplicateScore}% match) — similar to ${topMatch.issueId}.`

    : duplicateScore >= 30

      ? `Possible related report (${duplicateScore}% similarity).`

      : 'No significant duplicates detected.';



  return finalizeAgentResult({

    issueId: issue.issueId,

    agentName: AGENT_NAMES.DUPLICATE,

    status: AGENT_STATUS.COMPLETE,

    confidence,

    executionTime: 0,

    output: explanation,

    data: {

      duplicateScore,

      confidence,

      explanation,

      matchingIssueIds: references.map(r => r.issueId),

      existingIssueReferences: references,

      isLikelyDuplicate: duplicateScore >= 60,

    },

  }, { source: 'heuristic', latencyMs: Math.round(performance.now() - start) }, start);

}



async function runWithGemini(context) {

  const start = performance.now();

  const { issue } = context;

  const scored = scoreCandidates(issue, context.allIssues).slice(0, 8);



  const candidatePayload = scored.map(c => ({

    issueId: c.issueId,

    title: c.title,

    description: (c.description || '').slice(0, 200),

    category: c.category,

    status: c.status,

    heuristicScore: c.duplicateScore,

    distanceKm: Number.isFinite(issue.latitude) && Number.isFinite(c.latitude)

      ? haversineKm(issue.latitude, issue.longitude, c.latitude, c.longitude).toFixed(3)

      : null,

    daysAgo: c.createdAt ? daysBetween(toIssueDate(c.createdAt), new Date()).toFixed(1) : null,

  }));



  const { data, aiMetrics } = await generateJSON({

    agentName: AGENT_NAMES.DUPLICATE,

    requiredKeys: ['duplicateScore', 'confidence', 'explanation', 'matchingIssueIds'],

    prompt: `Determine duplicate likelihood for a new civic report.



New report:

- issueId: ${issue.issueId}

- title: ${issue.title}

- description: ${issue.description}

- category: ${issue.category}

- location: ${issue.location || 'N/A'}

- coordinates: ${issue.latitude}, ${issue.longitude}



Candidate similar reports from Firestore:

${JSON.stringify(candidatePayload, null, 2)}



Compare description, category, distance, and time. Return JSON:

- duplicateScore (0-100 number)

- confidence (0-100 number)

- explanation (string)

- matchingIssueIds (array of issueId strings, may be empty)`,

  });



  const duplicateScore = clamp(Number(data.duplicateScore) || 0, 0, 100);

  const confidence = clamp(Number(data.confidence) || duplicateScore, 0, 100);

  const matchingIssueIds = Array.isArray(data.matchingIssueIds) ? data.matchingIssueIds : [];

  const references = matchingIssueIds.slice(0, 5).map(id => {

    const match = scored.find(s => s.issueId === id) || context.allIssues.find(i => i.issueId === id);

    return match ? { issueId: match.issueId, title: match.title, duplicateScore, status: match.status } : { issueId: id, duplicateScore, title: id };

  });



  return finalizeAgentResult({

    issueId: issue.issueId,

    agentName: AGENT_NAMES.DUPLICATE,

    status: AGENT_STATUS.COMPLETE,

    confidence,

    executionTime: 0,

    output: String(data.explanation),

    data: {

      duplicateScore,

      confidence,

      explanation: data.explanation,

      matchingIssueIds,

      existingIssueReferences: references,

      isLikelyDuplicate: duplicateScore >= 60,

    },

  }, aiMetrics, start);

}



export async function run(context) {

  if (isGeminiAvailable()) {

    try {

      return await runWithGemini(context);

    } catch (err) {

      console.warn('[Duplicate Detection] Gemini fallback:', err.message);

    }

  }

  return runHeuristic(context);

}



export { runHeuristic };


