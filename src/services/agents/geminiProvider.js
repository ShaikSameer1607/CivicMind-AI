import { GoogleGenerativeAI } from '@google/generative-ai';

const DEFAULT_MODEL = 'gemini-2.0-flash';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 600;

/** @type {GoogleGenerativeAI|null} */
let client = null;

function getApiKey() {
  const key = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY;
  return typeof key === 'string' && key.trim() && !key.includes('your_gemini') ? key.trim() : '';
}

function getClient() {
  const key = getApiKey();
  if (!key) return null;
  if (!client) client = new GoogleGenerativeAI(key);
  return client;
}

export function isGeminiAvailable() {
  return Boolean(getClient());
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stripJsonFence(text) {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export function parseJsonResponse(raw) {
  const cleaned = stripJsonFence(raw);
  return JSON.parse(cleaned);
}

/**
 * @param {Record<string, unknown>} data
 * @param {string[]} requiredKeys
 */
export function validateJsonShape(data, requiredKeys) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Response is not a JSON object');
  }
  const missing = requiredKeys.filter(key => data[key] === undefined || data[key] === null);
  if (missing.length) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }
  return data;
}

function extractUsageMetadata(response) {
  const usage = response?.usageMetadata || {};
  return {
    promptTokens: usage.promptTokenCount ?? null,
    candidatesTokens: usage.candidatesTokenCount ?? null,
    totalTokens: usage.totalTokenCount ?? null,
  };
}

function buildAiMetrics({ latencyMs, tokenUsage, model, source, attempts }) {
  return {
    source,
    model,
    latencyMs,
    processingTimeMs: latencyMs,
    tokenUsage,
    attempts,
    confidenceSource: source === 'gemini' ? 'model' : 'heuristic',
  };
}

async function imageUrlToPart(imageUrl) {
  if (!imageUrl) return null;

  if (imageUrl.startsWith('data:')) {
    const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    return { inlineData: { mimeType: match[1], data: match[2] } };
  }

  try {
    const res = await fetch(imageUrl);
    const blob = await res.blob();
    const buffer = await blob.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return { inlineData: { mimeType: blob.type || 'image/jpeg', data: base64 } };
  } catch {
    return null;
  }
}

export class GeminiQuotaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GeminiQuotaError';
  }
}

let currentFallbackReason = null;
export function setFallbackReason(reason) { currentFallbackReason = reason; }
export function getFallbackReason() { return currentFallbackReason; }

/**
 * @param {Object} options
 * @param {string} options.prompt
 * @param {string[]} options.requiredKeys
 * @param {string} [options.systemInstruction]
 * @param {string} [options.imageUrl]
 * @param {string} [options.agentName]
 * @param {string} [options.model]
 */
export async function generateJSON({
  prompt,
  requiredKeys,
  systemInstruction = 'Respond with valid JSON only. No markdown fences.',
  imageUrl = null,
  agentName = 'agent',
  model = DEFAULT_MODEL,
}) {
  const genAI = getClient();
  if (!genAI) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  let lastError = null;
  const started = performance.now();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const generativeModel = genAI.getGenerativeModel({
        model,
        systemInstruction,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      });

      const parts = [{ text: prompt }];
      const imagePart = await imageUrlToPart(imageUrl);
      if (imagePart) parts.unshift(imagePart);

      const apiStart = performance.now();
      const result = await generativeModel.generateContent(parts);
      const latencyMs = Math.round(performance.now() - apiStart);
      const text = result.response.text();
      const parsed = parseJsonResponse(text);
      validateJsonShape(parsed, requiredKeys);

      setFallbackReason(null);
      return {
        data: parsed,
        aiMetrics: buildAiMetrics({
          latencyMs,
          tokenUsage: extractUsageMetadata(result.response),
          model,
          source: 'gemini',
          attempts: attempt,
        }),
        agentName,
      };
    } catch (err) {
      lastError = err;
      const isQuota = err.status === 429 || /429|quota/i.test(err.message);
      if (isQuota) {
        setFallbackReason('quota_exceeded');
        import('../ui.js').then(m => m.showToast?.('warning', 'Gemini quota exceeded. Using intelligent offline analysis.'));
        throw new GeminiQuotaError('Gemini quota exceeded');
      }
      
      console.warn(`[aiProvider:${agentName}] attempt ${attempt}/${MAX_RETRIES} failed:`, err.message);
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  setFallbackReason('api_error');
  throw lastError || new Error(`Gemini JSON generation failed for ${agentName}`);
}

/**
 * @param {Object} options
 * @param {string} options.prompt
 * @param {string} [options.systemInstruction]
 * @param {string} [options.agentName]
 * @param {string} [options.model]
 */
export async function generateText({
  prompt,
  systemInstruction = 'You are CivicMind AI, a civic intelligence assistant. Be concise and actionable.',
  agentName = 'copilot',
  model = DEFAULT_MODEL,
}) {
  const genAI = getClient();
  if (!genAI) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const generativeModel = genAI.getGenerativeModel({
        model,
        systemInstruction,
        generationConfig: { temperature: 0.4 },
      });

      const apiStart = performance.now();
      const result = await generativeModel.generateContent(prompt);
      const latencyMs = Math.round(performance.now() - apiStart);
      const text = result.response.text();

      setFallbackReason(null);
      return {
        text: text.trim(),
        aiMetrics: buildAiMetrics({
          latencyMs,
          tokenUsage: extractUsageMetadata(result.response),
          model,
          source: 'gemini',
          attempts: attempt,
        }),
      };
    } catch (err) {
      lastError = err;
      const isQuota = err.status === 429 || /429|quota/i.test(err.message);
      if (isQuota) {
        setFallbackReason('quota_exceeded');
        import('../ui.js').then(m => m.showToast?.('warning', 'Gemini quota exceeded. Using intelligent offline analysis.'));
        throw new GeminiQuotaError('Gemini quota exceeded');
      }
      
      console.warn(`[aiProvider:${agentName}] text attempt ${attempt}/${MAX_RETRIES} failed:`, err.message);
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  setFallbackReason('api_error');
  throw lastError || new Error(`Gemini text generation failed for ${agentName}`);
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

export { DEFAULT_MODEL, MAX_RETRIES };
