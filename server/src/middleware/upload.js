import path from 'node:path';
import multer from 'multer';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

/**
 * File upload handling.
 *  - memoryStorage: the file is NEVER written to disk by us => no path traversal, nothing to clean up, nothing to execute.
 *  - limits: one file, size cap (MAX_UPLOAD_MB), no extra text fields beyond a small number.
 *  - fileFilter is only an early, cheap check. The real validation is in the service: magic bytes + successful parse.
 */
function createPdfUpload(maxBytes) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 5, parts: 7 },
    fileFilter(_req, file, cb) {
      const okType = file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf';
      cb(okType ? null : new AppError(400, 'INVALID_FILE_TYPE', 'Only PDF files are supported.'), okType);
    },
  }).single('file');
}

export const uploadSinglePdf = createPdfUpload(env.MAX_UPLOAD_BYTES); // resumes
export const uploadDocumentPdf = createPdfUpload(env.MAX_DOC_UPLOAD_BYTES); // study notes

/** Strip any directory part and control characters from a client-supplied filename. */
export function safeFilename(name) {
  const base = path.basename(String(name ?? '').replace(/\\/g, '/'));
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001F\u007F<>:"|?*]/g, '').trim();
  return (cleaned || 'resume.pdf').slice(0, 120);
}
