import * as service from '../services/quiz.service.js';
import { sendSuccess } from '../utils/response.js';

export const create = (deps) => async (req, res) => sendSuccess(res, { quiz: await service.createQuiz(req.user, req.body, deps) }, 201);
export const list = async (req, res) => sendSuccess(res, await service.listQuizzes(req.user._id, req.validatedQuery));
export const get = async (req, res) => sendSuccess(res, { quiz: await service.getQuiz(req.user._id, req.params.id) });
export const submit = async (req, res) => sendSuccess(res, { quiz: await service.submitQuiz(req.user._id, req.params.id, req.body) });
export const remove = async (req, res) => { await service.deleteQuiz(req.user._id, req.params.id); sendSuccess(res, { deleted: true }); };
