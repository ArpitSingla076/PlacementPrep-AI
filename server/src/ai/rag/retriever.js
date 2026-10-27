import mongoose from 'mongoose';
import { DocumentChunk } from '../../models/DocumentChunk.js';
import { AppError } from '../../utils/AppError.js';
import { log } from '../../utils/logger.js';

const { ObjectId } = mongoose.Types;
const { Double } = mongoose.mongo;

/**
 * Retrieval step of RAG: question vector -> the most similar stored passages.
 *
 * Every retriever implements:  search({ userId, documentIds, queryVector, limit, numCandidates }) ->
 *   [{ chunkId, documentId, chunkIndex, text, pageStart, pageEnd, score }]   (best first)
 * `score` is on ONE scale for all implementations: (1 + cosine) / 2, i.e. 0..1 (0.5 = unrelated). This matches the
 * score MongoDB Atlas reports for the cosine similarity, so RAG_MIN_SCORE means the same thing in every mode.
 *
 * SECURITY: both implementations restrict the search to {userId == caller AND documentId in the caller's authorised
 * documents}. In Atlas this is done INSIDE $vectorSearch via filter fields (pre-filtering), so other users' vectors are
 * never candidates.
 */

/** Pure function so the pipeline can be unit-tested without Atlas. */
export function buildVectorSearchPipeline({ indexName, queryVector, userId, documentIds, limit, numCandidates }) {
  return [
    {
      $vectorSearch: {
        index: indexName,
        path: 'embedding',
        // Explicit BSON doubles: a JS number such as 0 or 1 would otherwise be serialised as Int32, which Atlas rejects.
        queryVector: queryVector.map((v) => new Double(v)),
        numCandidates: Math.max(numCandidates, limit),
        limit,
        filter: { $and: [{ userId: { $eq: new ObjectId(userId) } }, { documentId: { $in: documentIds.map((id) => new ObjectId(id)) } }] },
      },
    },
    { $project: { _id: 1, documentId: 1, chunkIndex: 1, text: 1, pageStart: 1, pageEnd: 1, score: { $meta: 'vectorSearchScore' } } },
  ];
}

const toHit = (d) => ({
  chunkId: d._id.toString(), documentId: d.documentId.toString(), chunkIndex: d.chunkIndex,
  text: d.text, pageStart: d.pageStart, pageEnd: d.pageEnd, score: d.score,
});

export class AtlasRetriever {
  mode = 'atlas';
  constructor({ indexName }) { this.indexName = indexName; }

  async search({ userId, documentIds, queryVector, limit, numCandidates }) {
    const pipeline = buildVectorSearchPipeline({ indexName: this.indexName, queryVector, userId, documentIds, limit, numCandidates });
    try {
      return (await DocumentChunk.aggregate(pipeline)).map(toHit);
    } catch (err) {
      // Typical causes: index not created yet, still building, wrong name, or not an Atlas cluster.
      // The raw database error stays in the server log; it is never sent to the client.
      log.error(`[rag] vector search failed: ${err.message}`);
      throw new AppError(503, 'VECTOR_SEARCH_UNAVAILABLE',
        'Vector search is not available. The site owner needs to create the Atlas Vector Search index (npm run vector:index) and wait for it to become active.');
    }
  }
}

/** Dev/test fallback: exact cosine similarity in Node. Not for production (loads every vector of the user's documents). */
export class LocalRetriever {
  mode = 'local';
  constructor({ maxChunks = 20_000 } = {}) { this.maxChunks = maxChunks; }

  async search({ userId, documentIds, queryVector, limit }) {
    const chunks = await DocumentChunk.find({ userId, documentId: { $in: documentIds } })
      .select('+embedding documentId chunkIndex text pageStart pageEnd').limit(this.maxChunks + 1).lean();
    if (chunks.length > this.maxChunks) throw new AppError(503, 'VECTOR_SEARCH_UNAVAILABLE', 'Too many passages for local search mode. Use VECTOR_SEARCH_MODE=atlas.');
    return chunks
      .map((c) => {
        let dot = 0;
        for (let i = 0; i < queryVector.length; i++) dot += queryVector[i] * c.embedding[i]; // both vectors are unit length
        return { ...c, score: (1 + dot) / 2 };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(toHit);
  }
}

export function createRetriever(env) {
  return env.VECTOR_SEARCH_MODE === 'local' ? new LocalRetriever() : new AtlasRetriever({ indexName: env.VECTOR_INDEX_NAME });
}

/** Atlas vector index definition. numDimensions MUST equal the embedding dimension actually stored. */
export function vectorIndexDefinition({ numDimensions }) {
  return {
    fields: [
      { type: 'vector', path: 'embedding', numDimensions, similarity: 'cosine' },
      { type: 'filter', path: 'userId' },
      { type: 'filter', path: 'documentId' },
    ],
  };
}
