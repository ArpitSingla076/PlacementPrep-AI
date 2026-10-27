import { GoogleGenAI, ApiError } from '@google/genai';
import { AiError, aiNotConfigured } from '../errors.js';
import { log } from '../../utils/logger.js';

const THINKING_LEVELS = { minimal: 'MINIMAL', low: 'LOW', medium: 'MEDIUM', high: 'HIGH' };

/**
 * Gemini adapter (official @google/genai SDK, `ai.models.generateContent`).
 *
 * Contract every LLM provider must satisfy (this is what makes providers interchangeable):
 *   name, model, isConfigured, describe(), generate({ systemInstruction, messages, jsonSchema, temperature })
 *   -> { text, finishReason, usage: { promptTokens, outputTokens, totalTokens } }
 * and it must throw AiError (never raw SDK errors).
 */
export class GeminiLlmProvider {
  name = 'gemini';

  constructor({ apiKey, model, baseUrl, timeoutMs = 60_000, maxOutputTokens = 8192, thinkingBudget, thinkingLevel }) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.maxOutputTokens = maxOutputTokens;
    this.thinkingBudget = thinkingBudget;
    this.thinkingLevel = thinkingLevel;
    this._client = null;
  }

  get isConfigured() {
    return Boolean(this.apiKey && this.model);
  }

  describe() {
    return { provider: this.name, model: this.model ?? null, configured: this.isConfigured };
  }

  // Created lazily so the server starts (and shows a setup message) even with no API key.
  get client() {
    if (!this._client) {
      this._client = new GoogleGenAI({
        apiKey: this.apiKey,
        httpOptions: {
          ...(this.baseUrl && { baseUrl: this.baseUrl }),
          timeout: this.timeoutMs,
          // Retries are OUR job (bounded policy in ai/retry.js) so cost and latency stay predictable.
          // Measured with SDK 2.29.0: with no retryOptions the SDK sends a single request. We still pin attempts: 1
          // explicitly so a future SDK default change cannot introduce hidden retries (and hidden cost).
          retryOptions: { attempts: 1 },
        },
      });
    }
    return this._client;
  }

  buildThinkingConfig() {
    if (this.thinkingBudget !== undefined) return { thinkingBudget: this.thinkingBudget };
    if (this.thinkingLevel) return { thinkingLevel: THINKING_LEVELS[this.thinkingLevel] };
    return undefined;
  }

  async generate({ systemInstruction, messages, jsonSchema, temperature = 0.2 }) {
    if (!this.isConfigured) throw aiNotConfigured();

    const started = Date.now();
    let response;
    try {
      response = await this.client.models.generateContent({
        model: this.model,
        contents: messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
        config: {
          systemInstruction,
          temperature,
          maxOutputTokens: this.maxOutputTokens,
          responseMimeType: 'application/json',
          responseJsonSchema: jsonSchema,
          thinkingConfig: this.buildThinkingConfig(),
          abortSignal: AbortSignal.timeout(this.timeoutMs), // client-side hard stop
        },
      });
    } catch (err) {
      const mapped = mapGeminiError(err);
      const detail = String(err?.message ?? '').replace(/\s+/g, ' ').slice(0, 400);
      log.warn(`[ai] ${this.name}/${this.model} failed code=${mapped.code} status=${err?.status ?? '-'} ms=${Date.now() - started} provider_message=${detail}`);
      throw mapped;
    }

    const candidate = response.candidates?.[0];
    const blockReason = response.promptFeedback?.blockReason;
    if (blockReason) {
      throw new AiError(422, 'AI_BLOCKED', 'The AI provider declined to process this content. Try different input.');
    }
    const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const finishReason = candidate?.finishReason ?? null;
    if (!text && ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'].includes(String(finishReason))) {
      throw new AiError(422, 'AI_BLOCKED', 'The AI provider declined to process this content. Try different input.');
    }
    if (!text) {
      throw new AiError(502, 'AI_EMPTY_RESPONSE', 'The AI provider returned an empty response. Please try again.', { retryable: true });
    }

    const u = response.usageMetadata ?? {};
    const usage = {
      promptTokens: u.promptTokenCount ?? 0,
      outputTokens: u.candidatesTokenCount ?? 0,
      totalTokens: u.totalTokenCount ?? 0,
    };
    log.info(`[ai] ${this.name}/${this.model} ok finish=${finishReason} in=${usage.promptTokens} out=${usage.outputTokens} ms=${Date.now() - started}`);
    return { text, finishReason: finishReason ? String(finishReason) : null, usage };
  }
}

/** Convert an SDK/network error into a safe AiError. Provider messages are NOT forwarded to users. */
export function mapGeminiError(err) {
  if (err instanceof AiError) return err;

  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return new AiError(504, 'AI_TIMEOUT', 'The AI provider took too long to respond. Please try again.', { retryable: true, cause: err });
  }

  if (err instanceof ApiError || typeof err?.status === 'number') {
    const status = err.status;
    if (status === 429) {
      // Gemini includes a suggested wait such as "retryDelay": "34s" inside the error body.
      const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(err.message ?? '');
      const retryAfterMs = m ? Math.ceil(Number(m[1]) * 1000) : undefined;
      const hint = retryAfterMs ? ` Try again in about ${Math.ceil(retryAfterMs / 1000)} seconds.` : ' Try again in a minute.';
      return new AiError(429, 'AI_RATE_LIMITED', `The AI provider is rate limiting requests (free tiers have low limits).${hint}`,
        { retryable: true, retryAfterMs, cause: err });
    }
    if (status === 401 || status === 403) {
      return new AiError(502, 'AI_AUTH_FAILED', 'The AI provider rejected the server\'s API key. The site owner needs to check GEMINI_API_KEY.', { cause: err });
    }
    if (status === 404) {
      return new AiError(502, 'AI_MODEL_UNAVAILABLE', 'The configured AI model was not found. The site owner needs to check LLM_MODEL (run `npm run ai:check`).', { cause: err });
    }
    if (status === 400) {
      return new AiError(502, 'AI_BAD_REQUEST', 'The AI provider rejected the request. This is a server-side problem, not something you did.', { cause: err });
    }
    if (status === 408 || status >= 500) {
      return new AiError(503, 'AI_PROVIDER_UNAVAILABLE', 'The AI provider is temporarily unavailable. Please try again shortly.', { retryable: true, cause: err });
    }
    return new AiError(502, 'AI_PROVIDER_ERROR', 'The AI provider returned an unexpected error.', { cause: err });
  }

  // fetch() network failures ("TypeError: fetch failed"), DNS errors, connection resets...
  return new AiError(503, 'AI_PROVIDER_UNAVAILABLE', 'Could not reach the AI provider. Please try again shortly.', { retryable: true, cause: err });
}
