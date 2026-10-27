import mongoose from 'mongoose';

const { Schema } = mongoose;

const questionSchema = new Schema({
  question: String,
  options: [String], // always 4, shuffled by the SERVER (so the model cannot bias where the right answer sits)
  correctIndex: Number, // hidden from the client until the quiz is submitted
  explanation: String,
  topic: String,
  weakGrounding: Boolean, // the explanation/answer shares few words with the source passage: "verify in the source"
  source: { chunkId: Schema.Types.ObjectId, documentId: Schema.Types.ObjectId, filename: String, pageStart: Number, pageEnd: Number, text: String, documentDeleted: { type: Boolean, default: false } },
  selectedIndex: Number,
  correct: Boolean,
}, { _id: false });

const quizSessionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: String,
  documentIds: [Schema.Types.ObjectId],
  status: { type: String, enum: ['in_progress', 'completed'], default: 'in_progress' },
  questions: [questionSchema],
  result: { correct: Number, total: Number, percent: Number },
  completedAt: Date,
  ai: { model: String, promptVersion: String, promptTokens: Number, outputTokens: Number },
}, { timestamps: true });

quizSessionSchema.index({ userId: 1, createdAt: -1 });

export const QuizSession = mongoose.model('QuizSession', quizSessionSchema);
