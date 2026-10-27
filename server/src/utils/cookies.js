import { env } from '../config/env.js';

export const SESSION_COOKIE = 'pp_session';

const baseOptions = () => ({
  httpOnly: true, // JavaScript cannot read it => XSS cannot steal the token
  secure: env.IS_PROD || env.COOKIE_SAMESITE === 'none', // browsers require Secure with SameSite=None
  sameSite: env.COOKIE_SAMESITE,
  path: '/api', // only sent to API routes
});

export function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    ...baseOptions(),
    maxAge: env.SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res) {
  // Must use the same path/options used when setting, or the browser keeps the cookie.
  res.clearCookie(SESSION_COOKIE, baseOptions());
}
