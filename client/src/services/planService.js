import api from './api.js';

export const getPlan = () => api.get('/preparation-plans/current').then((r) => r.data.data.plan);
export const generatePlan = (body = {}) => api.post('/preparation-plans/generate', body, { timeout: 150_000 }).then((r) => r.data.data.plan);
export const setItemCompleted = (key, completed) => api.patch(`/preparation-plans/current/items/${encodeURIComponent(key)}`, { completed }).then((r) => r.data.data.plan);
export const getProgress = (params) => api.get('/progress/summary', { params }).then((r) => r.data.data);
