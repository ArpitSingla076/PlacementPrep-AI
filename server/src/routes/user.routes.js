import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as ctrl from '../controllers/user.controller.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { updateProfileSchema, changePasswordSchema, deleteAccountSchema } from '../validators/user.validators.js';

export function createUserRouter({ authRateLimitMax }) {
  const router = Router();
  // Password-checking endpoints get the same strict limiter as login (guessing the password through them must be as hard).
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: authRateLimitMax, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.' } } });

  router.patch('/me', requireAuth, validate(updateProfileSchema), ctrl.updateMe);
  router.get('/me/export', requireAuth, ctrl.exportMe);
  router.post('/me/password', requireAuth, limiter, validate(changePasswordSchema), ctrl.changePassword);
  router.delete('/me', requireAuth, limiter, validate(deleteAccountSchema), ctrl.deleteMe);
  return router;
}
