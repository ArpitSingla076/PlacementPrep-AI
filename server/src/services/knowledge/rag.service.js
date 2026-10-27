import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { KnowledgeDocument } from '../../models/KnowledgeDocument.js';
import { ChatConversation, MAX_MESSAGES_PER_CONVERSATION } from '../../models/ChatConversation.js';
import { AppError } from '../../utils/AppError.js';
import { paginate } from '../../utils/pagination.js';
import { aiNotConfigured } from '../../ai/errors.js';
import { generateStructured } from '../../ai/structured.js';
import { ragAnswerSchema } from '../../ai/schemas/ragAnswer.schema.js';
import { PROMPT_VERSION, SYSTEM_INSTRUCTION, buildUserPrompt } from '../../ai/prompts/ragAnswer.v1.js';
import { supportScore, WEAK_SUPPORT_BELOW } from '../../ai/rag/support.js';

export const NO_EVIDENCE_MESSAGE = "I couldn't find anything in your uploaded notes that answers this question.";

// Small in-memory cache of question vectors: asking the same question twice should not pay for the embedding twice.
const QUERY_CACHE_MAX = 200;
const queryCache = new Map();
export async function embedQuestion(embedder, userId, question) {
  const key = crypto.createHash('sha256').update(`${userId}|${embedder.model}|${embedder.dimensions ?? ''}|${question}`).digest('hex');
  if (queryCache.has(key)) return queryCache.get(key);
  const [vector] = await embedder.embed({ texts: [question], kind: 'query' });
  queryCache.set(key, vector);
  if (queryCache.size > QUERY_CACHE_MAX) queryCache.delete(queryCache.keys().next().value); // evict the oldest
  return vector;
}

/**
 * The RAG pipeline for one question:
 *   embed question -> vector search (restricted to THIS user's ready documents) -> threshold -> LLM with only those passages
 *   -> validate citations against the passages actually sent -> save with source snapshots.
 * If nothing relevant is retrieved the LLM is NOT called: the system says so instead of guessing.
 */
export async function askQuestion({ user, question, conversationId, documentIds }, { llm, embedder, retriever, quota, config }) {
  const userId = user._id;

  // ---- 1. Authorisation and preconditions (nothing external is called yet)
  let conversation = null;
  if (conversationId) {
    conversation = mongoose.isValidObjectId(conversationId) ? await ChatConversation.findOne({ _id: conversationId, userId }) : null;
    if (!conversation) throw new AppError(404, 'NOT_FOUND', 'Conversation not found.');
    if (conversation.messages.length + 2 > MAX_MESSAGES_PER_CONVERSATION) {
      throw new AppError(409, 'CONVERSATION_FULL', 'This conversation is full. Start a new conversation to keep asking questions.');
    }
  }

  const docFilter = { userId, status: 'ready' };
  if (documentIds?.length) {
    if (!documentIds.every((id) => mongoose.isValidObjectId(id))) throw new AppError(404, 'NOT_FOUND', 'Document not found.');
    docFilter._id = { $in: documentIds };
  }
  const docs = await KnowledgeDocument.find(docFilter).select('filename');
  if (documentIds?.length && docs.length !== new Set(documentIds).size) {
    // At least one id is not a READY document of this user (someone else's, deleted, or still processing).
    throw new AppError(404, 'NOT_FOUND', 'One of the selected documents was not found or is not ready yet.');
  }
  if (docs.length === 0) {
    throw new AppError(409, 'NO_DOCUMENTS', 'Upload at least one PDF in Documents and wait until it is ready, then ask your question.');
  }
  if (!llm.isConfigured || !embedder.isConfigured) throw aiNotConfigured();

  // ---- 2. Retrieval
  quota.consume(userId);
  const started = Date.now();
  let result;
  try {
    const queryVector = await embedQuestion(embedder, String(userId), question);
    const hits = await retriever.search({
      userId, documentIds: docs.map((d) => d._id.toString()), queryVector, limit: config.topK, numCandidates: config.numCandidates,
    });

    // Defence in depth: even if the retriever misbehaved, drop anything outside the authorised document set.
    const allowed = new Map(docs.map((d) => [d._id.toString(), d.filename]));
    const relevant = hits.filter((h) => allowed.has(h.documentId) && h.score >= config.minScore);

    // Keep the best passages that fit the context budget; number them 1..N (these numbers are the citations).
    const sources = [];
    let used = 0;
    for (const h of relevant) {
      if (sources.length && used + h.text.length > config.maxContextChars) break;
      used += h.text.length;
      sources.push({ n: sources.length + 1, chunkId: h.chunkId, documentId: h.documentId, filename: allowed.get(h.documentId), pageStart: h.pageStart, pageEnd: h.pageEnd, score: h.score, text: h.text });
    }

    // ---- 3. Nothing relevant retrieved: say so, do not call the LLM.
    if (sources.length === 0) {
      result = insufficient({ limitations: NO_EVIDENCE_MESSAGE, sources: [], usedLlm: false, started });
    } else {
      // ---- 4. Generation, grounded in the retrieved passages only
      const gen = await generateStructured({
        provider: llm, systemInstruction: SYSTEM_INSTRUCTION, userPrompt: buildUserPrompt({ question, sources }), schema: ragAnswerSchema,
        temperature: 0.1, retries: config.retries, retryBaseMs: config.retryBaseMs, sleep: config.sleep,
      });
      result = finalizeAnswer(gen, sources, started, llm);
    }
  } catch (err) {
    quota.refund(userId);
    throw err;
  }

  // ---- 5. Persist the exchange (only after success, so a failed call leaves no half-saved turn)
  if (!conversation) conversation = new ChatConversation({ userId, title: question.slice(0, 60), messages: [] });
  conversation.messages.push({ role: 'user', content: question }, { role: 'assistant', ...result });
  await conversation.save();
  const saved = conversation.messages.at(-1);
  return { conversationId: conversation._id.toString(), message: saved.toObject() };
}

function insufficient({ limitations, sources, usedLlm, started, gen, llm }) {
  return {
    status: 'insufficient_evidence', sections: [], limitations, sources: sources.map((s) => ({ ...s, cited: false })),
    ai: { usedLlm, model: llm?.model, promptVersion: usedLlm ? PROMPT_VERSION : undefined, promptTokens: gen?.usage.promptTokens, outputTokens: gen?.usage.outputTokens, latencyMs: Date.now() - started },
  };
}

/** Validate the model's output against what we actually sent. Citations the model made up are removed, never displayed. */
function finalizeAnswer(gen, sources, started, llm) {
  const valid = new Set(sources.map((s) => s.n));
  const byN = new Map(sources.map((s) => [s.n, s]));

  const sections = gen.data.sections
    .map((s) => ({ text: s.text, sources: [...new Set(s.sources)].filter((n) => valid.has(n)) }))
    .filter((s) => s.sources.length > 0); // an answer sentence with no valid citation is not shown
  const removed = gen.data.sections.length - sections.length;

  if (!gen.data.sufficient || sections.length === 0) {
    const note = gen.data.sufficient && removed > 0
      ? 'The AI produced an answer that could not be matched to your notes, so it was discarded.'
      : gen.data.limitations || NO_EVIDENCE_MESSAGE;
    return insufficient({ limitations: note, sources, usedLlm: true, started, gen, llm });
  }

  const graded = sections.map((s) => {
    const score = supportScore(s.text, s.sources.map((n) => byN.get(n).text));
    return { ...s, support: score >= WEAK_SUPPORT_BELOW ? 'strong' : 'weak' };
  });
  const cited = new Set(graded.flatMap((s) => s.sources));
  const limitations = [gen.data.limitations, removed ? 'Part of the AI answer was removed because it cited passages that were not provided.' : ''].filter(Boolean).join(' ');

  return {
    status: 'answered', sections: graded, limitations,
    sources: sources.map((s) => ({ ...s, cited: cited.has(s.n) })),
    ai: { usedLlm: true, model: llm.model, promptVersion: PROMPT_VERSION, promptTokens: gen.usage.promptTokens, outputTokens: gen.usage.outputTokens, latencyMs: Date.now() - started },
  };
}

// ---- Conversation management (all queries include userId)
export const listConversations = (userId, paging) =>
  paginate(ChatConversation, { userId }, paging, { sort: { updatedAt: -1 }, select: 'title updatedAt createdAt' });

export async function getConversation(userId, id) {
  const conv = mongoose.isValidObjectId(id) ? await ChatConversation.findOne({ _id: id, userId }) : null;
  if (!conv) throw new AppError(404, 'NOT_FOUND', 'Conversation not found.');
  return conv;
}

export async function deleteConversation(userId, id) {
  const { deletedCount } = await ChatConversation.deleteOne({ _id: id, userId });
  if (!deletedCount) throw new AppError(404, 'NOT_FOUND', 'Conversation not found.');
}
