import * as gemini from './geminiProvider.js';
import * as groq from './groqProvider.js';
import { showInfo, showWarning } from '../ui.js';

// Re-export common utilities
export const parseJsonResponse = gemini.parseJsonResponse;
export const validateJsonShape = gemini.validateJsonShape;
export const GeminiQuotaError = gemini.GeminiQuotaError;

export const DEFAULT_MODEL = gemini.DEFAULT_MODEL;
export const MAX_RETRIES = gemini.MAX_RETRIES;

// Global fallback state for heuristic Engine
let currentFallbackReason = null;
export function setFallbackReason(reason) { currentFallbackReason = reason; }
export function getFallbackReason() { return currentFallbackReason; }

/**
 * For backward compatibility with existing agents.
 * Returns true if ANY provider is available.
 */
export function isGeminiAvailable() {
  return gemini.isGeminiAvailable() || groq.isGroqAvailable();
}

/**
 * Determine the provider to use based on env configuration and agent defaults.
 */
function determineProvider(agentName, preferredProvider = 'auto') {
  let envDefault = import.meta.env.VITE_DEFAULT_AI_PROVIDER || 'auto';
  
  // Override with user setting if available
  try {
    const userPref = localStorage.getItem('ai_provider_preference');
    if (userPref === 'gemini' || userPref === 'groq' || userPref === 'auto') {
      envDefault = userPref;
    }
  } catch(e) {}
  
  // Agent-level hardcoded defaults as requested
  const agentDefaults = {
    'Vision Inspector': 'gemini',
    'Geo Intelligence': 'gemini',
    'Duplicate Detection': 'gemini',
    'Community Verification': 'groq',
    'Predictive Infrastructure': 'groq',
    'Resolution Recommendation': 'groq',
    'Notification Agent': 'gemini',
    'copilot': 'auto',
  };

  let target = preferredProvider;
  if (target === 'auto') {
    target = agentDefaults[agentName] || envDefault;
  }
  
  if (target === 'auto') target = 'gemini'; // Ultimate default

  // Fallback to whichever is available if the target is missing
  if (target === 'gemini' && !gemini.isGeminiAvailable() && groq.isGroqAvailable()) return 'groq';
  if (target === 'groq' && !groq.isGroqAvailable() && gemini.isGeminiAvailable()) return 'gemini';

  return target;
}

export async function generateJSON(options) {
  const provider = determineProvider(options.agentName);
  let result = null;
  let fallbackTriggered = false;

  try {
    if (provider === 'groq') {
      result = await groq.generateJSON(options);
    } else {
      result = await gemini.generateJSON(options);
    }
  } catch (err) {
    const isQuota = /quota/i.test(err.message || err.name) || err.status === 429;
    
    // Automatic Provider Switching
    if (provider === 'gemini' && groq.isGroqAvailable()) {
      if (isQuota) showInfo('Gemini quota reached. Switching to Groq automatically.');
      else console.warn(`[Orchestrator] Gemini failed (${err.message}). Automatically switching to Groq.`);
      fallbackTriggered = true;
      try {
        result = await groq.generateJSON(options);
      } catch (groqErr) {
        setFallbackReason('api_error');
        showWarning('Cloud AI providers are temporarily unavailable. Using CivicMind intelligent offline analysis.');
        throw groqErr;
      }
    } else if (provider === 'groq' && gemini.isGeminiAvailable()) {
      if (isQuota) showInfo('Groq quota reached. Switching to Gemini automatically.');
      else console.warn(`[Orchestrator] Groq failed (${err.message}). Automatically switching to Gemini.`);
      fallbackTriggered = true;
      try {
        result = await gemini.generateJSON(options);
      } catch (geminiErr) {
        setFallbackReason('api_error');
        showWarning('Cloud AI providers are temporarily unavailable. Using CivicMind intelligent offline analysis.');
        throw geminiErr;
      }
    } else {
      setFallbackReason(isQuota ? 'quota_exceeded' : 'api_error');
      showWarning('Cloud AI providers are temporarily unavailable. Using CivicMind intelligent offline analysis.');
      throw err;
    }
  }

  // Attach orchestrator metrics
  if (result && result.aiMetrics) {
    if (fallbackTriggered) {
      result.aiMetrics.providerSwitch = true;
    }
  }
  return result;
}

export async function generateText(options) {
  const provider = determineProvider(options.agentName);
  let result = null;
  let fallbackTriggered = false;

  try {
    if (provider === 'groq') {
      result = await groq.generateText(options);
    } else {
      result = await gemini.generateText(options);
    }
  } catch (err) {
    const isQuota = /quota/i.test(err.message || err.name) || err.status === 429;
    
    // Automatic Provider Switching
    if (provider === 'gemini' && groq.isGroqAvailable()) {
      if (isQuota) showInfo('Gemini quota reached. Switching to Groq automatically.');
      else console.warn(`[Orchestrator] Gemini failed (${err.message}). Automatically switching to Groq.`);
      fallbackTriggered = true;
      try {
        result = await groq.generateText(options);
      } catch (groqErr) {
        setFallbackReason('api_error');
        showWarning('Cloud AI providers are temporarily unavailable. Using CivicMind intelligent offline analysis.');
        throw groqErr;
      }
    } else if (provider === 'groq' && gemini.isGeminiAvailable()) {
      if (isQuota) showInfo('Groq quota reached. Switching to Gemini automatically.');
      else console.warn(`[Orchestrator] Groq failed (${err.message}). Automatically switching to Gemini.`);
      fallbackTriggered = true;
      try {
        result = await gemini.generateText(options);
      } catch (geminiErr) {
        setFallbackReason('api_error');
        showWarning('Cloud AI providers are temporarily unavailable. Using CivicMind intelligent offline analysis.');
        throw geminiErr;
      }
    } else {
      setFallbackReason(isQuota ? 'quota_exceeded' : 'api_error');
      showWarning('Cloud AI providers are temporarily unavailable. Using CivicMind intelligent offline analysis.');
      throw err;
    }
  }

  // Attach orchestrator metrics
  if (result && result.aiMetrics) {
    if (fallbackTriggered) {
      result.aiMetrics.providerSwitch = true;
    }
  }
  return result;
}

/**
 * Attach aiMetrics to an agent result and compute total execution time.
 * @param {import('./types.js').AgentExecutionResult} result
 * @param {Record<string, unknown>|null} aiMetrics
 * @param {number} startMs performance.now() at agent start
 */
export function finalizeAgentResult(result, aiMetrics, startMs) {
  const isHeuristic = !aiMetrics || aiMetrics.source === 'heuristic';
  const fallbackReason = isHeuristic ? (getFallbackReason() || 'api_error') : null;
  
  const finalAiMetrics = aiMetrics || { 
    source: 'heuristic', 
    latencyMs: Math.round(performance.now() - startMs),
    fallbackReason 
  };
  
  if (isHeuristic && fallbackReason) {
    finalAiMetrics.fallbackReason = fallbackReason;
  }

  return {
    ...result,
    executionTime: Math.round(performance.now() - startMs),
    aiMetrics: finalAiMetrics,
    data: {
      ...(result.data || {}),
      _aiMetrics: finalAiMetrics,
    },
  };
}
