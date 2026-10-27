import { Router } from 'express';
import * as ctrl from '../controllers/interview.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAiConsent } from '../middleware/aiConsent.js';
import { validate, validateQuery, validateObjectId } from '../middleware/validate.js';
import { paginationSchema } from '../utils/pagination.js';
import { createInterviewSchema, answerSchema } from '../validators/interview.validators.js';

export function createInterviewRouter(deps) {
  const router = Router();
  router.use(requireAuth);
  router.get('/', validateQuery(paginationSchema), ctrl.list);
  router.post('/', validate(createInterviewSchema), requireAiConsent, ctrl.create(deps));
  router.get('/:id', validateObjectId(), ctrl.get);
  router.post('/:id/answers', validateObjectId(), validate(answerSchema), requireAiConsent, ctrl.answer(deps));
  router.post('/:id/complete', validateObjectId(), ctrl.complete);
  router.delete('/:id', validateObjectId(), ctrl.remove);
  return router;
}
