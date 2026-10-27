import mongoose from 'mongoose';

const { Schema } = mongoose;

const evaluationSchema = new Schema({
  scores: { correctness: Number, completeness: Number, relevance: Number, clarity: Number }, // each 0..5
  overall: Number, // 0..100, computed by code from the four scores (see services/interview/scoring.js)
  coveredPoints: [Boolean], // aligned with keyPoints
  whatWasCorrect: [String],
  missingOrIncorrect: [String],
  strongerAnswer: String,
  followUp: String,
  cappedCorrectness: Boolean, // true if code lowered the model's correctness score (no rubric point covered)
  ai: { model: String, promptVersion: String, promptTokens: Number, outputTokens: Number, repaired: Boolean },
}, { _id: false });

const questionSchema = new Schema({
  question: String,
  topic: String, // short label, e.g. "SQL joins". Used for per-topic progress.
  topicKey: String, // lowercase, trimmed
  difficulty: String,
  keyPoints: [String], // the rubric. Hidden from the client until the question is answered.
  answer: String,
  answeredAt: Date,
  evaluation: evaluationSchema,
}, { _id: false });

const interviewSessionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  targetRole: { type: String, required: true, maxlength: 100 },
  experienceLevel: { type: String, enum: ['intern', 'fresher', 'junior', 'mid'], required: true },
  category: { type: String, required: true },
  difficulty: { type: String, enum: ['easy', 'medium', 'hard'], required: true },
  requestedQuestions: Number,
  jobDescription: { type: String, maxlength: 6000 },
  jobAnalysisId: { type: Schema.Types.ObjectId, ref: 'JobAnalysis' },
  focusSkills: [String], // names only, taken from a resume analysis (no resume text is stored here or sent)
  status: { type: String, enum: ['in_progress', 'completed'], default: 'in_progress' },
  questions: [questionSchema],
  aggregate: {
    answered: Number, average: Number,
    byDimension: { correctness: Number, completeness: Number, relevance: Number, clarity: Number },
    byTopic: [new Schema({ topic: String, topicKey: String, average: Number, count: Number }, { _id: false })],
  },
  completedAt: Date,
  ai: { model: String, promptVersion: String },
}, { timestamps: true });

interviewSessionSchema.index({ userId: 1, createdAt: -1 });
interviewSessionSchema.index({ userId: 1, status: 1 });

export const InterviewSession = mongoose.model('InterviewSession', interviewSessionSchema);
