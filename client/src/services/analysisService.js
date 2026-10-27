import api from './api.js';

// An analysis calls an external AI model and can take up to a minute, so it gets a longer timeout than other requests.
export const createAnalysis = (body) => api.post('/job-analyses', body, { timeout: 150_000 }).then((r) => r.data.data); // { analysis, cached }
export const listAnalyses = (page = 1, limit = 10) => api.get('/job-analyses', { params: { page, limit } }).then((r) => r.data.data);
export const getAnalysis = (id) => api.get(`/job-analyses/${id}`).then((r) => r.data.data.analysis);
export const deleteAnalysis = (id) => api.delete(`/job-analyses/${id}`).then((r) => r.data.data);
export const compareAnalyses = (a, b) => api.get('/job-analyses/compare', { params: { a, b } }).then((r) => r.data.data.comparison);
