import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

export function notFound(req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found.`));
}

// Express recognises an error handler by its 4 arguments - keep all four even if `next` is unused.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong on our side. Please try again.';
  let details;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err?.type === 'entity.parse.failed') {
    status = 400; code = 'INVALID_JSON'; message = 'Request body is not valid JSON.';
  } else if (err?.type === 'entity.too.large') {
    status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request body is too large.';
  } else if (err?.name === 'MulterError') {
    // Upload problems: size limit, too many files, unexpected field.
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR';
    message = err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large. Try a smaller PDF.' : 'Upload one PDF using the form field "file".';
  } else if (err?.name === 'ValidationError') {
    // Mongoose schema validation (a second safety net behind Zod).
    status = 400; code = 'VALIDATION_ERROR'; message = 'Some fields are invalid.';
  }

  if (status >= 500 && err?.name !== 'AiError') { // provider errors are already logged where they happen
    // Log the error for us (name + message + stack in dev). Never echo it to the client,
    // and never log request bodies - they may contain passwords or private documents.
    console.error(`[error] ${req.method} ${req.path} -> ${err?.name}: ${err?.message}`);
    if (!env.IS_PROD && !env.IS_TEST) console.error(err?.stack);
  }

  res.status(status).json({ success: false, error: { code, message, ...(details && { details }) } });
}
