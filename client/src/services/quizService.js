import api from './api.js';

export const createQuiz = (body) => api.post('/quizzes', body, { timeout: 150_000 }).then((r) => r.data.data.quiz);
export const listQuizzes = (page = 1, limit = 6) => api.get('/quizzes', { params: { page, limit } }).then((r) => r.data.data);
export const getQuiz = (id) => api.get(`/quizzes/${id}`).then((r) => r.data.data.quiz);
export const submitQuiz = (id, answers) => api.post(`/quizzes/${id}/submit`, { answers }).then((r) => r.data.data.quiz);
export const deleteQuiz = (id) => api.delete(`/quizzes/${id}`).then((r) => r.data.data);
