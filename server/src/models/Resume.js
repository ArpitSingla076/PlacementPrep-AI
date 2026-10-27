import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * A parsed resume. We store the extracted TEXT, not the PDF file itself:
 *  - the analysis only needs text, and
 *  - not keeping the original file means less personal data at rest (and no file-path / disk-execution risks).
 *
 * Design note: `parsedSkills` from the original spec is intentionally NOT stored here. Skills are extracted per
 * analysis (with verified evidence), because they depend on the job description, model and prompt version.
 * Storing a second, stale copy on the resume would be duplication with no clear reader.
 */
const resumeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    originalFilename: { type: String, required: true, maxlength: 120 },
    sizeBytes: { type: Number, required: true },
    pageCount: { type: Number, required: true },
    charCount: { type: Number, required: true },
    // Excluded from normal queries (large + sensitive). Request with .select('+extractedText') only when needed.
    extractedText: { type: String, required: true, select: false },
    // SHA-256 of the normalised text: lets us detect a re-upload of the same resume.
    textHash: { type: String, required: true },
  },
  { timestamps: true },
);

// One user cannot store the same resume text twice; also serves "find by hash" lookups.
resumeSchema.index({ userId: 1, textHash: 1 }, { unique: true });
resumeSchema.index({ userId: 1, createdAt: -1 });

resumeSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.extractedText;
    delete ret.textHash;
    delete ret.userId;
    return ret;
  },
});

export const Resume = mongoose.model('Resume', resumeSchema);
