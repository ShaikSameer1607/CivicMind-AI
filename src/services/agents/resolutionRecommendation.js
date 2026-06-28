import { AGENT_NAMES, AGENT_STATUS } from './constants.js';

import { DEPARTMENT_BY_CATEGORY } from '../issues.js';

import { clamp } from './utils.js';

import { generateJSON, isGeminiAvailable, finalizeAgentResult } from './aiProvider.js';



const PRIORITY_MAP = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };

const ETA_HOURS = { low: 72, medium: 48, high: 24, critical: 8 };



async function runHeuristic(context) {

  const start = performance.now();

  const { issue, agentResults } = context;



  const vision = agentResults[AGENT_NAMES.VISION]?.data || {};

  const geo = agentResults[AGENT_NAMES.GEO]?.data || {};

  const duplicate = agentResults[AGENT_NAMES.DUPLICATE]?.data || {};

  const verification = agentResults[AGENT_NAMES.VERIFICATION]?.data || {};

  const prediction = agentResults[AGENT_NAMES.PREDICTION]?.data || {};



  const severity = vision.severity || issue.severity || 'medium';

  const department = DEPARTMENT_BY_CATEGORY[issue.category] || 'General';

  const priority = PRIORITY_MAP[severity] || 'Medium';



  let escalationLevel = 1;

  if (severity === 'critical') escalationLevel = 4;

  else if (severity === 'high' || prediction.riskScore >= 70) escalationLevel = 3;

  else if (duplicate.isLikelyDuplicate || geo.nearbyDuplicateCount >= 3) escalationLevel = 2;



  const estimatedHours = ETA_HOURS[severity] || 48;

  const trustFactor = verification.trustScore >= 7 ? 1 : 0.85;

  const confidence = clamp(Math.round(70 * trustFactor + (verification.trustScore || 5) * 2), 55, 97);

  const recommendation = `Route to ${department} with ${priority} priority.`;

  const reasoning = `Severity ${severity}, escalation L${escalationLevel}, ETA ${estimatedHours}h.`;

  const output = `Route to ${department}. Priority ${priority}, escalation L${escalationLevel}, ETA ~${estimatedHours}h.`;



  return finalizeAgentResult({

    issueId: issue.issueId,

    agentName: AGENT_NAMES.RESOLUTION,

    status: AGENT_STATUS.COMPLETE,

    confidence,

    executionTime: 0,

    output,

    data: {

      department,

      priority,

      eta: `${estimatedHours}h`,

      escalation: escalationLevel,

      recommendation,

      reasoning,

      resolutionSteps: [`Assign to ${department}`, `Set priority ${priority}`, `Target resolution within ${estimatedHours} hours`],

      responsibleDepartment: department,

      estimatedResolutionHours: estimatedHours,

      escalationLevel,

      severity,

    },

  }, { source: 'heuristic', latencyMs: Math.round(performance.now() - start) }, start);

}



async function runWithGemini(context) {

  const start = performance.now();

  const { issue, agentResults } = context;



  const upstream = {

    vision: agentResults[AGENT_NAMES.VISION]?.data,

    geo: agentResults[AGENT_NAMES.GEO]?.data,

    duplicate: agentResults[AGENT_NAMES.DUPLICATE]?.data,

    verification: agentResults[AGENT_NAMES.VERIFICATION]?.data,

    prediction: agentResults[AGENT_NAMES.PREDICTION]?.data,

  };



  const { data, aiMetrics } = await generateJSON({

    agentName: AGENT_NAMES.RESOLUTION,

    requiredKeys: ['department', 'priority', 'eta', 'escalation', 'recommendation', 'reasoning'],

    prompt: `Recommend resolution routing for a civic issue.



Issue:

- issueId: ${issue.issueId}

- title: ${issue.title}

- category: ${issue.category}

- severity: ${issue.severity}

- department mapping hint: ${DEPARTMENT_BY_CATEGORY[issue.category] || 'General'}



Upstream agent analysis:

${JSON.stringify(upstream, null, 2)}



Return JSON:

- department (string — responsible department)

- priority (Low|Medium|High|Critical)

- eta (string e.g. "24h" or "2 days")

- escalation (number 1-4)

- recommendation (string)

- reasoning (string)

Also include resolutionSteps as optional array of strings in your JSON if helpful.`,

  });



  const escalationLevel = clamp(Number(data.escalation) || 1, 1, 4);

  const etaStr = String(data.eta || '48h');

  const etaMatch = etaStr.match(/(\d+)/);

  const estimatedHours = etaMatch ? Number(etaMatch[1]) : 48;

  const confidence = clamp(70 + escalationLevel * 5, 55, 97);



  return finalizeAgentResult({

    issueId: issue.issueId,

    agentName: AGENT_NAMES.RESOLUTION,

    status: AGENT_STATUS.COMPLETE,

    confidence,

    executionTime: 0,

    output: `${data.recommendation} (${data.department}, ${data.priority}, ETA ${etaStr})`,

    data: {

      department: data.department,

      priority: data.priority,

      eta: etaStr,

      escalation: escalationLevel,

      recommendation: data.recommendation,

      reasoning: data.reasoning,

      resolutionSteps: Array.isArray(data.resolutionSteps) ? data.resolutionSteps : [data.recommendation],

      responsibleDepartment: data.department,

      estimatedResolutionHours: estimatedHours,

      escalationLevel,

      severity: upstream.vision?.severity || issue.severity,

    },

  }, aiMetrics, start);

}



export async function run(context) {

  if (isGeminiAvailable()) {

    try {

      return await runWithGemini(context);

    } catch (err) {

      console.warn('[Resolution Recommendation] Gemini fallback:', err.message);

    }

  }

  return runHeuristic(context);

}



export { runHeuristic };


