import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { sendSuccess } from '../utils/response.js';

/** Lets the UI show a setup message BEFORE the user wastes time filling in a form. Never returns secrets. */
export function createAiRouter({ llm, quota, embedder, chatQuota, ingestQuota, vectorMode }) {
  const router = Router();
  router.get('/status', requireAuth, (req, res) => {
    sendSuccess(res, {
      ...llm.describe(), // { provider, model, configured } - the model name is not a secret
      consentGiven: req.user.preferences?.aiDataConsent?.given === true,
      embedding: embedder.describe(),
      knowledge: { vectorSearchMode: vectorMode, questions: { limit: chatQuota.limit, remaining: chatQuota.remaining(req.user._id) }, uploads: { limit: ingestQuota.limit, remaining: ingestQuota.remaining(req.user._id) } },
      quota: { limit: quota.limit, remaining: quota.remaining(req.user._id), windowMinutes: quota.windowMs / 60_000 },
    });
  });
  return router;
}
