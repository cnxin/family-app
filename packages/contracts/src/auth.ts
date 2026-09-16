import { z } from 'zod';
import {
  idParams,
  isoDateTime,
  memberRole,
  nullableDateTime,
  uuid,
} from './common';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/auth/auth.module.ts（账号、会话、成员管理、邀请）
// 与 docs/m2-acceptance.md、docs/m3-members-activity-acceptance.md
//
// 加载方式说明（决定嵌套形态）：
// - login / refresh / bootstrap / redeem 通过 memberProfile()/accountProfile() 显式投影，字段固定；
// - GET /members 用 find({ select: AUTH_MEMBER_SELECT }) 再 memberProfile()，不含 account；
// - GET/PATCH /household/members* 用 QueryBuilder leftJoin account 再 managedMemberProfile()，带 account 摘要。

/** memberProfile() 的固定投影（不是实体透传）。 */
export const memberProfileSchema = z.object({
  id: uuid,
  householdId: uuid,
  name: z.string(),
  avatarEmoji: z.string(),
  role: memberRole,
  prefersCooking: z.boolean(),
  disabledAt: nullableDateTime,
  createdAt: isoDateTime,
});
export type MemberProfile = z.infer<typeof memberProfileSchema>;

export const accountProfileSchema = z.object({
  id: uuid,
  loginName: z.string(),
  requiresPasswordSetup: z.boolean(),
});
export type AccountProfile = z.infer<typeof accountProfileSchema>;

/** 登录 / 续期 / 初始化 / 兑换邀请共用的会话响应。`token` 是 `accessToken` 的旧别名。 */
export const authSessionSchema = z.object({
  token: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  account: accountProfileSchema,
  member: memberProfileSchema,
});
export type AuthSession = z.infer<typeof authSessionSchema>;

export const managedMemberSchema = memberProfileSchema.extend({
  account: z
    .object({
      loginName: z.string(),
      disabledAt: nullableDateTime,
    })
    .nullable(),
});
export type ManagedMember = z.infer<typeof managedMemberSchema>;

export const invitationRole = z.enum(['admin', 'member']);

export const householdInvitationSchema = z.object({
  id: uuid,
  memberName: z.string(),
  avatarEmoji: z.string(),
  role: invitationRole,
  expiresAt: isoDateTime,
  acceptedAt: nullableDateTime,
  revokedAt: nullableDateTime,
  createdAt: isoDateTime,
});
export type HouseholdInvitation = z.infer<typeof householdInvitationSchema>;

/** 只有创建那一次会回传明文令牌；服务端只存哈希。 */
export const createdHouseholdInvitationSchema = householdInvitationSchema.extend({
  invitationToken: z.string(),
});
export type CreatedHouseholdInvitation = z.infer<
  typeof createdHouseholdInvitationSchema
>;

export const invitationPreviewSchema = z.object({
  householdName: z.string(),
  memberName: z.string(),
  avatarEmoji: z.string(),
  role: invitationRole,
  expiresAt: isoDateTime,
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

// ---- 请求体 -----------------------------------------------------------------

export const loginBody = z.object({
  loginName: z.string().min(1).max(64),
  password: z.string().max(72).optional(),
  householdSlug: z.string().max(64).optional(),
});
export const refreshBody = z.object({
  refreshToken: z.string().min(32).max(256),
});
export const bootstrapBody = z.object({
  bootstrapSecret: z.string().min(16).max(256),
  householdName: z.string().min(1).max(64),
  householdSlug: z.string().min(2).max(64).optional(),
  timezone: z.string().max(64).optional(),
  ownerName: z.string().min(1).max(64),
  avatarEmoji: z.string().max(16).optional(),
  loginName: z.string().min(2).max(64),
  password: z.string().min(8).max(72),
});
export const invitationTokenBody = z.object({
  invitationToken: z.string().min(32).max(256),
});
export const redeemInvitationBody = invitationTokenBody.extend({
  loginName: z.string().min(2).max(64),
  password: z.string().min(1).max(72),
});
export const updatePreferencesBody = z.object({
  prefersCooking: z.boolean(),
});
export const updateManagedMemberBody = z.object({
  name: z.string().max(64).optional(),
  avatarEmoji: z.string().max(16).optional(),
  role: memberRole.optional(),
  prefersCooking: z.boolean().optional(),
});
export const updateManagedMemberStatusBody = z.object({
  enabled: z.boolean(),
});
export const updatePasswordBody = z.object({
  currentPassword: z.string().max(72).optional(),
  newPassword: z.string().min(8).max(72),
});
export const createInvitationBody = z.object({
  memberName: z.string().min(1).max(64),
  avatarEmoji: z.string().max(16).optional(),
  role: invitationRole.optional(),
  expiresInHours: z.number().int().min(1).max(168).optional(),
});

export const auth = {
  setupStatus: defineEndpoint({
    method: 'GET',
    path: '/auth/setup/status',
    summary: '是否已完成首户初始化（公开）',
    response: z.object({ initialized: z.boolean() }),
  }),
  bootstrap: defineEndpoint({
    method: 'POST',
    path: '/auth/setup/bootstrap',
    summary: '用一次性密钥创建首个家庭与 owner 账号（公开、限流）',
    body: bootstrapBody,
    response: authSessionSchema,
  }),
  login: defineEndpoint({
    method: 'POST',
    path: '/auth/login',
    summary: '账号密码登录（公开、限流；多家庭需指定 householdSlug）',
    body: loginBody,
    response: authSessionSchema,
  }),
  refresh: defineEndpoint({
    method: 'POST',
    path: '/auth/refresh',
    summary: '用刷新令牌续期并轮换（公开）',
    body: refreshBody,
    response: authSessionSchema,
  }),
  previewInvitation: defineEndpoint({
    method: 'POST',
    path: '/auth/invitations/preview',
    summary: '预览邀请（公开）',
    body: invitationTokenBody,
    response: invitationPreviewSchema,
  }),
  redeemInvitation: defineEndpoint({
    method: 'POST',
    path: '/auth/invitations/redeem',
    summary: '兑换邀请：创建账号并登录（公开、限流）',
    body: redeemInvitationBody,
    response: authSessionSchema,
  }),
  logout: defineEndpoint({
    method: 'POST',
    path: '/auth/logout',
    summary: '撤销当前会话',
    response: z.object({ revoked: z.literal(true) }),
  }),
  members: defineEndpoint({
    method: 'GET',
    path: '/members',
    summary: '家庭在用成员（公开档案投影）',
    response: z.array(memberProfileSchema),
  }),
  managedMembers: defineEndpoint({
    method: 'GET',
    path: '/household/members',
    summary: '管理视角的全部成员（含停用与账号摘要）',
    response: z.array(managedMemberSchema),
  }),
  updateManagedMember: defineEndpoint({
    method: 'PATCH',
    path: '/household/members/:id',
    summary: '修改成员资料 / 角色（角色变化会撤销其会话）',
    params: idParams,
    body: updateManagedMemberBody,
    response: managedMemberSchema,
  }),
  updateManagedMemberStatus: defineEndpoint({
    method: 'PATCH',
    path: '/household/members/:id/status',
    summary: '停用或恢复成员',
    params: idParams,
    body: updateManagedMemberStatusBody,
    response: managedMemberSchema,
  }),
  updatePreferences: defineEndpoint({
    method: 'PATCH',
    path: '/members/me/preferences',
    summary: '更新"经常掌勺"偏好',
    body: updatePreferencesBody,
    response: memberProfileSchema,
  }),
  updatePassword: defineEndpoint({
    method: 'PATCH',
    path: '/accounts/me/password',
    summary: '设置或修改密码（会撤销其他会话）',
    body: updatePasswordBody,
    response: accountProfileSchema,
  }),
  invitations: defineEndpoint({
    method: 'GET',
    path: '/household/invitations',
    summary: '有效邀请列表',
    response: z.array(householdInvitationSchema),
  }),
  createInvitation: defineEndpoint({
    method: 'POST',
    path: '/household/invitations',
    summary: '创建限时邀请（仅此响应含明文令牌）',
    body: createInvitationBody,
    response: createdHouseholdInvitationSchema,
  }),
  revokeInvitation: defineEndpoint({
    method: 'DELETE',
    path: '/household/invitations/:id',
    summary: '撤销邀请',
    params: idParams,
    response: householdInvitationSchema,
  }),
};
