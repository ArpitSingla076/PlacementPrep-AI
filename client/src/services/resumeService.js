import api from './api.js';

export function uploadResume(file) {
  const form = new FormData();
  form.append('file', file); // field name must be "file" (the server's multer config)
  return api.post('/resumes', form).then((r) => r.data.data); // { resume, duplicate }
}
export const listResumes = (page = 1, limit = 20) => api.get('/resumes', { params: { page, limit } }).then((r) => r.data.data);
export const deleteResume = (id) => api.delete(`/resumes/${id}`).then((r) => r.data.data);
