import api from './api.js';

export const listApplications = () => api.get('/applications').then((r) => r.data.data.applications);
export const createApplication = (body) => api.post('/applications', body).then((r) => r.data.data.application);
export const updateApplication = (id, body) => api.patch(`/applications/${id}`, body).then((r) => r.data.data.application);
export const deleteApplication = (id) => api.delete(`/applications/${id}`).then((r) => r.data.data);
