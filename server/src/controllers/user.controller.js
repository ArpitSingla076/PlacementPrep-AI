import * as userService from '../services/user.service.js';
import * as account from '../services/account.service.js';
import * as authService from '../services/auth.service.js';
import { sendSuccess } from '../utils/response.js';
import { setSessionCookie, clearSessionCookie } from '../utils/cookies.js';

export async function updateMe(req, res) {
  // req.user._id comes from the verified session, never from the request body or URL.
  sendSuccess(res, { user: await userService.updateProfile(req.user._id, req.body) });
}

export async function exportMe(req, res) {
  const data = await account.exportData(req.user._id);
  res.setHeader('Content-Disposition', 'attachment; filename="placementprep-export.json"');
  sendSuccess(res, data);
}

export async function changePassword(req, res) {
  const user = await account.changePassword(req.user._id, req.body);
  const { token, csrfToken } = authService.issueSession(user); // keep THIS device signed in; all others are signed out
  setSessionCookie(res, token);
  sendSuccess(res, { changed: true, csrfToken });
}

export async function deleteMe(req, res) {
  const result = await account.deleteAccount(req.user._id, req.body.password);
  clearSessionCookie(res);
  sendSuccess(res, result);
}
