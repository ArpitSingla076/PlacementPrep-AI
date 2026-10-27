import { ingestParsedPages, waitForIngestion } from '../../services/knowledge/ingestion.service.js';
import { askQuestion, embedQuestion } from '../../services/knowledge/rag.service.js';
import { KnowledgeDocument } from '../../models/KnowledgeDocument.js';
import { retrievalOutcome, citationsValid, strongSupportRatio, abstained, summarize } from './metrics.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run the dataset through the REAL pipeline (ingest -> embed -> retrieve -> generate -> validate) for one user.
 * deps: { llm, embedder, retriever, ingestQuota, chatQuota, ragConfig }.  The caller supplies the user and cleans up.
 * On Atlas, new vectors take a little while to become searchable, so we poll until the first passage can be found.
 */
export async function runRagEvaluation({ userId, corpus, questions, deps, searchableTimeoutMs = 0, log = () => {} }) {
  for (const [filename, pages] of Object.entries(corpus)) {
    const text = pages.map((p) => p.join('\n'));
    await ingestParsedPages(userId, { filename, sizeBytes: text.join('').length, pageCount: pages.length, pages: text }, { embedder: deps.embedder, quota: deps.ingestQuota });
    log(`ingesting ${filename}`);
  }
  await waitForIngestion();
  const docs = await KnowledgeDocument.find({ userId });
  const notReady = docs.filter((d) => d.status !== 'ready');
  if (notReady.length) throw new Error(`Ingestion failed for: ${notReady.map((d) => `${d.filename} (${d.error?.code})`).join(', ')}`);

  const documentIds = docs.map((d) => d._id.toString());
  const nameById = new Map(docs.map((d) => [d._id.toString(), d.filename]));
  const retrieve = async (question) => {
    const queryVector = await embedQuestion(deps.embedder, String(userId), question);
    const hits = await deps.retriever.search({ userId, documentIds, queryVector, limit: deps.ragConfig.topK, numCandidates: deps.ragConfig.numCandidates });
    return hits.map((h) => ({ ...h, filename: nameById.get(h.documentId) }));
  };

  if (searchableTimeoutMs > 0) {
    const probe = questions.find((q) => q.expected);
    const deadline = Date.now() + searchableTimeoutMs;
    while ((await retrieve(probe.question)).length === 0) {
      if (Date.now() > deadline) throw new Error('Vector index did not return any results in time. Is the Atlas index created and ACTIVE (npm run vector:index)?');
      await sleep(3000);
    }
  }

  const results = [];
  for (const q of questions) {
    const hits = await retrieve(q.question); // raw top-k, BEFORE the relevance threshold: measures the retriever itself
    const { message } = await askQuestion({ user: { _id: userId }, question: q.question }, { ...deps, quota: deps.chatQuota, config: deps.ragConfig });
    const result = {
      id: q.id, type: q.type, question: q.question, status: message.status,
      retrieval: q.expected ? retrievalOutcome(hits, q.expected) : null,
      topScore: hits[0]?.score ?? null,
      citationsValid: citationsValid(message), strongSupport: strongSupportRatio(message), abstained: abstained(message),
      answer: message.sections.map((s) => s.text).join(' ') || message.limitations,
      usedLlm: message.ai.usedLlm,
    };
    log(`${q.id} ${result.status}${result.retrieval ? ` hit=${result.retrieval.hit}` : ''}`);
    results.push(result);
  }
  return { results, summary: summarize(results, { k: deps.ragConfig.topK }) };
}
