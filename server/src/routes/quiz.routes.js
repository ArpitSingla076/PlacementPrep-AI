import { Router } from 'express';
import * as ctrl from '../controllers/quiz.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAiConsent } from '../middleware/aiConsent.js';
import { validate, validateQuery, validateObjectId } from '../middleware/validate.js';
import { paginationSchema } from '../utils/pagination.js';
import { createQuizSchema, submitQuizSchema } from '../validators/quiz.validators.js';

export function createQuizRouter(deps) {
  const r = Router();
  r.use(requireAuth);
  r.get('/', validateQuery(paginationSchema), ctrl.list);
  r.post('/', validate(createQuizSchema), requireAiConsent, ctrl.create(deps)); // creating sends passages to the AI provider
  r.get('/:id', validateObjectId(), ctrl.get);
  r.post('/:id/submit', validateObjectId(), validate(submitQuizSchema), ctrl.submit); // grading needs no AI, so no consent gate
  r.delete('/:id', validateObjectId(), ctrl.remove);
  return r;
}
