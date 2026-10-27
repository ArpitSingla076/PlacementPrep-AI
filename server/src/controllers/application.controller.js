import * as service from '../services/application.service.js';
import { sendSuccess } from '../utils/response.js';

export const list = async (req, res) => sendSuccess(res, { applications: await service.listApplications(req.user._id) });
export const create = async (req, res) => sendSuccess(res, { application: await service.createApplication(req.user._id, req.body) }, 201);
export const update = async (req, res) => sendSuccess(res, { application: await service.updateApplication(req.user._id, req.params.id, req.body) });
export const remove = async (req, res) => { await service.deleteApplication(req.user._id, req.params.id); sendSuccess(res, { deleted: true }); };
