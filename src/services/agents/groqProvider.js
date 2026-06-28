const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 600;

function getApiKey() {
  const key = import.meta.env.VITE_GROQ_API_KEY;
  console.log('[DEBUG] Groq getApiKey - API Key present:', !!(typeof key === 'string' && key.trim()));
  return typeof key === 'string' && key.trim() ? key.trim() : '';
}

export function isGroqAvailable() {
  return Boolean(getApiKey());
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

function buildAiMetrics({ latencyMs, tokenUsage, model, source, attempts }) {
  return {
    source,
    model,
    latencyMs,
    processingTimeMs: latencyMs,
    tokenUsage,
    attempts,
    confidenceSource: source === 'groq' ? 'model' : 'heuristic',
  };
}

let currentFallbackReason = null;
export function setFallbackReason(reason) { currentFallbackReason = reason; }
export function getFallbackReason() { return currentFallbackReason; }

export class GroqQuotaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GroqQuotaError';
  }
}

/**
 * Executes a chat completion request to the Groq API.
 */
async function groqChatCompletion(messages, model, isJson = false) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('VITE_GROQ_API_KEY is not configured');

  const payload = {
    messages,
    model,
    temperature: isJson ? 0.2 : 0.4,
  };
  
  if (isJson) {
    payload.response_format = { type: 'json_object' };
  }

  console.log(`[DEBUG] Groq groqChatCompletion - sending request for model: ${model}, payload:`, JSON.stringify(payload));

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[DEBUG] Groq groqChatCompletion - HTTP Error status ${response.status}:`, errorText);
    const errorObj = { status: response.status, message: errorText };
    throw errorObj;
  }

  const data = await response.json();
  console.log(`[DEBUG] Groq groqChatCompletion - success response:`, JSON.stringify(data).substring(0, 500) + '...');
  const text = data.choices?.[0]?.message?.content || '';
  const usage = data.usage || {};

  return {
    text,
    tokenUsage: {
      promptTokens: usage.prompt_tokens ?? null,
      candidatesTokens: usage.completion_tokens ?? null,
      totalTokens: usage.total_tokens ?? null,
    },
  };
}

export async function generateJSON({
  prompt,
  requiredKeys,
  systemInstruction = 'Respond with valid JSON only. No markdown fences.',
  imageUrl = null, // Groq vision is supported on some models, but handled gracefully via API if needed
  agentName = 'agent',
  model = DEFAULT_MODEL,
}) {
  let lastError = null;
  const messages = [
    { role: 'system', content: systemInstruction },
  ];
  
  if (imageUrl) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imageUrl } }
      ]
    });
  } else {
    messages.push({ role: 'user', content: prompt });
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const apiStart = performance.now();
      const result = await groqChatCompletion(messages, model, true);
      const latencyMs = Math.round(performance.now() - apiStart);
      
      const parsed = parseJsonResponse(result.text);
      validateJsonShape(parsed, requiredKeys);

      setFallbackReason(null);
      return {
        data: parsed,
        aiMetrics: buildAiMetrics({
          latencyMs,
          tokenUsage: result.tokenUsage,
          model,
          source: 'groq',
          attempts: attempt,
        }),
        agentName,
      };
    } catch (err) {
      lastError = err;
      const isQuota = err.status === 429 || /429|quota/i.test(err.message || err);
      if (isQuota) {
        setFallbackReason('quota_exceeded');
        throw new GroqQuotaError('Groq quota exceeded');
      }
      
      console.warn(`[groqProvider:${agentName}] attempt ${attempt}/${MAX_RETRIES} failed:`, err.message || err);
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  setFallbackReason('api_error');
  throw lastError || new Error(`Groq JSON generation failed for ${agentName}`);
}

export async function generateText({
  prompt,
  systemInstruction = 'You are CivicMind AI, a civic intelligence assistant. Be concise and actionable.',
  agentName = 'copilot',
  model = DEFAULT_MODEL,
}) {
  let lastError = null;
  const messages = [
    { role: 'system', content: systemInstruction },
    { role: 'user', content: prompt }
  ];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const apiStart = performance.now();
      const result = await groqChatCompletion(messages, model, false);
      const latencyMs = Math.round(performance.now() - apiStart);

      setFallbackReason(null);
      return {
        text: result.text.trim(),
        aiMetrics: buildAiMetrics({
          latencyMs,
          tokenUsage: result.tokenUsage,
          model,
          source: 'groq',
          attempts: attempt,
        }),
      };
    } catch (err) {
      lastError = err;
      const isQuota = err.status === 429 || /429|quota/i.test(err.message || err);
      if (isQuota) {
        setFallbackReason('quota_exceeded');
        throw new GroqQuotaError('Groq quota exceeded');
      }
      
      console.warn(`[groqProvider:${agentName}] text attempt ${attempt}/${MAX_RETRIES} failed:`, err.message || err);
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  setFallbackReason('api_error');
  throw lastError || new Error(`Groq text generation failed for ${agentName}`);
}

export { DEFAULT_MODEL as DEFAULT_GROQ_MODEL };
