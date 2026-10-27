/**
 * `npm run vector:index`  - creates (or reports on) the Atlas Vector Search index used by the RAG assistant.
 *
 * Requires a MongoDB ATLAS cluster (Atlas Vector Search is not available on a plain local mongod).
 * numDimensions comes from EMBEDDING_DIMENSIONS, or from a real probe of your embedding model if that is unset.
 * The index definition must match the vectors actually stored, or search returns nothing / errors.
 */
import mongoose from 'mongoose';
import { GoogleGenAI } from '@google/genai';
import { env } from '../src/config/env.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { DocumentChunk } from '../src/models/DocumentChunk.js';
import { vectorIndexDefinition } from '../src/ai/rag/retriever.js';

async function detectDimensions() {
  if (env.EMBEDDING_DIMENSIONS) return env.EMBEDDING_DIMENSIONS;
  if (!env.GEMINI_API_KEY || !env.EMBEDDING_MODEL) throw new Error('Set EMBEDDING_DIMENSIONS, or set GEMINI_API_KEY and EMBEDDING_MODEL so the dimension can be measured.');
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY, httpOptions: { ...(env.GEMINI_BASE_URL && { baseUrl: env.GEMINI_BASE_URL }) } });
  const res = await ai.models.embedContent({ model: env.EMBEDDING_MODEL, contents: [{ parts: [{ text: 'dimension probe' }] }] });
  return res.embeddings[0].values.length;
}

try {
  await connectDB(env.MONGODB_URI);
  const name = env.VECTOR_INDEX_NAME;
  const numDimensions = await detectDimensions();
  const definition = vectorIndexDefinition({ numDimensions });
  console.log(`Index "${name}" on collection "${DocumentChunk.collection.name}": ${numDimensions} dimensions, cosine`);

  let existing = [];
  try {
    existing = await DocumentChunk.collection.listSearchIndexes(name).toArray();
  } catch (e) {
    console.error(`\nCould not list search indexes: ${e.message}\nThis usually means the database is not a MongoDB Atlas cluster. Atlas Vector Search needs Atlas.`);
    process.exit(1);
  }

  if (existing.length) {
    const cur = existing[0];
    const curDims = cur.latestDefinition?.fields?.find((f) => f.type === 'vector')?.numDimensions;
    console.log(`Index already exists (status: ${cur.status ?? 'unknown'}, queryable: ${cur.queryable ?? 'unknown'}, dimensions: ${curDims ?? 'unknown'}).`);
    if (curDims && curDims !== numDimensions) {
      console.error(`MISMATCH: the index has ${curDims} dimensions but your embeddings have ${numDimensions}. Drop the index in Atlas (or use dropSearchIndex) and run this again, then re-upload your documents.`);
      process.exit(1);
    }
  } else {
    await DocumentChunk.collection.createSearchIndex({ name, type: 'vectorSearch', definition });
    console.log('Index creation requested. Atlas builds it in the background (usually under a minute).');
  }
  console.log('\nDefinition (for the Atlas UI JSON editor if you prefer to create it by hand):');
  console.log(JSON.stringify(definition, null, 2));
  console.log('\nCheck the "Atlas Search" tab: the index must show status ACTIVE before questions work.');
} catch (e) {
  console.error(`Failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDB().catch(() => {});
  void mongoose;
}
