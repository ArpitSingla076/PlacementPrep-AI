import mongoose from 'mongoose';

const { Schema } = mongoose;

const itemSchema = new Schema({
  key: { type: String, required: true }, // stable id, e.g. "weak_topic:sql joins": lets completion survive regeneration
  kind: { type: String, enum: ['weak_topic', 'watch', 'skill_gap'] },
  topic: String,
  priority: { type: String, enum: ['high', 'medium', 'low'] },
  // OBSERVED = computed by code from saved results. Never written by the model.
  evidenceType: { type: String, enum: ['observed_performance', 'resume_analysis', 'limited_evidence'] },
  observed: Schema.Types.Mixed,
  reason: String,
  // AI-SUGGESTED = written by the model from the facts above. Labelled as suggestions in the UI.
  action: String,
  practice: [new Schema({ type: { type: String, enum: ['question', 'task'] }, text: String }, { _id: false })],
  relatedDocuments: [new Schema({ documentId: Schema.Types.ObjectId, filename: String }, { _id: false })],
  completed: { type: Boolean, default: false },
  completedAt: Date,
  completedAtAttempts: Number, // how many answers existed when it was ticked off (to detect new low scores later)
  reopenedNote: String,
}, { _id: false });

const preparationPlanSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true }, // one current plan per user
  targetRole: String,
  jobAnalysisId: { type: Schema.Types.ObjectId, ref: 'JobAnalysis' },
  basis: { interviewSessions: Number, answeredQuestions: Number, analysisRole: String, analysisScore: Number },
  items: [itemSchema],
  generatedAt: Date,
  ai: { model: String, promptVersion: String, promptTokens: Number, outputTokens: Number },
}, { timestamps: true });

export const PreparationPlan = mongoose.model('PreparationPlan', preparationPlanSchema);
