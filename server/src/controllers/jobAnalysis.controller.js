import * as service from '../services/jobAnalysis.service.js';
import { toReport, toSummary } from '../services/analysis/report.js';
import { sendSuccess } from '../utils/response.js';

// `deps` (llm provider, quota, retry config) is injected by the router, which keeps tests free of real network calls.
export const create = (deps) => async (req, res) => {
  const { analysis, cached } = await service.createAnalysis({ userId: req.user._id, ...req.body }, deps);
  sendSuccess(res, { analysis: toReport(analysis), cached }, cached ? 200 : 201);
};

export async function list(req, res) {
  const { items, pagination } = await service.listAnalyses(req.user._id, req.validatedQuery);
  sendSuccess(res, { analyses: items.map(toSummary), pagination });
}

export async function get(req, res) {
  sendSuccess(res, { analysis: toReport(await service.getAnalysis(req.user._id, req.params.id)) });
}

export async function remove(req, res) {
  await service.deleteAnalysis(req.user._id, req.params.id);
  sendSuccess(res, { deleted: true });
}
