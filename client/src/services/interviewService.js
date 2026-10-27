import api from './api.js';

export const createInterview = (body) => api.post('/interviews', body, { timeout: 150_000 }).then((r) => r.data.data.interview);
export const listInterviews = (page = 1, limit = 10) => api.get('/interviews', { params: { page, limit } }).then((r) => r.data.data);
export const getInterview = (id) => api.get(`/interviews/${id}`).then((r) => r.data.data.interview);
export const submitAnswer = (id, body) => api.post(`/interviews/${id}/answers`, body, { timeout: 150_000 }).then((r) => r.data.data.interview);
export const completeInterview = (id) => api.post(`/interviews/${id}/complete`).then((r) => r.data.data.interview);
export const deleteInterview = (id) => api.delete(`/interviews/${id}`).then((r) => r.data.data);
