import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as ctrl from '../controllers/auth.controller.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { registerSchema, loginSchema } from '../validators/auth.validators.js';

export function createAuthRouter({ authRateLimitMax }) {
  const router = Router();

  // Slows down password guessing / mass sign-ups: N attempts per IP per 15 minutes.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: authRateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.' },
    },
  });

  router.post('/register', authLimiter, validate(registerSchema), ctrl.register);
  router.post('/login', authLimiter, validate(loginSchema), ctrl.login);
  router.post('/logout', ctrl.logout);
  router.post('/logout-all', requireAuth, ctrl.logoutAll);
  router.get('/me', requireAuth, ctrl.me);

  return router;
}
