import crypto from 'node:crypto';
import { Resume } from '../models/Resume.js';
import { JobAnalysis } from '../models/JobAnalysis.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { paginate } from '../utils/pagination.js';
import { safeFilename } from '../middleware/upload.js';
import { extractPdfText, looksLikePdf } from './pdf.service.js';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export async function createResume(userId, file) {
  if (!file) throw new AppError(400, 'FILE_REQUIRED', 'Choose a PDF file to upload (form field "file").');
  if (!looksLikePdf(file.buffer)) {
    throw new AppError(400, 'INVALID_FILE_TYPE', 'This file is not a valid PDF, even though it may be named .pdf.');
  }

  const { text, pageCount } = await extractPdfText(file.buffer);

  if (text.length < env.MIN_RESUME_CHARS) {
    throw new AppError(422, 'PDF_NO_TEXT',
      'We could not find enough text in this PDF. Scanned or image-only PDFs are not supported: export a text-based PDF from your editor.');
  }
  if (text.length > env.MAX_RESUME_CHARS) {
    throw new AppError(422, 'RESUME_TOO_LONG', `This resume has too much text (limit ${env.MAX_RESUME_CHARS.toLocaleString()} characters).`);
  }

  const textHash = sha256(text);
  const existing = await Resume.findOne({ userId, textHash });
  if (existing) return { resume: existing, duplicate: true };

  if ((await Resume.countDocuments({ userId })) >= env.MAX_RESUMES_PER_USER) {
    throw new AppError(409, 'RESUME_LIMIT_REACHED', `You can store up to ${env.MAX_RESUMES_PER_USER} resumes. Delete one to upload another.`);
  }

  try {
    const resume = await Resume.create({
      userId, originalFilename: safeFilename(file.originalname), sizeBytes: file.size,
      pageCount, charCount: text.length, extractedText: text, textHash,
    });
    return { resume, duplicate: false };
  } catch (err) {
    if (err?.code === 11000) return { resume: await Resume.findOne({ userId, textHash }), duplicate: true }; // upload race
    throw err;
  }
}

export const listResumes = (userId, paging) => paginate(Resume, { userId }, paging);

export async function getResume(userId, id) {
  const resume = await Resume.findOne({ _id: id, userId });
  if (!resume) throw new AppError(404, 'NOT_FOUND', 'Resume not found.');
  return resume;
}

/** Deleting a resume also deletes the analyses made from it: they contain quotes from that resume. */
export async function deleteResume(userId, id) {
  const resume = await getResume(userId, id);
  const { deletedCount } = await JobAnalysis.deleteMany({ userId, resumeId: resume._id });
  await Resume.deleteOne({ _id: resume._id, userId });
  return { deletedAnalyses: deletedCount };
}
