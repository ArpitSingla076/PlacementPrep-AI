import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * One searchable passage. `embedding` is what Atlas Vector Search indexes; `userId` and `documentId` are declared as
 * FILTER fields in the vector index so every search is restricted to the caller's own documents INSIDE the search.
 * (See docs/ATLAS_VECTOR_SEARCH.md and `npm run vector:index`.)
 */
const documentChunkSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    documentId: { type: Schema.Types.ObjectId, ref: 'KnowledgeDocument', required: true },
    chunkIndex: { type: Number, required: true },
    text: { type: String, required: true },
    textHash: { type: String, required: true }, // lets us reuse an existing vector for identical text
    pageStart: Number,
    pageEnd: Number,
    embedding: { type: [Number], required: true, select: false }, // large: only load when needed
    embeddingModel: { type: String, required: true },
    embeddingDimensions: { type: Number, required: true },
  },
  { timestamps: true },
);

documentChunkSchema.index({ documentId: 1, chunkIndex: 1 }, { unique: true });
documentChunkSchema.index({ userId: 1, textHash: 1, embeddingModel: 1, embeddingDimensions: 1 }); // embedding reuse lookup

export const DocumentChunk = mongoose.model('DocumentChunk', documentChunkSchema);
