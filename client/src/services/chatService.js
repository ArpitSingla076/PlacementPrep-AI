import api from './api.js';

// Embedding the question + retrieval + generation can take a while.
export const askQuestion = (body) => api.post('/chat/ask', body, { timeout: 150_000 }).then((r) => r.data.data); // { conversationId, message }
export const listConversations = (page = 1, limit = 30) => api.get('/chat/conversations', { params: { page, limit } }).then((r) => r.data.data);
export const getConversation = (id) => api.get(`/chat/conversations/${id}`).then((r) => r.data.data.conversation);
export const deleteConversation = (id) => api.delete(`/chat/conversations/${id}`).then((r) => r.data.data);
