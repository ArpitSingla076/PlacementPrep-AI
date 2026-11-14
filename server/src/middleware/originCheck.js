import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { log } from '../utils/logger.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Defence in depth against CSRF. Browsers always attach an Origin header to cross-site POSTs.
 * If one arrives from an origin other than our frontend, reject it.
 * Requests with no Origin (curl, Postman, server-to-server) are allowed: CSRF is a browser-only attack.
 */
export function originCheck(req, _res, next) {
  if (UNSAFE_METHODS.has(req.method)) {
    const origin = req.get('origin');
    if (origin && !env.CLIENT_ORIGINS.includes(origin)) {
      log.warn(`[origin-check] rejected ${req.method} from ${origin}. Allowed: ${env.CLIENT_ORIGINS.join(', ')}`);
      throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'This website is not allowed to use this server. The site owner needs to add it to CLIENT_URL.');
    }
  }
  next();
}
