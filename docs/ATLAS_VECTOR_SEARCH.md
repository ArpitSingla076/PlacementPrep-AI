# MongoDB Atlas Vector Search setup

The RAG assistant retrieves passages with Atlas Vector Search (`$vectorSearch`). **It was not exercised against a real Atlas cluster in the build environment** (none was reachable). What was verified: the pipeline shape against the published `@langchain/mongodb` implementation, the index API against the MongoDB driver's types, and the BSON double-vs-int32 behaviour by experiment. Treat the first run on Atlas as the real verification.

## Create the index
```bash
cd server
npm run ai:check          # prints the embedding dimension your model really returns
npm run vector:index      # creates the index on the DocumentChunk collection (needs an Atlas cluster)
```
Or create it by hand (Atlas UI > your cluster > Atlas Search > Create Search Index > JSON editor), database = yours, collection `documentchunks`, index name `chunk_embedding_index` (`VECTOR_INDEX_NAME`):
```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 768, "similarity": "cosine" },
    { "type": "filter", "path": "userId" },
    { "type": "filter", "path": "documentId" }
  ]
}
```
`numDimensions` **must equal** the dimension of the stored vectors (`EMBEDDING_DIMENSIONS`, or the model's default). A mismatch returns nothing or errors. The index takes a short while to become **ACTIVE**; new chunks take a moment to become searchable.

## Why `userId` and `documentId` are filter fields
Every search is restricted to the caller's own documents *inside* `$vectorSearch` (pre-filtering). Other users' vectors are never candidates. The server also re-checks the result set against the user's authorised documents.

## Things that are easy to get wrong
- Query vectors are sent as BSON **doubles**. A plain JS `0` or `1` serialises as Int32, which Atlas rejects (the code wraps values in `Double`).
- Changing the embedding model or dimension means a new index definition and **re-embedding every document**. Documents record the model and dimension they were embedded with.
- `VECTOR_SEARCH_MODE=local` computes cosine similarity in Node for development without Atlas. It loads all of a user's vectors per question and is not for production.

## Unverified here: confirm in Atlas documentation
Maximum supported dimensions, the number of search indexes allowed on the free (M0) tier, and available similarity functions. The current choices (768 to 3072 dimensions, cosine, one index) are believed to be within limits but were not confirmed.
