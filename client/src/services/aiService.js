import api from './api.js';

/** { provider, model, configured, consentGiven, quota: { limit, remaining, windowMinutes } } - never contains secrets. */
export const getAiStatus = () => api.get('/ai/status').then((r) => r.data.data);
