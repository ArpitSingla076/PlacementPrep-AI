import * as resumeService from '../services/resume.service.js';
import { sendSuccess } from '../utils/response.js';

export async function upload(req, res) {
  const { resume, duplicate } = await resumeService.createResume(req.user._id, req.file);
  sendSuccess(res, { resume, duplicate }, duplicate ? 200 : 201);
}

export async function list(req, res) {
  const { items, pagination } = await resumeService.listResumes(req.user._id, req.validatedQuery);
  sendSuccess(res, { resumes: items, pagination });
}

export async function remove(req, res) {
  sendSuccess(res, await resumeService.deleteResume(req.user._id, req.params.id));
}
