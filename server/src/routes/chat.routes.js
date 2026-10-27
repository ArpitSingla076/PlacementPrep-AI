import { Router } from 'express';
import * as ctrl from '../controllers/chat.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAiConsent } from '../middleware/aiConsent.js';
import { validate, validateQuery, validateObjectId } from '../middleware/validate.js';
import { paginationSchema } from '../utils/pagination.js';
import { askSchema } from '../validators/chat.validators.js';

export function createChatRouter(deps) {
  const router = Router();
  router.use(requireAuth);
  router.get('/conversations', validateQuery(paginationSchema), ctrl.listConversations);
  router.get('/conversations/:id', validateObjectId(), ctrl.getConversation);
  router.delete('/conversations/:id', validateObjectId(), ctrl.removeConversation);
  // validate input -> consent -> only then touch retrieval / the AI provider
  router.post('/ask', validate(askSchema), requireAiConsent, ctrl.ask(deps));
  return router;
}
