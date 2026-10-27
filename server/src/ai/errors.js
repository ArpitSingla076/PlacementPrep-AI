import { AppError } from '../utils/AppError.js';

/**
 * Every provider failure is converted into an AiError with a stable `code`, a safe user-facing message,
 * and `retryable` (should the retry policy try again?). Raw provider messages are never sent to the client.
 */
export class AiError extends AppError {
  constructor(status, code, message, { retryable = false, retryAfterMs, cause } = {}) {
    super(status, code, message);
    this.name = 'AiError';
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    if (cause) this.cause = cause;
  }
}

export const aiNotConfigured = () =>
  new AiError(503, 'AI_NOT_CONFIGURED',
    'The AI provider is not configured on this server. Set GEMINI_API_KEY and LLM_MODEL in server/.env, then restart.');
