/**
 * An error we throw on purpose, with an HTTP status and a stable machine-readable code.
 * The frontend branches on `code` (not on message text); users read `message`.
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
