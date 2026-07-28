import type { Member, MemberRole } from './types';

export function memberRoleLabel(role: MemberRole) {
  if (role === 'owner') return '家庭管理员';
  if (role === 'admin') return '协管成员';
  return '家庭成员';
}

export function memberSubtitle(member: Member) {
  const role = memberRoleLabel(member.role);
  return member.prefersCooking ? `${role} · 经常掌勺` : role;
}
