import { AiError } from './errors.js';

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Controlled retry: at most `retries` extra attempts, only for errors marked retryable,
 * exponential backoff with jitter. If the provider tells us to wait longer than `maxWaitMs`
 * (e.g. a daily quota), we stop immediately instead of holding the user's request open.
 * There is no unbounded loop anywhere.
 */
export async function withRetry(fn, { retries, baseMs, maxWaitMs = 20_000, sleep = defaultSleep, onRetry } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      const canRetry = err instanceof AiError && err.retryable && attempt < retries;
      if (!canRetry) throw err;
      const backoff = baseMs * 2 ** attempt * (0.5 + Math.random() * 0.5);
      const delay = err.retryAfterMs ?? backoff;
      if (delay > maxWaitMs) throw err;
      onRetry?.({ attempt: attempt + 1, delay, code: err.code });
      await sleep(delay);
    }
  }
}
