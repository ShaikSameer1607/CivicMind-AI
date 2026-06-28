import { AGENT_NAMES, AGENT_STATUS } from './constants.js';

import { inferSeverityFromText, clamp } from './utils.js';

import { generateJSON, isGeminiAvailable, finalizeAgentResult } from './aiProvider.js';



async function runHeuristic(context) {

  const start = performance.now();

  const { issue } = context;



  const detectedIssue = issue.title || 'Unclassified civic issue';

  const inferredSeverity = inferSeverityFromText(issue.description, issue.category, issue.severity);

  const hasImage = Boolean(issue.imageUrl);

  const descLen = (issue.description || '').length;



  let confidence = 55;

  if (hasImage) confidence += 25;

  if (descLen > 40) confidence += 10;

  if (issue.category) confidence += 5;

  confidence = clamp(confidence, 40, 92);



  const summary = hasImage

    ? `Detected "${detectedIssue}" in ${issue.category} with ${inferredSeverity} severity (image + text).`

    : `Detected "${detectedIssue}" from description in ${issue.category} (${inferredSeverity} severity, text-only).`;



  return finalizeAgentResult({

    issueId: issue.issueId,

    agentName: AGENT_NAMES.VISION,

    status: AGENT_STATUS.COMPLETE,

    confidence,

    executionTime: 0,

    output: summary,

    data: {

      detectedIssue,

      confidence,

      severity: inferredSeverity,

      summary,

      recommendedCategory: issue.category,

      visibleDamage: hasImage ? 'Evidence image attached' : 'Not visible in submission',

      urgency: inferredSeverity === 'critical' ? 'immediate' : inferredSeverity === 'high' ? 'high' : 'standard',

      hasImageEvidence: hasImage,

      category: issue.category,

    },

  }, { source: 'heuristic', latencyMs: Math.round(performance.now() - start) }, start);

}



async function runWithGemini(context) {

  const start = performance.now();

  const { issue } = context;



  const { data, aiMetrics } = await generateJSON({

    agentName: AGENT_NAMES.VISION,

    imageUrl: issue.imageUrl,

    requiredKeys: ['detectedIssue', 'severity', 'confidence', 'summary', 'recommendedCategory', 'visibleDamage', 'urgency'],

    prompt: `Analyze this civic issue report.



Title: ${issue.title}

Description: ${issue.description}

User-selected category: ${issue.category}

User-selected severity: ${issue.severity}

${issue.imageUrl ? 'An evidence image is attached.' : 'No image attached — infer from text only.'}



Return JSON with:

- detectedIssue (string)

- severity (low|medium|high|critical)

- confidence (0-100 number)

- summary (string, one paragraph)

- recommendedCategory (Infrastructure|Safety|Environment or best fit)

- visibleDamage (string describing visible damage or "Not visible")

- urgency (immediate|high|standard|low)`,

  });



  const summary = String(data.summary);

  return finalizeAgentResult({

    issueId: issue.issueId,

    agentName: AGENT_NAMES.VISION,

    status: AGENT_STATUS.COMPLETE,

    confidence: clamp(Number(data.confidence) || 70, 0, 100),

    executionTime: 0,

    output: summary,

    data: {

      detectedIssue: data.detectedIssue,

      severity: data.severity,

      confidence: Number(data.confidence),

      summary,

      recommendedCategory: data.recommendedCategory,

      visibleDamage: data.visibleDamage,

      urgency: data.urgency,

      hasImageEvidence: Boolean(issue.imageUrl),

      category: issue.category,

    },

  }, aiMetrics, start);

}



/**

 * Vision Inspector Agent — Gemini multimodal with heuristic fallback.

 */

export async function run(context) {

  if (isGeminiAvailable()) {

    try {

      return await runWithGemini(context);

    } catch (err) {

      console.warn('[Vision Inspector] Gemini fallback:', err.message);

    }

  }

  return runHeuristic(context);

}



export { runHeuristic };


