import { AGENT_NAMES, AGENT_STATUS } from './constants.js';

import { computeCategoryCounts, clamp } from './utils.js';

import { generateJSON, isGeminiAvailable, finalizeAgentResult } from './aiProvider.js';



const PREDICTION_MAP = {

  Infrastructure: [

    { type: 'potholes', keywords: ['pothole', 'road', 'crack', 'pavement'] },

    { type: 'leakages', keywords: ['leak', 'water', 'pipe', 'main'] },

    { type: 'streetlight_failures', keywords: ['light', 'lamp', 'dark', 'streetlight'] },

  ],

  Safety: [{ type: 'traffic_hazards', keywords: ['traffic', 'signal', 'crosswalk'] }],

  Environment: [{ type: 'garbage_hotspots', keywords: ['garbage', 'waste', 'dump', 'trash', 'litter'] }],

};



function buildHistoricalSummary(allIssues) {

  const categoryCounts = computeCategoryCounts(allIssues);

  return allIssues.slice(0, 30).map(i => ({

    issueId: i.issueId,

    category: i.category,

    severity: i.severity,

    status: i.status,

    department: i.department,

    title: (i.title || '').slice(0, 80),

  })).concat([{ _categoryCounts: categoryCounts, _total: allIssues.length }]);

}



async function runHeuristic(context) {

  const start = performance.now();

  const { issue, allIssues } = context;

  const categoryCounts = computeCategoryCounts(allIssues);

  const total = allIssues.length || 1;

  const categoryShare = (categoryCounts[issue.category] || 0) / total;



  const templates = PREDICTION_MAP[issue.category] || PREDICTION_MAP.Infrastructure;

  const desc = (issue.description || '').toLowerCase();



  const predictions = templates.map(t => {

    const keywordHit = t.keywords.some(k => desc.includes(k));

    const baseRisk = Math.round(categoryShare * 100);

    const riskScore = clamp(keywordHit ? baseRisk + 25 : baseRisk, 5, 95);

    return { ...t, riskScore, keywordHit };

  }).sort((a, b) => b.riskScore - a.riskScore);



  const top = predictions[0];

  const riskScore = top?.riskScore ?? Math.round(categoryShare * 80);

  const predictionConfidence = clamp(Math.round(50 + categoryShare * 40 + (allIssues.length > 5 ? 10 : 0)), 45, 92);



  const recommendation = riskScore >= 70

    ? `Schedule proactive inspection for ${top.type.replace(/_/g, ' ')} in ${issue.category} sector.`

    : riskScore >= 45

      ? `Monitor ${issue.category} reports — elevated historical frequency.`

      : 'No immediate infrastructure intervention predicted.';



  const prediction = top?.type?.replace(/_/g, ' ') || 'general infrastructure degradation';

  const output = `Risk ${riskScore}% for ${prediction}. ${recommendation}`;



  return finalizeAgentResult({

    issueId: issue.issueId,

    agentName: AGENT_NAMES.PREDICTION,

    status: AGENT_STATUS.COMPLETE,

    confidence: predictionConfidence,

    executionTime: 0,

    output,

    data: {

      prediction,

      confidence: predictionConfidence,

      affectedArea: issue.location || issue.category,

      recommendation,

      reasoning: `Historical ${issue.category} share ${Math.round(categoryShare * 100)}%, sample ${allIssues.length} issues.`,

      riskScore,

      predictionConfidence,

      predictions: {

        potholes: predictions.find(p => p.type === 'potholes')?.riskScore ?? 0,

        leakages: predictions.find(p => p.type === 'leakages')?.riskScore ?? 0,

        streetlight_failures: predictions.find(p => p.type === 'streetlight_failures')?.riskScore ?? 0,

        garbage_hotspots: predictions.find(p => p.type === 'garbage_hotspots')?.riskScore ?? 0,

      },

      historicalSampleSize: allIssues.length,

    },

  }, { source: 'heuristic', latencyMs: Math.round(performance.now() - start) }, start);

}



async function runWithGemini(context) {

  const start = performance.now();

  const { issue, allIssues } = context;

  const history = buildHistoricalSummary(allIssues);



  const { data, aiMetrics } = await generateJSON({

    agentName: AGENT_NAMES.PREDICTION,

    requiredKeys: ['prediction', 'confidence', 'affectedArea', 'recommendation', 'reasoning'],

    prompt: `Predict infrastructure failures based on historical Firestore civic issues.



Current report:

- issueId: ${issue.issueId}

- category: ${issue.category}

- severity: ${issue.severity}

- location: ${issue.location || 'Unknown'}

- description: ${issue.description}



Historical issues sample and counts:

${JSON.stringify(history, null, 2)}



Predict future: potholes, water leakage, streetlight failures, garbage hotspots, infrastructure degradation.



Return JSON:

- prediction (string — primary predicted failure type)

- confidence (0-100 number)

- affectedArea (string — ward/area/category)

- recommendation (string — actionable step)

- reasoning (string)`,

  });



  const confidence = clamp(Number(data.confidence) || 70, 0, 100);

  const riskScore = clamp(confidence, 5, 95);



  return finalizeAgentResult({

    issueId: issue.issueId,

    agentName: AGENT_NAMES.PREDICTION,

    status: AGENT_STATUS.COMPLETE,

    confidence,

    executionTime: 0,

    output: `${data.prediction}: ${data.recommendation}`,

    data: {

      prediction: data.prediction,

      confidence,

      affectedArea: data.affectedArea,

      recommendation: data.recommendation,

      reasoning: data.reasoning,

      riskScore,

      predictionConfidence: confidence,

      predictions: {

        potholes: String(data.prediction).toLowerCase().includes('pothole') ? confidence : 0,

        leakages: String(data.prediction).toLowerCase().includes('leak') ? confidence : 0,

        streetlight_failures: String(data.prediction).toLowerCase().includes('light') ? confidence : 0,

        garbage_hotspots: String(data.prediction).toLowerCase().includes('garbage') ? confidence : 0,

      },

      historicalSampleSize: allIssues.length,

    },

  }, aiMetrics, start);

}



export async function run(context) {

  if (isGeminiAvailable()) {

    try {

      return await runWithGemini(context);

    } catch (err) {

      console.warn('[Predictive Infrastructure] Gemini fallback:', err.message);

    }

  }

  return runHeuristic(context);

}



export { runHeuristic };


