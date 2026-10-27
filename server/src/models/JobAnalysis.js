import mongoose from 'mongoose';

const { Schema } = mongoose;

const requirementSchema = new Schema(
  {
    skill: String,
    category: String,
    importance: { type: String, enum: ['required', 'preferred', 'bonus'] },
    weight: Number,
    // `evidenceLevel` is the VERIFIED level used for scoring; `claimedLevel` is what the model said.
    evidenceLevel: { type: String, enum: ['demonstrated', 'listed', 'inferred', 'none'] },
    claimedLevel: { type: String, enum: ['demonstrated', 'listed', 'inferred', 'none'] },
    credit: Number,
    verification: String,
    matchedTerm: String,
    evidenceQuote: String,
    note: String,
  },
  { _id: false },
);

const breakdownSchema = new Schema(
  { key: String, count: Number, earned: Number, possible: Number, percent: Number },
  { _id: false },
);

/**
 * A completed analysis of one resume against one job description.
 * Spec adaptation: `extractedRequirements`, `matchedSkills`, `missingSkills` and `evidence` are ONE list
 * (`requirements`, each carrying its verified evidence). The matched / needs-evidence / missing groups are derived
 * from it when the report is built (services/analysis/report.js), so they can never disagree with each other.
 */
const jobAnalysisSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    resumeId: { type: Schema.Types.ObjectId, ref: 'Resume', required: true },
    resumeFilename: { type: String, maxlength: 120 }, // denormalised for the history list (avoids a join per row)
    roleTitle: { type: String, default: '' },
    jobDescription: { type: String, required: true, maxlength: 20_000 },
    // Hash of everything that determines the result (resume + JD + prompt + rubric + model): used as a cache key.
    inputHash: { type: String, required: true },

    requirements: [requirementSchema],
    score: {
      overall: Number,
      earned: Number,
      possible: Number,
      rubricVersion: String,
      byImportance: [breakdownSchema],
      byCategory: [breakdownSchema],
      counts: {
        total: Number, demonstrated: Number, listed: Number, inferred: Number, none: Number,
        unverifiedClaims: Number, downgraded: Number,
      },
    },

    relevantHighlights: [new Schema({ item: String, whyRelevant: String, quote: String, quoteVerified: Boolean }, { _id: false })],
    resumeGaps: [String],
    suggestions: [new Schema({ section: String, type: String, currentText: String, currentTextVerified: Boolean, suggestion: String, reason: String }, { _id: false })],
    interviewTopics: [new Schema({ topic: String, reason: String }, { _id: false })],
    preparationChecklist: [new Schema({ task: String, relatedSkill: String, priority: String }, { _id: false })],
    interviewQuestions: [new Schema({ question: String, topic: String, difficulty: String }, { _id: false })],

    // Provenance: which model/prompt produced this, and what was removed before sending.
    ai: {
      provider: String,
      model: String,
      promptVersion: String,
      repaired: Boolean,
      promptTokens: Number,
      outputTokens: Number,
      latencyMs: Number,
      redactions: { emails: Number, phones: Number },
    },
  },
  { timestamps: true },
);

jobAnalysisSchema.index({ userId: 1, createdAt: -1 }); // history list
jobAnalysisSchema.index({ userId: 1, inputHash: 1, createdAt: -1 }); // cache lookup
jobAnalysisSchema.index({ userId: 1, resumeId: 1 }); // cascade delete

export const JobAnalysis = mongoose.model('JobAnalysis', jobAnalysisSchema);
