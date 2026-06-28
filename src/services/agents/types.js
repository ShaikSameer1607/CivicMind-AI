/**
 * @typedef {Object} AgentExecutionResult
 * @property {string} issueId
 * @property {string} agentName
 * @property {'processing'|'complete'|'active'|'failed'|'idle'} status
 * @property {number} confidence 0-100
 * @property {number} executionTime ms
 * @property {string} [output] Human-readable summary
 * @property {string} [summary] Alias for output
 * @property {Record<string, unknown>} [data] Structured agent payload
 */

/**
 * @typedef {Object} PipelineIssue
 * @property {string} docId Firestore document id
 * @property {string} issueId Human-readable issue id
 * @property {string} title
 * @property {string} description
 * @property {string} category
 * @property {string} severity
 * @property {string} [location]
 * @property {number|null} latitude
 * @property {number|null} longitude
 * @property {string|null} [imageUrl]
 * @property {string} createdBy
 */

/**
 * @typedef {Object} PipelineContext
 * @property {PipelineIssue} issue
 * @property {Record<string, unknown>|null} reporterProfile
 * @property {Array<Record<string, unknown>>} allIssues
 * @property {Record<string, AgentExecutionResult>} agentResults
 */

export {};
