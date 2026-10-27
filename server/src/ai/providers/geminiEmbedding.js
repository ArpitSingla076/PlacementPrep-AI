import { GoogleGenAI } from '@google/genai';
import { AiError, aiNotConfigured } from '../errors.js';
import { withRetry } from '../retry.js';
import { mapGeminiError } from './gemini.js';
import { log } from '../../utils/logger.js';

export function l2Normalize(vec) {
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? vec : vec.map((x) => x / norm);
}

/**
 * Gemini embeddings (`ai.models.embedContent`).
 *
 * Contract for any embedding provider:
 *   name, model, dimensions, isConfigured, describe(), embed({ texts, kind }) -> number[][] (one unit-length vector per text)
 *
 * Defensive choices (each guards a risk found while reading the SDK/cookbook, see docs/AI_PROVIDER_NOTES.md):
 *  - every text is wrapped in its own Content, because the cookbook shows a list of mixed inputs can be merged into ONE embedding;
 *  - we verify we got exactly one vector per text, and that every vector has the expected dimension;
 *  - we L2-normalise every vector ourselves, so cosine/dot-product search is correct even if the API returns truncated, non-unit vectors.
 */
export class GeminiEmbeddingProvider {
  name = 'gemini';

  constructor({ apiKey, model, dimensions, baseUrl, timeoutMs = 60_000, batchSize = 16, useTaskType = true, retries = 2, retryBaseMs = 1500, sleep }) {
    Object.assign(this, { apiKey, model, dimensions, baseUrl, timeoutMs, batchSize, useTaskType, retries, retryBaseMs, sleep });
    this._client = null;
  }

  get isConfigured() {
    return Boolean(this.apiKey && this.model);
  }

  describe() {
    return { provider: this.name, model: this.model ?? null, dimensions: this.dimensions ?? null, configured: this.isConfigured };
  }

  get client() {
    if (!this._client) {
      this._client = new GoogleGenAI({
        apiKey: this.apiKey,
        httpOptions: { ...(this.baseUrl && { baseUrl: this.baseUrl }), timeout: this.timeoutMs, retryOptions: { attempts: 1 } },
      });
    }
    return this._client;
  }

  /** kind: 'document' (text being indexed) or 'query' (a user question). */
  async embed({ texts, kind = 'document' }) {
    if (!this.isConfigured) throw aiNotConfigured();
    const out = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const vectors = await withRetry(() => this.#embedBatch(batch, kind), { retries: this.retries, baseMs: this.retryBaseMs, sleep: this.sleep });
      out.push(...vectors);
    }
    return out;
  }

  async #embedBatch(batch, kind) {
    const started = Date.now();
    let res;
    try {
      res = await this.client.models.embedContent({
        model: this.model,
        contents: batch.map((text) => ({ parts: [{ text }] })),
        config: {
          ...(this.useTaskType && { taskType: kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT' }),
          ...(this.dimensions && { outputDimensionality: this.dimensions }),
          abortSignal: AbortSignal.timeout(this.timeoutMs),
        },
      });
    } catch (err) {
      const mapped = mapGeminiError(err);
      const detail = String(err?.message ?? '').replace(/\s+/g, ' ').slice(0, 400);
      log.warn(`[ai] embed ${this.model} failed code=${mapped.code} status=${err?.status ?? '-'} ms=${Date.now() - started} provider_message=${detail}`);
      throw mapped;
    }

    const vectors = (res.embeddings ?? []).map((e) => e.values ?? []);
    if (vectors.length !== batch.length) {
      throw new AiError(502, 'AI_EMBEDDING_COUNT_MISMATCH', `The embedding provider returned ${vectors.length} vectors for ${batch.length} texts.`);
    }
    for (const v of vectors) {
      if (v.length === 0 || (this.dimensions && v.length !== this.dimensions)) {
        throw new AiError(502, 'AI_EMBEDDING_DIMENSION_MISMATCH',
          `The embedding model returned ${v.length} dimensions but EMBEDDING_DIMENSIONS is ${this.dimensions ?? '(unset)'}. Fix the setting (run npm run ai:check) and make sure the vector index uses the same number.`);
      }
      if (v.length !== vectors[0].length) throw new AiError(502, 'AI_EMBEDDING_DIMENSION_MISMATCH', 'The embedding provider returned vectors of different sizes.');
    }
    log.info(`[ai] embed ${this.model} ok n=${batch.length} dims=${vectors[0]?.length} ms=${Date.now() - started}`);
    return vectors.map(l2Normalize);
  }
}
