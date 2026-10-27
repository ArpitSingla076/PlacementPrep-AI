import api from './api.js';

export async function updateProfile(changes) {
  const { data } = await api.patch('/users/me', changes);
  return data.data.user;
}
