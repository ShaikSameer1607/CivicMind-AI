import { isGeminiAvailable, generateText } from './agents/aiProvider.js';
import { computeCategoryCounts } from './agents/utils.js';
import { DEPARTMENT_BY_CATEGORY } from './issues.js';

function buildCopilotContext({ issues, agentLogs, notifications }) {
  const stats = {
    total: issues.length,
    open: issues.filter(i => i.status === 'Open').length,
    inProgress: issues.filter(i => i.status === 'In Progress').length,
    resolved: issues.filter(i => i.status === 'Resolved').length,
    critical: issues.filter(i => i.severity === 'critical' && i.status !== 'Resolved').length,
  };

  const categoryCounts = computeCategoryCounts(issues);
  const deptWorkload = {};
  issues.forEach(i => {
    const dept = i.department || DEPARTMENT_BY_CATEGORY[i.category] || 'General';
    deptWorkload[dept] = (deptWorkload[dept] || 0) + 1;
  });

  const wardRisk = {};
  issues.forEach(i => {
    const ward = i.agentAnalysis?.geo?.ward || i.location || 'Unknown';
    const risk = i.agentAnalysis?.geo?.riskZone || i.agentAnalysis?.prediction?.riskScore || 0;
    if (!wardRisk[ward]) wardRisk[ward] = { count: 0, riskSum: 0 };
    wardRisk[ward].count += 1;
    wardRisk[ward].riskSum += typeof risk === 'number' ? risk : risk === 'High Risk' ? 80 : 40;
  });

  const predictions = issues
    .filter(i => i.agentAnalysis?.prediction)
    .slice(0, 8)
    .map(i => ({
      issueId: i.issueId,
      prediction: i.agentAnalysis.prediction.prediction || i.agentAnalysis.prediction.recommendation,
      confidence: i.agentAnalysis.prediction.confidence || i.agentAnalysis.prediction.predictionConfidence,
    }));

  const recentLogs = agentLogs.slice(0, 15).map(l => ({
    agent: l.agentName,
    status: l.status,
    confidence: l.confidence,
    issueId: l.issueId,
    output: String(l.output || '').slice(0, 120),
  }));

  const recentNotifications = notifications.slice(0, 10).map(n => ({
    type: n.type,
    message: String(n.message || '').slice(0, 100),
    issueId: n.issueId,
  }));

  const criticalIssues = issues
    .filter(i => i.severity === 'critical' && i.status !== 'Resolved')
    .slice(0, 10)
    .map(i => ({
      issueId: i.issueId,
      title: i.title,
      department: i.department,
      status: i.status,
    }));

  return {
    stats,
    categoryCounts,
    deptWorkload,
    wardRisk,
    predictions,
    recentLogs,
    recentNotifications,
    criticalIssues,
  };
}

function buildHeuristicAnswer(question, context) {
  const q = question.toLowerCase();
  const { stats, deptWorkload, wardRisk, criticalIssues } = context;

  if (q.includes('ward') && (q.includes('risk') || q.includes('highest'))) {
    const ranked = Object.entries(wardRisk)
      .map(([ward, v]) => ({ ward, score: v.count ? v.riskSum / v.count : 0, count: v.count }))
      .sort((a, b) => b.score - a.score);
    const top = ranked[0];
    return top
      ? `${top.ward} shows the highest infrastructure risk signal (score ~${Math.round(top.score)}, ${top.count} report(s)). Review geolocated issues and agent geo analysis for that zone.`
      : 'No ward-level risk data yet. Submit geolocated reports to enable ward analysis.';
  }

  if (q.includes('department') && (q.includes('workload') || q.includes('highest'))) {
    const ranked = Object.entries(deptWorkload).sort((a, b) => b[1] - a[1]);
    const top = ranked[0];
    return top
      ? `${top[0]} has the highest workload with ${top[1]} assigned issue(s). Consider rebalancing field teams.`
      : 'No department workload data available yet.';
  }

  if (q.includes('critical') || q.includes('unresolved')) {
    if (!criticalIssues.length) return 'There are no unresolved critical issues in Firestore right now.';
    return `Found ${criticalIssues.length} unresolved critical issue(s): ${criticalIssues.map(i => i.issueId).join(', ')}. Top: "${criticalIssues[0].title}" (${criticalIssues[0].department || 'Unassigned'}).`;
  }

  if (q.includes('predict') || q.includes('failure') || q.includes('this week')) {
    if (!context.predictions.length) {
      return 'Insufficient historical data for weekly predictions. Submit more reports to train the Predictive Infrastructure agent.';
    }
    return `Based on agent predictions: ${context.predictions.slice(0, 3).map(p => `${p.issueId} — ${p.prediction} (${p.confidence ?? '—'}% confidence)`).join('; ')}.`;
  }

  if (q.includes('today') || q.includes('summarize')) {
    return `Today’s network snapshot: ${stats.total} total reports, ${stats.open} open, ${stats.critical} critical open, ${stats.resolved} resolved. ${context.recentLogs.length} recent agent executions logged.`;
  }

  return `CivicMind snapshot: ${stats.total} incidents, ${stats.open} open, ${stats.critical} critical. Ask about wards, departments, critical issues, predictions, or today’s summary.`;
}

/**
 * CivicMind AI Copilot — answers questions using live Firestore context.
 * @param {string} question
 * @param {{ issues: Array, agentLogs: Array, notifications: Array }} dataSources
 */
export async function askCopilot(question, dataSources) {
  const trimmed = String(question || '').trim();
  if (!trimmed) {
    return { text: 'Please enter a question about civic issues, agents, or predictions.', source: 'local' };
  }

  const context = buildCopilotContext(dataSources);
  const contextJson = JSON.stringify(context, null, 2);

  if (isGeminiAvailable()) {
    try {
      const { text, aiMetrics } = await generateText({
        agentName: 'copilot',
        systemInstruction: `You are CivicMind AI Copilot for a civic issue management platform.
Use ONLY the provided JSON context from Firestore issues, agent_logs, predictions, and notifications.
If data is missing, say so clearly. Be conversational, concise, and actionable.
Do not invent issue IDs or statistics not present in the context.`,
        prompt: `Context JSON:\n${contextJson}\n\nUser question: ${trimmed}\n\nAnswer:`,
      });
      return { text, source: aiMetrics.source, aiMetrics };
    } catch (err) {
      console.warn('[copilot] AI Provider failed, using heuristic:', err.message);
    }
  }

  return { text: buildHeuristicAnswer(trimmed, context), source: 'heuristic' };
}

export { buildCopilotContext };
