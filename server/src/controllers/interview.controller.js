import * as service from '../services/interview/interview.service.js';
import { sendSuccess } from '../utils/response.js';

export const create = (deps) => async (req, res) => sendSuccess(res, { interview: await service.createSession(req.user, req.body, deps) }, 201);
export const answer = (deps) => async (req, res) => sendSuccess(res, { interview: await service.answerQuestion(req.user._id, req.params.id, req.body, deps) });
export const get = async (req, res) => sendSuccess(res, { interview: await service.getSession(req.user._id, req.params.id) });
export const list = async (req, res) => sendSuccess(res, await service.listSessions(req.user._id, req.validatedQuery));
export const complete = async (req, res) => sendSuccess(res, { interview: await service.completeSession(req.user._id, req.params.id) });
export const remove = async (req, res) => { await service.deleteSession(req.user._id, req.params.id); sendSuccess(res, { deleted: true }); };
