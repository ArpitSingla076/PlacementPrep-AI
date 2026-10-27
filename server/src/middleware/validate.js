import mongoose from 'mongoose';
import { AppError } from '../utils/AppError.js';

const fail = (issues) => new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.',
  issues.map((i) => ({ field: i.path.join('.'), message: i.message })));

/**
 * validate(schema) parses req.body with Zod. On success req.body is REPLACED by the parsed value
 * (trimmed, coerced, unknown keys rejected), so controllers only ever see clean data.
 */
export const validate = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) return next(fail(result.error.issues));
  req.body = result.data;
  next();
};

/** Same for the query string. (Express 5 makes req.query read-only, so the parsed value goes on req.validatedQuery.) */
export const validateQuery = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.query ?? {});
  if (!result.success) return next(fail(result.error.issues));
  req.validatedQuery = result.data;
  next();
};

/** A malformed id can never match anything, so answer 404 (same as "not yours") instead of leaking a CastError. */
export const validateObjectId = (param = 'id') => (req, _res, next) => {
  if (!mongoose.isValidObjectId(req.params[param])) return next(new AppError(404, 'NOT_FOUND', 'Not found.'));
  next();
};
