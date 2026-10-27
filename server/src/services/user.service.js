import { User } from '../models/User.js';

/**
 * Only the fields listed here can be changed through the profile endpoint.
 * (An explicit allow-list is the defence against mass assignment, e.g. someone sending {"passwordHash": "..."}.)
 */
export async function updateProfile(userId, { name, targetRoles, aiDataConsent }) {
  const user = await User.findById(userId);
  if (name !== undefined) user.name = name;
  if (targetRoles !== undefined) user.targetRoles = targetRoles;
  if (aiDataConsent !== undefined && aiDataConsent !== user.preferences.aiDataConsent.given) {
    user.preferences.aiDataConsent.given = aiDataConsent;
    user.preferences.aiDataConsent.givenAt = aiDataConsent ? new Date() : null;
  }
  await user.save();
  return user;
}
