import api from './api.js';

export function uploadDocument(file) {
  const form = new FormData();
  form.append('file', file);
  return api.post('/documents', form).then((r) => r.data.data); // { document, duplicate }
}
export const listDocuments = (page = 1, limit = 50) => api.get('/documents', { params: { page, limit } }).then((r) => r.data.data);
export const deleteDocument = (id) => api.delete(`/documents/${id}`).then((r) => r.data.data);
