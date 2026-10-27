import mongoose from 'mongoose';

const { Schema } = mongoose;

const sourceSchema = new Schema(
  {
    n: Number, // the [n] number used in the answer text
    chunkId: Schema.Types.ObjectId,
    documentId: Schema.Types.ObjectId,
    filename: String,
    pageStart: Number,
    pageEnd: Number,
    score: Number,
    text: String, // snapshot of the passage so the citation can be shown later
    cited: Boolean,
    documentDeleted: { type: Boolean, default: false },
  },
  { _id: false },
);

const messageSchema = new Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: String, // user's question
    status: { type: String, enum: ['answered', 'insufficient_evidence'] }, // assistant only
    sections: [new Schema({ text: String, sources: [Number], support: { type: String, enum: ['strong', 'weak'] } }, { _id: false })],
    limitations: String,
    sources: [sourceSchema],
    ai: { model: String, promptVersion: String, promptTokens: Number, outputTokens: Number, latencyMs: Number, usedLlm: Boolean },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

/** Messages are embedded (a conversation is always read as a whole, and capped, so one document stays small). */
const chatConversationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, maxlength: 80 },
    messages: [messageSchema],
  },
  { timestamps: true },
);

chatConversationSchema.index({ userId: 1, updatedAt: -1 });

export const ChatConversation = mongoose.model('ChatConversation', chatConversationSchema);
export const MAX_MESSAGES_PER_CONVERSATION = 100;
