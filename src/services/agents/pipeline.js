import { updateIssue } from '../issues.js';
import { AGENT_NAMES, AGENT_STATUS, PIPELINE_ORDER } from './constants.js';
import { logAgentExecution } from './logger.js';
import { fetchAllIssues } from './utils.js';
import * as visionInspector from './visionInspector.js';
import * as geoIntelligence from './geoIntelligence.js';
import * as duplicateDetection from './duplicateDetection.js';
import * as communityVerification from './communityVerification.js';
import * as predictiveInfrastructure from './predictiveInfrastructure.js';
import * as resolutionRecommendation from './resolutionRecommendation.js';
import * as notificationAgent from './notificationAgent.js';

/** @type {Record<string, { run: Function }>} */
const AGENT_REGISTRY = {
  [AGENT_NAMES.VISION]: visionInspector,
  [AGENT_NAMES.GEO]: geoIntelligence,
  [AGENT_NAMES.DUPLICATE]: duplicateDetection,
  [AGENT_NAMES.VERIFICATION]: communityVerification,
  [AGENT_NAMES.PREDICTION]: predictiveInfrastructure,
  [AGENT_NAMES.RESOLUTION]: resolutionRecommendation,
  [AGENT_NAMES.NOTIFICATION]: notificationAgent,
};

/**
 * Run the full multi-agent pipeline for a newly submitted issue.
 * @param {Object} params
 * @param {import('./types.js').PipelineIssue} params.issue
 * @param {Record<string, unknown>|null} [params.reporterProfile]
 * @param {Array} [params.allIssues] Optional cached issues; fetched if omitted
 * @param {(result: import('./types.js').AgentExecutionResult) => void} [params.onAgentComplete] Progress callback for UI
 * @returns {Promise<{ results: Record<string, import('./types.js').AgentExecutionResult>, issueUpdates: Record<string, unknown> }>}
 */
export async function runIssueAgentPipeline({
  issue,
  reporterProfile = null,
  allIssues = null,
  onAgentComplete = null,
}) {
  const issues = allIssues ?? await fetchAllIssues();
  if (!issues.some(i => i.issueId === issue.issueId)) {
    issues.unshift({ ...issue, id: issue.docId });
  }

  /** @type {import('./types.js').PipelineContext} */
  const context = {
    issue,
    reporterProfile,
    allIssues: issues,
    agentResults: {},
  };

  /** @type {Record<string, import('./types.js').AgentExecutionResult>} */
  const results = {};

  for (const agentName of PIPELINE_ORDER) {
    const agent = AGENT_REGISTRY[agentName];
    if (!agent) continue;

    let result;
    try {
      result = await agent.run(context);
    } catch (err) {
      result = {
        issueId: issue.issueId,
        agentName,
        status: AGENT_STATUS.FAILED,
        confidence: 0,
        executionTime: 0,
        output: err?.message || 'Agent execution failed',
        data: { error: String(err) },
      };
    }

    results[agentName] = result;
    context.agentResults[agentName] = result;

    await logAgentExecution(result);
    onAgentComplete?.(result);
  }

  const vision = results[AGENT_NAMES.VISION]?.data || {};
  const verification = results[AGENT_NAMES.VERIFICATION]?.data || {};
  const resolution = results[AGENT_NAMES.RESOLUTION]?.data || {};
  const duplicate = results[AGENT_NAMES.DUPLICATE]?.data || {};
  const prediction = results[AGENT_NAMES.PREDICTION]?.data || {};
  const geo = results[AGENT_NAMES.GEO]?.data || {};

  const issueUpdates = {
    severity: vision.severity || issue.severity,
    trustScore: verification.trustScore ?? issue.trustScore,
    department: resolution.responsibleDepartment || issue.department,
    status: duplicate.isLikelyDuplicate ? 'In Progress' : issue.status || 'Open',
    agentAnalysis: {
      vision,
      geo,
      duplicate,
      verification,
      prediction,
      resolution,
      pipelineCompletedAt: new Date().toISOString(),
    },
  };

  if (issue.docId) {
    await updateIssue(issue.docId, issueUpdates);
  }

  return { results, issueUpdates };
}

export {
  AGENT_NAMES,
  PIPELINE_ORDER,
  AGENT_REGISTRY,
};
