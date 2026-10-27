import * as service from '../services/knowledge/rag.service.js';
import { sendSuccess } from '../utils/response.js';

export const ask = (deps) => async (req, res) => {
  sendSuccess(res, await service.askQuestion({ user: req.user, ...req.body }, deps));
};

export async function listConversations(req, res) {
  const { items, pagination } = await service.listConversations(req.user._id, req.validatedQuery);
  sendSuccess(res, { conversations: items.map((c) => ({ id: c._id.toString(), title: c.title, updatedAt: c.updatedAt })), pagination });
}

export async function getConversation(req, res) {
  const conv = await service.getConversation(req.user._id, req.params.id);
  sendSuccess(res, { conversation: { id: conv._id.toString(), title: conv.title, messages: conv.messages } });
}

export async function removeConversation(req, res) {
  await service.deleteConversation(req.user._id, req.params.id);
  sendSuccess(res, { deleted: true });
}
