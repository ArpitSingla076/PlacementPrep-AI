import { Router } from 'express';
import * as ctrl from '../controllers/jobAnalysis.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAiConsent } from '../middleware/aiConsent.js';
import { validate, validateQuery, validateObjectId } from '../middleware/validate.js';
import { paginationSchema } from '../utils/pagination.js';
import { createAnalysisSchema } from '../validators/analysis.validators.js';
import { compareQuerySchema } from '../validators/application.validators.js';
import { compareAnalyses } from '../services/analysis/compare.js';
import { sendSuccess } from '../utils/response.js';

export function createJobAnalysisRouter(deps) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', validateQuery(paginationSchema), ctrl.list);
  // Order matters: validate input -> check consent -> only then touch the AI provider.
  router.post('/', validate(createAnalysisSchema), requireAiConsent, ctrl.create(deps));
  router.get('/compare', validateQuery(compareQuerySchema), async (req, res) => sendSuccess(res, { comparison: await compareAnalyses(req.user._id, req.validatedQuery.a, req.validatedQuery.b) }));
  router.get('/:id', validateObjectId(), ctrl.get);
  router.delete('/:id', validateObjectId(), ctrl.remove);
  return router;
}
