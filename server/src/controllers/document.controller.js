import * as service from '../services/knowledge/ingestion.service.js';
import { sendSuccess } from '../utils/response.js';

export const upload = (deps) => async (req, res) => {
  const { document, duplicate } = await service.createDocument(req.user._id, req.file, deps);
  // 202 Accepted: the file is valid and queued; embedding continues in the background. The client polls for status.
  sendSuccess(res, { document, duplicate }, duplicate ? 200 : 202);
};

export async function list(req, res) {
  const { items, pagination } = await service.listDocuments(req.user._id, req.validatedQuery);
  sendSuccess(res, { documents: items, pagination });
}

export async function get(req, res) {
  sendSuccess(res, { document: await service.getDocument(req.user._id, req.params.id) });
}

export async function remove(req, res) {
  sendSuccess(res, await service.deleteDocument(req.user._id, req.params.id));
}
