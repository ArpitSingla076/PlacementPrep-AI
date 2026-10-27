import mongoose from 'mongoose';
import { Resume } from './Resume.js';
import { JobAnalysis } from './JobAnalysis.js';
import { KnowledgeDocument } from './KnowledgeDocument.js';
import { DocumentChunk } from './DocumentChunk.js';
import { ChatConversation } from './ChatConversation.js';
import { InterviewSession } from './InterviewSession.js';
import { PreparationPlan } from './PreparationPlan.js';
import { JobApplication } from './JobApplication.js';
import { QuizSession } from './QuizSession.js';

/**
 * EVERY collection that stores a user's data. Account deletion and data export iterate this list, and a test fails if a model
 * with a `userId` field is ever added without being registered here, so a new feature cannot silently leave personal data behind.
 */
export const USER_OWNED_MODELS = [Resume, JobAnalysis, KnowledgeDocument, DocumentChunk, ChatConversation, InterviewSession, PreparationPlan, JobApplication, QuizSession];
export const allModels = () => Object.values(mongoose.models);
