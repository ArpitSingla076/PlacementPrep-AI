import { Router } from 'express';
import * as ctrl from '../controllers/document.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAiConsent } from '../middleware/aiConsent.js';
import { uploadDocumentPdf } from '../middleware/upload.js';
import { validateQuery, validateObjectId } from '../middleware/validate.js';
import { paginationSchema } from '../utils/pagination.js';

export function createDocumentRouter(deps) {
  const router = Router();
  router.use(requireAuth);
  router.get('/', validateQuery(paginationSchema), ctrl.list);
  // Upload sends the document text to the embedding provider, so it needs AI consent (unlike resume upload).
  router.post('/', requireAiConsent, uploadDocumentPdf, ctrl.upload(deps));
  router.get('/:id', validateObjectId(), ctrl.get);
  router.delete('/:id', validateObjectId(), ctrl.remove);
  return router;
}
