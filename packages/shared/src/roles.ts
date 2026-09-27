export type MemberRole = 'owner' | 'admin' | 'member';

export const MEMBER_ROLES: readonly MemberRole[] = ['owner', 'admin', 'member'];

/** owner / admin 视为家庭管理者；与客户端 `lib/member.ts` 的判断保持一致。 */
export function isHouseholdManager(
  subject: { role: MemberRole } | null | undefined,
): boolean {
  return subject?.role === 'owner' || subject?.role === 'admin';
}
