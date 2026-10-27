import crypto from 'node:crypto';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { SESSION_COOKIE } from '../utils/cookies.js';
import { verifySessionToken } from '../services/auth.service.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y); // constant-time compare
}

/**
 * Protects a route. After this runs, req.user is the signed-in user.
 * Every data query in later milestones MUST filter by req.user._id - that is what enforces
 * "users can only access their own resumes, documents, interviews...".
 *
 * (Express 5 forwards errors thrown/rejected in async middleware to the error handler automatically.)
 */
export async function requireAuth(req, _res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');

  let payload;
  try {
    payload = verifySessionToken(token);
  } catch {
    throw new AppError(401, 'SESSION_EXPIRED', 'Your session is invalid or has expired. Please sign in again.');
  }

  const user = await User.findById(payload.sub).select('+tokenVersion');
  if (!user || (user.tokenVersion ?? 0) !== payload.tv) {
    throw new AppError(401, 'SESSION_EXPIRED', 'Your session is invalid or has expired. Please sign in again.');
  }

  // CSRF check for anything that changes state.
  if (UNSAFE_METHODS.has(req.method)) {
    const header = req.get('x-csrf-token');
    if (!header || !safeEqual(header, payload.csrf)) {
      throw new AppError(403, 'CSRF_FAILED', 'Security token missing or invalid. Refresh the page and try again.');
    }
  }

  req.user = user;
  req.csrfToken = payload.csrf;
  next();
}
