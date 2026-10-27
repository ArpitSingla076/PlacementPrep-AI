import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAiConsent } from '../middleware/aiConsent.js';
import { validate, validateQuery } from '../middleware/validate.js';
import { sendSuccess } from '../utils/response.js';
import * as plans from '../services/plan/plan.service.js';
import { getProgress } from '../services/progress.service.js';
import { generatePlanSchema, completeItemSchema, progressQuerySchema } from '../validators/plan.validators.js';

export function createPlanRouter(deps) {
  const r = Router();
  r.use(requireAuth);
  r.get('/current', async (req, res) => sendSuccess(res, { plan: await plans.getCurrentPlan(req.user._id) }));
  r.post('/generate', validate(generatePlanSchema), requireAiConsent, async (req, res) => sendSuccess(res, { plan: await plans.generatePlan(req.user, req.body, deps) }, 201));
  r.patch('/current/items/:key', validate(completeItemSchema), async (req, res) => sendSuccess(res, { plan: await plans.setItemCompleted(req.user._id, req.params.key, req.body.completed) }));
  return r;
}

export function createProgressRouter() {
  const r = Router();
  r.use(requireAuth);
  r.get('/summary', validateQuery(progressQuerySchema), async (req, res) => sendSuccess(res, await getProgress(req.user._id, req.validatedQuery)));
  return r;
}
