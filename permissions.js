// Staff = anyone with the admin role, plus individual users listed in
// STAFF_USER_IDS (comma-separated Discord user IDs).
export function isStaff(member) {
  if (member.roles.cache.has(process.env.ADMIN_ROLE_ID)) return true;
  const allowed = (process.env.STAFF_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  return allowed.includes(member.id);
}
