import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Defence in depth against CSRF. Browsers always attach an Origin header to cross-site POSTs.
 * If one arrives from an origin other than our frontend, reject it.
 * Requests with no Origin (curl, Postman, server-to-server) are allowed: CSRF is a browser-only attack.
 */
export function originCheck(req, _res, next) {
  if (UNSAFE_METHODS.has(req.method)) {
    const origin = req.get('origin');
    if (origin && origin !== env.CLIENT_ORIGIN) {
      throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed.');
    }
  }
  next();
}
