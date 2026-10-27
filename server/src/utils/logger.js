import { env } from '../config/env.js';

/**
 * Tiny logger. Rules: log operational facts (provider, model, status, timings, token counts);
 * NEVER log prompts, resume text, document text, API keys or request bodies.
 */
const enabled = !env.IS_TEST;
export const log = {
  info: (...a) => enabled && console.info(...a),
  warn: (...a) => enabled && console.warn(...a),
  error: (...a) => enabled && console.error(...a),
};
