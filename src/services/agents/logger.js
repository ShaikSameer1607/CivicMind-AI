import { createAgentLog } from '../system.js';



/**

 * Persist a structured agent execution record to Firestore agent_logs.

 * @param {import('./types.js').AgentExecutionResult} result

 */

export async function logAgentExecution(result) {
  const summary =
    typeof result.output === 'string'
      ? result.output
      : result.summary || JSON.stringify(result.data || {});

  const structuredOutput = result.data ?? null;

  const metricsNote = result.aiMetrics?.source === 'gemini' || result.aiMetrics?.source === 'grok'
    ? ` [${result.aiMetrics.source === 'gemini' ? 'Gemini' : 'Grok'} ${result.aiMetrics.latencyMs}ms${result.aiMetrics.tokenUsage?.totalTokens ? `, ${result.aiMetrics.tokenUsage.totalTokens} tokens` : ''}]`
    : result.aiMetrics?.source === 'heuristic'
      ? ' [heuristic fallback]'
      : '';

  const aiData = result.aiMetrics ? {
    provider: result.aiMetrics.source,
    model: result.aiMetrics.model,
    latency: result.aiMetrics.latencyMs,
    tokenUsage: result.aiMetrics.tokenUsage,
    providerSwitch: result.aiMetrics.providerSwitch || false,
    fallbackReason: result.aiMetrics.fallbackReason || null,
  } : null;

  await createAgentLog(
    result.issueId,
    result.agentName,
    result.status,
    result.confidence,
    `${summary}${metricsNote}`,
    result.executionTime ?? null,
    structuredOutput,
    aiData
  );

  return result;
}


