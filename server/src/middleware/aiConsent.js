import { AppError } from '../utils/AppError.js';

/**
 * Gate for every route that sends user content to the external AI provider.
 * Consent is read from the VERIFIED user record (req.user), never from the request body.
 */
export function requireAiConsent(req, _res, next) {
  if (req.user?.preferences?.aiDataConsent?.given !== true) {
    throw new AppError(403, 'AI_CONSENT_REQUIRED',
      'Turn on "Allow AI processing" in Settings before using this feature. Nothing is sent to the AI provider without it.');
  }
  next();
}
