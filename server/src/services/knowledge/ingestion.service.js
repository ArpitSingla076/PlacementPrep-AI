import { KnowledgeDocument } from '../../models/KnowledgeDocument.js';
import { DocumentChunk } from '../../models/DocumentChunk.js';
import { ChatConversation } from '../../models/ChatConversation.js';
import { QuizSession } from '../../models/QuizSession.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { paginate } from '../../utils/pagination.js';
import { log } from '../../utils/logger.js';
import { aiNotConfigured } from '../../ai/errors.js';
import { chunkPages } from '../../ai/rag/chunker.js';
import { safeFilename } from '../../middleware/upload.js';
import { extractPdfText, looksLikePdf } from '../pdf.service.js';
import { sha256 } from '../resume.service.js';

const MIN_DOC_CHARS = 100;

// Background jobs in this process. Tests (and graceful shutdown) can wait for them to finish.
const pending = new Set();
export const waitForIngestion = () => Promise.allSettled([...pending]);

/**
 * Validate and parse the PDF synchronously (fast, and the user needs immediate feedback), then embed in the
 * BACKGROUND: embedding many chunks can take a while and must not hold the HTTP request open.
 * The client polls GET /api/documents until status is "ready" or "failed".
 */
export async function createDocument(userId, file, { embedder, quota }) {
  if (!file) throw new AppError(400, 'FILE_REQUIRED', 'Choose a PDF file to upload (form field "file").');
  if (!looksLikePdf(file.buffer)) throw new AppError(400, 'INVALID_FILE_TYPE', 'This file is not a valid PDF, even though it may be named .pdf.');

  const { pages, pageCount } = await extractPdfText(file.buffer, { maxPages: env.MAX_DOC_PAGES });
  return ingestParsedPages(userId, { filename: safeFilename(file.originalname), sizeBytes: file.size, pageCount, pages }, { embedder, quota });
}

/** Everything after PDF parsing: validate, de-duplicate, chunk, create the record, start background embedding. */
export async function ingestParsedPages(userId, { filename, sizeBytes, pageCount, pages }, { embedder, quota }) {
  const fullText = pages.join('\n\n');
  if (fullText.length < MIN_DOC_CHARS) {
    throw new AppError(422, 'PDF_NO_TEXT', 'We could not find enough text in this PDF. Scanned or image-only PDFs are not supported.');
  }

  const contentHash = sha256(fullText);
  const existing = await KnowledgeDocument.findOne({ userId, contentHash });
  if (existing) return { document: existing, duplicate: true };

  if ((await KnowledgeDocument.countDocuments({ userId })) >= env.MAX_DOCS_PER_USER) {
    throw new AppError(409, 'DOCUMENT_LIMIT_REACHED', `You can keep up to ${env.MAX_DOCS_PER_USER} documents. Delete one to add another.`);
  }

  const chunking = { size: env.CHUNK_SIZE_CHARS, overlap: env.CHUNK_OVERLAP_CHARS };
  const chunks = chunkPages(pages, chunking);
  if (chunks.length === 0) throw new AppError(422, 'PDF_NO_TEXT', 'We could not find enough text in this PDF.');
  if (chunks.length > env.MAX_CHUNKS_PER_DOC) {
    throw new AppError(422, 'DOC_TOO_LARGE', `This document would create ${chunks.length} passages (limit ${env.MAX_CHUNKS_PER_DOC}). Upload a shorter document or split it.`);
  }

  if (!embedder.isConfigured) throw aiNotConfigured();
  quota.consume(userId);

  let document;
  try {
    document = await KnowledgeDocument.create({
      userId, filename, sizeBytes, pageCount, charCount: fullText.length, contentHash,
      status: 'processing', chunkCount: chunks.length, embeddingModel: embedder.model, embeddingDimensions: embedder.dimensions, chunking,
    });
  } catch (err) {
    quota.refund(userId);
    if (err?.code === 11000) return { document: await KnowledgeDocument.findOne({ userId, contentHash }), duplicate: true }; // upload race
    throw err;
  }

  const job = processDocument({ document, chunks }, { embedder, quota }).finally(() => pending.delete(job));
  pending.add(job);
  return { document, duplicate: false };
}

async function processDocument({ document, chunks }, { embedder, quota }) {
  const userId = document.userId;
  const docId = document._id;
  try {
    const hashes = chunks.map((c) => sha256(c.text));

    // Avoid duplicate embedding generation: reuse vectors this user already has for identical text from the same model.
    const reusable = await DocumentChunk.find({
      userId, textHash: { $in: [...new Set(hashes)] }, embeddingModel: embedder.model, ...(embedder.dimensions && { embeddingDimensions: embedder.dimensions }),
    }).select('+embedding textHash').lean();
    const known = new Map(reusable.map((c) => [c.textHash, c.embedding]));

    const alreadyHad = new Set(known.keys());
    // Embed each DISTINCT missing text once (repeated headers/boilerplate inside one document share a vector).
    const textByHash = new Map(chunks.map((c, i) => [hashes[i], c.text]));
    const toEmbed = [...new Set(hashes.filter((h) => !known.has(h)))];
    const fresh = toEmbed.length ? await embedder.embed({ texts: toEmbed.map((h) => textByHash.get(h)), kind: 'document' }) : [];
    toEmbed.forEach((h, k) => known.set(h, fresh[k]));

    const vectors = hashes.map((h) => known.get(h));
    const dims = vectors[0].length;
    if (vectors.some((v) => v.length !== dims)) {
      throw new AppError(502, 'AI_EMBEDDING_DIMENSION_MISMATCH', 'Stored and new vectors have different sizes. Check EMBEDDING_DIMENSIONS.');
    }

    // The user may have deleted the document while we were embedding: then discard everything.
    if (!(await KnowledgeDocument.exists({ _id: docId, userId }))) return;

    // Chunks are written only now, after ALL embeddings succeeded: a failure never leaves a half-indexed document.
    await DocumentChunk.insertMany(chunks.map((c, i) => ({
      userId, documentId: docId, chunkIndex: i, text: c.text, textHash: hashes[i], pageStart: c.pageStart, pageEnd: c.pageEnd,
      embedding: vectors[i], embeddingModel: embedder.model, embeddingDimensions: dims,
    })));
    if (!(await KnowledgeDocument.exists({ _id: docId, userId }))) { await DocumentChunk.deleteMany({ documentId: docId }); return; }

    await KnowledgeDocument.updateOne({ _id: docId, userId }, {
      status: 'ready', embeddingModel: embedder.model, embeddingDimensions: dims, reusedEmbeddings: hashes.filter((h) => alreadyHad.has(h)).length, processedAt: new Date(),
    });
    log.info(`[rag] document ${docId} ready: ${chunks.length} chunks (${toEmbed.length} embedded, rest reused)`);
  } catch (err) {
    quota.refund(userId);
    log.warn(`[rag] document ${docId} failed: ${err.code ?? err.name}`);
    await DocumentChunk.deleteMany({ documentId: docId }).catch(() => {});
    await KnowledgeDocument.updateOne({ _id: docId, userId }, {
      status: 'failed',
      error: { code: err.code ?? 'PROCESSING_FAILED', message: err instanceof AppError ? err.message : 'Processing failed unexpectedly. Please delete this document and try again.' },
    }).catch(() => {});
  }
}

/** Run once at startup: background jobs do not survive a restart, so documents left "processing" would hang forever. */
export async function recoverStaleDocuments() {
  const { modifiedCount } = await KnowledgeDocument.updateMany({ status: 'processing' }, {
    status: 'failed', error: { code: 'INTERRUPTED', message: 'Processing was interrupted by a server restart. Delete this document and upload it again.' },
  });
  if (modifiedCount) log.warn(`[rag] marked ${modifiedCount} interrupted document(s) as failed`);
  return modifiedCount;
}

export const listDocuments = (userId, paging) => paginate(KnowledgeDocument, { userId }, paging);

export async function getDocument(userId, id) {
  const doc = await KnowledgeDocument.findOne({ _id: id, userId });
  if (!doc) throw new AppError(404, 'NOT_FOUND', 'Document not found.');
  return doc;
}

/**
 * Deletes the document, every one of its chunks and vectors, and the stored passage text that chat citations kept.
 * (The generated answer text in old conversations is kept: it is the assistant's own output. See README.)
 */
export async function deleteDocument(userId, id) {
  const doc = await getDocument(userId, id);
  const { deletedCount: deletedChunks } = await DocumentChunk.deleteMany({ documentId: doc._id, userId });
  await KnowledgeDocument.deleteOne({ _id: doc._id, userId });

  const conversations = await ChatConversation.find({ userId, 'messages.sources.documentId': doc._id });
  for (const conv of conversations) {
    for (const m of conv.messages) for (const s of m.sources ?? []) {
      if (String(s.documentId) === String(doc._id)) { s.documentDeleted = true; s.text = ''; }
    }
    conv.markModified('messages');
    await conv.save();
  }
  const quizzes = await QuizSession.find({ userId, 'questions.source.documentId': doc._id });
  for (const quiz of quizzes) {
    for (const q of quiz.questions) if (String(q.source?.documentId) === String(doc._id)) { q.source.documentDeleted = true; q.source.text = ''; }
    quiz.markModified('questions');
    await quiz.save();
  }
  return { deletedChunks };
}
