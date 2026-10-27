import { getDocumentProxy, extractText } from 'unpdf';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

/** The file must START like a PDF. We do not trust the filename extension or the browser-supplied MIME type. */
export function looksLikePdf(buffer) {
  return buffer.length > 8 && buffer.subarray(0, 1024).toString('latin1').includes('%PDF-');
}

/** Tidy extracted text: unify line endings, collapse runs of spaces and blank lines. Keeps single line breaks (bullets). */
export function normalizeText(text) {
  return text
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex -- stripping control characters is the purpose of this expression
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[ \t\u00A0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract text page by page (page numbers will matter for citations in the RAG milestone).
 * Throws AppError with a user-friendly message for unreadable / encrypted / too-long / image-only PDFs.
 */
export async function extractPdfText(buffer, { maxPages = env.MAX_RESUME_PAGES } = {}) {
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer));
  } catch (err) {
    const encrypted = /password/i.test(err?.name ?? '') || /password|encrypt/i.test(err?.message ?? '');
    throw new AppError(422, encrypted ? 'PDF_ENCRYPTED' : 'PDF_UNREADABLE',
      encrypted ? 'This PDF is password-protected. Remove the password and upload it again.' : 'We could not read this PDF. It may be corrupted. Try exporting it again.');
  }

  if (pdf.numPages > maxPages) {
    await pdf.destroy?.();
    throw new AppError(422, 'PDF_TOO_MANY_PAGES', `This PDF has ${pdf.numPages} pages. Up to ${maxPages} pages are supported.`);
  }

  try {
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = (Array.isArray(text) ? text : [text]).map(normalizeText);
    return { pages, pageCount: pdf.numPages, text: pages.filter(Boolean).join('\n\n') };
  } catch {
    throw new AppError(422, 'PDF_UNREADABLE', 'We could not read the text in this PDF. Try exporting it again.');
  } finally {
    await pdf.destroy?.();
  }
}
