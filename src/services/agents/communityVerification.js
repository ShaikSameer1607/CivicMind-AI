import { AGENT_NAMES, AGENT_STATUS } from './constants.js';

import { clamp } from './utils.js';

import { generateJSON, isGeminiAvailable, finalizeAgentResult } from './aiProvider.js';



function buildVerificationContext(context) {

  const { issue, reporterProfile, allIssues } = context;

  const reporterIssues = allIssues.filter(i => i.createdBy === issue.createdBy && i.issueId !== issue.issueId);

  const resolvedCount = reporterIssues.filter(i => i.status === 'Resolved').length;

  const historicalAccuracy = reporterIssues.length

    ? Math.round((resolvedCount / reporterIssues.length) * 100)

    : 50;



  return {

    reputation: Number(reporterProfile?.citizenScore) || 100,

    badges: reporterProfile?.badges || [],

    role: reporterProfile?.role || 'Citizen',

    hasEvidence: Boolean(issue.imageUrl),

    votes: 0,

    priorReports: reporterIssues.length,

    resolvedReports: resolvedCount,

    historicalAccuracy,

    reporterIssues: reporterIssues.slice(0, 5).map(i => ({

      issueId: i.issueId,

      status: i.status,

      category: i.category,

    })),

  };

}



async function runHeuristic(context) {

  const start = performance.now();

  const { issue } = context;

  const ctx = buildVerificationContext(context);



  const badgeBonus = (ctx.badges?.length || 0) * 5;

  let trustScore = 5.0;

  trustScore += (ctx.reputation / 1000) * 2;

  trustScore += (ctx.historicalAccuracy / 100) * 1.5;

  trustScore += ctx.hasEvidence ? 1.2 : 0;

  trustScore += badgeBonus * 0.05;

  trustScore = clamp(Number(trustScore.toFixed(1)), 1, 10);



  let verificationLevel = 'Unverified';

  if (trustScore >= 8) verificationLevel = 'Highly Trusted';

  else if (trustScore >= 6.5) verificationLevel = 'Verified';

  else if (trustScore >= 5) verificationLevel = 'Standard';

  else verificationLevel = 'Needs Review';



  const confidence = clamp(Math.round(trustScore * 10), 40, 98);

  const explanation = `Trust score ${trustScore}/10 (${verificationLevel}). Reputation ${ctx.reputation}, accuracy ${ctx.historicalAccuracy}%.`;



  return finalizeAgentResult({

    issueId: issue.issueId,

    agentName: AGENT_NAMES.VERIFICATION,

    status: AGENT_STATUS.COMPLETE,

    confidence,

    executionTime: 0,

    output: explanation,

    data: {

      trustScore,

      verificationLevel,

      confidence,

      explanation,

      votes: ctx.votes,

      hasEvidence: ctx.hasEvidence,

      reporterReputation: ctx.reputation,

      historicalAccuracy: ctx.historicalAccuracy,

      priorReports: ctx.priorReports,

    },

  }, { source: 'heuristic', latencyMs: Math.round(performance.now() - start) }, start);

}



async function runWithGemini(context) {

  const start = performance.now();

  const { issue } = context;

  const ctx = buildVerificationContext(context);



  const { data, aiMetrics } = await generateJSON({

    agentName: AGENT_NAMES.VERIFICATION,

    requiredKeys: ['trustScore', 'verificationLevel', 'confidence', 'explanation'],

    prompt: `Assess community verification trust for a civic report.



Report issueId: ${issue.issueId}

Has image evidence: ${ctx.hasEvidence}

Community votes on this report: ${ctx.votes}



Reporter profile:

- citizenScore: ${ctx.reputation}

- role: ${ctx.role}

- badges: ${JSON.stringify(ctx.badges)}

- prior reports: ${ctx.priorReports}

- resolved reports: ${ctx.resolvedReports}

- historical accuracy: ${ctx.historicalAccuracy}%

- recent issues: ${JSON.stringify(ctx.reporterIssues)}



Return JSON:

- trustScore (number 1-10)

- verificationLevel (Unverified|Standard|Verified|Highly Trusted|Needs Review)

- confidence (0-100 number)

- explanation (string)`,

  });



  const trustScore = clamp(Number(Number(data.trustScore).toFixed(1)), 1, 10);

  const confidence = clamp(Number(data.confidence) || Math.round(trustScore * 10), 0, 100);



  return finalizeAgentResult({

    issueId: issue.issueId,

    agentName: AGENT_NAMES.VERIFICATION,

    status: AGENT_STATUS.COMPLETE,

    confidence,

    executionTime: 0,

    output: String(data.explanation),

    data: {

      trustScore,

      verificationLevel: data.verificationLevel,

      confidence,

      explanation: data.explanation,

      votes: ctx.votes,

      hasEvidence: ctx.hasEvidence,

      reporterReputation: ctx.reputation,

      historicalAccuracy: ctx.historicalAccuracy,

      priorReports: ctx.priorReports,

    },

  }, aiMetrics, start);

}



export async function run(context) {

  if (isGeminiAvailable()) {

    try {

      return await runWithGemini(context);

    } catch (err) {

      console.warn('[Community Verification] Gemini fallback:', err.message);

    }

  }

  return runHeuristic(context);

}



export { runHeuristic };


