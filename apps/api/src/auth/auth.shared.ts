import { Member, MemberRole } from '../entities';

export const AUTH_ACCOUNT_SELECT = {
  id: true,
  loginName: true,
  loginNameNormalized: true,
  passwordHash: true,
  disabledAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function memberProfile(member: Member) {
  return {
    id: member.id,
    householdId: member.householdId,
    name: member.name,
    avatarEmoji: member.avatarEmoji,
    role: member.role,
    prefersCooking: member.prefersCooking,
    disabledAt: member.disabledAt,
    createdAt: member.createdAt,
  };
}

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  owner: '家庭管理员',
  admin: '协管成员',
  member: '家庭成员',
};
