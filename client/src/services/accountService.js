import api, { setCsrfToken } from './api.js';

export async function changePassword(body) {
  const { data } = await api.post('/users/me/password', body);
  setCsrfToken(data.data.csrfToken); // the server issued a fresh session for this device: keep using the new CSRF token
}

/** Fetches everything stored about the user and hands it to the browser as a .json download. */
export async function downloadMyData() {
  const { data } = await api.get('/users/me/export');
  const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'placementprep-export.json';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export const deleteAccount = (password) => api.delete('/users/me', { data: { password } }).then((r) => r.data.data);
