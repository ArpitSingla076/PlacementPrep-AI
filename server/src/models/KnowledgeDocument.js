import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * A study-notes PDF the user uploaded for the RAG assistant. Metadata only: the text lives in DocumentChunk.
 * status: processing -> ready | failed. `error` explains a failure in user-safe words.
 */
const knowledgeDocumentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    filename: { type: String, required: true, maxlength: 120 },
    sizeBytes: { type: Number, required: true },
    pageCount: { type: Number, required: true },
    charCount: { type: Number, required: true },
    contentHash: { type: String, required: true }, // SHA-256 of normalised text: prevents duplicate ingestion
    status: { type: String, enum: ['processing', 'ready', 'failed'], default: 'processing', index: true },
    error: { code: String, message: String },
    chunkCount: { type: Number, default: 0 },
    // Provenance: vectors from different models/dimensions must never be mixed in one index.
    embeddingModel: String,
    embeddingDimensions: Number,
    chunking: { size: Number, overlap: Number },
    reusedEmbeddings: { type: Number, default: 0 }, // chunks whose vectors were reused instead of re-embedded
    processedAt: Date,
  },
  { timestamps: true },
);

knowledgeDocumentSchema.index({ userId: 1, contentHash: 1 }, { unique: true });
knowledgeDocumentSchema.index({ userId: 1, createdAt: -1 });

knowledgeDocumentSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.userId;
    delete ret.contentHash;
    return ret;
  },
});

export const KnowledgeDocument = mongoose.model('KnowledgeDocument', knowledgeDocumentSchema);
