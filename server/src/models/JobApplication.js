import mongoose from 'mongoose';

const { Schema } = mongoose;

export const APPLICATION_STATUSES = ['saved', 'applied', 'interview', 'offer', 'rejected'];

/** One job the student is tracking. Plain CRUD: no AI is involved anywhere in this model. */
const jobApplicationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  company: { type: String, required: true, trim: true, maxlength: 100 },
  roleTitle: { type: String, required: true, trim: true, maxlength: 100 },
  status: { type: String, enum: APPLICATION_STATUSES, default: 'saved' },
  jobUrl: { type: String, maxlength: 500 },
  location: { type: String, maxlength: 100 },
  notes: { type: String, maxlength: 2000 },
  deadline: Date,
  appliedAt: Date,
  jobAnalysisId: { type: Schema.Types.ObjectId, ref: 'JobAnalysis' }, // optional link to a resume analysis for this job
  statusHistory: [new Schema({ status: String, at: Date }, { _id: false })],
}, { timestamps: true });

jobApplicationSchema.index({ userId: 1, status: 1, updatedAt: -1 });

export const JobApplication = mongoose.model('JobApplication', jobApplicationSchema);
