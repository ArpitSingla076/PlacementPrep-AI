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
  timeout: 60_000, // a free-tier server that was idle can need up to about a minute to wake up
});

let csrfToken = null;
export const setCsrfToken = (token) => { csrfToken = token; };

const UNSAFE = new Set(['post', 'put', 'patch', 'delete']);

api.interceptors.request.use((config) => {
  const method = (config.method ?? 'get').toLowerCase();
  // Every GET gets a unique tag. A browser or CDN can then never answer with a stored copy of an earlier failure
  // (for example a 404 from a moment when the server was restarting). The server ignores the extra parameter.
  if (method === 'get') config.params = { ...config.params, _t: Date.now() };
  if (csrfToken && UNSAFE.has(method)) {
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
