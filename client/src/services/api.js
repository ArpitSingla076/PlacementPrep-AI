import axios from 'axios';

/**
 * One configured HTTP client for the whole app.
 *  - withCredentials: the browser sends the httpOnly session cookie.
 *  - The CSRF token lives only in memory (a module variable), never in localStorage:
 *    anything in localStorage can be read by injected scripts. After a page refresh we get it back from GET /auth/me.
 */
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
  timeout: 30_000,
});

let csrfToken = null;
export const setCsrfToken = (token) => { csrfToken = token; };

const UNSAFE = new Set(['post', 'put', 'patch', 'delete']);

api.interceptors.request.use((config) => {
  if (csrfToken && UNSAFE.has((config.method ?? 'get').toLowerCase())) {
    config.headers['X-CSRF-Token'] = csrfToken;
  }
  return config;
});

// If the server says the session is gone, tell the app so it can show the login page.
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const code = error.response?.data?.error?.code;
    if (code === 'SESSION_EXPIRED') window.dispatchEvent(new Event('auth:expired'));
    return Promise.reject(error);
  },
);

export default api;
