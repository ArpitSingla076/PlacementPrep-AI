import api, { setCsrfToken } from './api.js';

// Each function returns { user } and keeps the in-memory CSRF token in sync.
async function unwrap(promise) {
  const { data } = await promise;
  setCsrfToken(data.data.csrfToken ?? null);
  return data.data.user;
}

export const register = (body) => unwrap(api.post('/auth/register', body));
export const login = (body) => unwrap(api.post('/auth/login', body));
export const fetchCurrentUser = () => unwrap(api.get('/auth/me'));

export async function logout() {
  await api.post('/auth/logout');
  setCsrfToken(null);
}
export async function logoutEverywhere() {
  await api.post('/auth/logout-all');
  setCsrfToken(null);
}
