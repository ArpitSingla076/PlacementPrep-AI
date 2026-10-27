import * as authService from '../services/auth.service.js';
import { sendSuccess } from '../utils/response.js';
import { setSessionCookie, clearSessionCookie } from '../utils/cookies.js';

// Controllers stay thin: read the request, call a service, shape the response.

function startSession(res, user) {
  const { token, csrfToken } = authService.issueSession(user);
  setSessionCookie(res, token);
  return csrfToken;
}

export async function register(req, res) {
  const user = await authService.registerUser(req.body);
  const csrfToken = startSession(res, user);
  sendSuccess(res, { user, csrfToken }, 201);
}

export async function login(req, res) {
  const user = await authService.authenticate(req.body);
  const csrfToken = startSession(res, user);
  sendSuccess(res, { user, csrfToken });
}

export function logout(_req, res) {
  clearSessionCookie(res);
  sendSuccess(res, { loggedOut: true });
}

export async function logoutAll(req, res) {
  await authService.invalidateAllSessions(req.user._id);
  clearSessionCookie(res);
  sendSuccess(res, { loggedOut: true });
}

// Called by the frontend on every page load to restore the session.
// Returns the CSRF token again because the SPA keeps it only in memory.
export function me(req, res) {
  sendSuccess(res, { user: req.user, csrfToken: req.csrfToken });
}
