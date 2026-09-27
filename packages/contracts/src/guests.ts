import { z } from 'zod';
import {
  dateOnly,
  idParams,
  isoDateOrDateTime,
  isoDateTime,
  memberBriefSchema,
  nullableDateTime,
  uuid,
} from './common';
import { dishCategory } from './dishes';
import { mealType } from './menus';
import { pollVoteMode } from './polls';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/guests/guests.module.ts 与 docs/m9-guests-acceptance.md
//
// 这个域所有响应都经过 profile*() 逐字段挑选，不直接回传实体，
// 所以加载路径（relations / save()）不会漏字段到响应里；下面的 schema 按 presenter 逐个对照。
// 带 :token 的端点是 @Public，给访客用；token 是 32～256 位 base64url，服务端只存哈希。

export const VISIT_STATUSES = ['scheduled', 'cancelled', 'completed'] as const;
export const visitStatus = z.enum(VISIT_STATUSES);
export type VisitStatus = z.infer<typeof visitStatus>;

export const GUEST_WIFI_SECURITIES = ['WPA', 'nopass'] as const;
export const guestWifiSecurity = z.enum(GUEST_WIFI_SECURITIES);
export type GuestWifiSecurity = z.infer<typeof guestWifiSecurity>;

export const GUEST_MEAL_REQUEST_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export const guestMealRequestStatus = z.enum(GUEST_MEAL_REQUEST_STATUSES);
export type GuestMealRequestStatus = z.infer<typeof guestMealRequestStatus>;

/** 邀请令牌路径参数；正则与 activeInvitation() 一致。 */
export const invitationTokenParams = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
});

// ---- 响应 -------------------------------------------------------------------

/** profileGuest() */
export const guestSchema = z.object({
  id: uuid,
  name: z.string(),
  avatarEmoji: z.string(),
  note: z.string().nullable(),
  isActive: z.boolean(),
  anonymizedAt: nullableDateTime,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Guest = z.infer<typeof guestSchema>;

/** profileGuestWifi()：密码只回传"是否已配置"。 */
export const guestWifiProfileSchema = z.object({
  id: uuid,
  name: z.string(),
  ssid: z.string(),
  security: guestWifiSecurity,
  passwordConfigured: z.boolean(),
  isActive: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type GuestWifiProfile = z.infer<typeof guestWifiProfileSchema>;

/** invitationProfile() */
export const guestInvitationSchema = z.object({
  id: uuid,
  guestId: uuid,
  expiresAt: isoDateTime,
  acceptedAt: nullableDateTime,
  allowsMovieVoting: z.boolean(),
  allowsMealRequests: z.boolean(),
  revokedAt: nullableDateTime,
  createdAt: isoDateTime,
});
export type GuestInvitation = z.infer<typeof guestInvitationSchema>;

/** 只有创建那一次回传明文令牌。 */
export const createdGuestInvitationSchema = guestInvitationSchema.extend({
  invitationToken: z.string(),
});
export type CreatedGuestInvitation = z.infer<typeof createdGuestInvitationSchema>;

/** profileGuestMealRequest()；来访详情里的 mealRequests 额外带 guest。 */
export const guestMealRequestSchema = z.object({
  id: uuid,
  menuItemId: uuid.nullable(),
  mealDate: dateOnly,
  mealType,
  dishName: z.string(),
  note: z.string().nullable(),
  status: guestMealRequestStatus,
  reviewNote: z.string().nullable(),
  reviewedAt: nullableDateTime,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  guest: guestSchema.optional().nullable(),
});
export type GuestMealRequest = z.infer<typeof guestMealRequestSchema>;

/** profileVisit()：relations 到 guests.guest / mealRequests.invitation.guest 为止，都是显式加载。 */
export const visitSchema = z.object({
  id: uuid,
  title: z.string(),
  startsAt: isoDateTime,
  endsAt: nullableDateTime,
  note: z.string().nullable(),
  status: visitStatus,
  guestWifiProfile: guestWifiProfileSchema.nullable(),
  hostMember: memberBriefSchema.nullable(),
  guests: z.array(
    z.object({
      id: uuid,
      guest: guestSchema,
      isAttending: z.boolean().nullable(),
      respondedAt: nullableDateTime,
      invitation: guestInvitationSchema.nullable(),
    }),
  ),
  mealRequests: z.array(guestMealRequestSchema),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Visit = z.infer<typeof visitSchema>;

/** publicProfile()：访客侧看到的邀请页。 */
export const guestInvitationPreviewSchema = z.object({
  guest: z.object({ name: z.string(), avatarEmoji: z.string() }),
  householdName: z.string(),
  visit: z.object({
    title: z.string(),
    startsAt: isoDateTime,
    endsAt: nullableDateTime,
    note: z.string().nullable(),
  }),
  response: z.object({
    attending: z.boolean().nullable(),
    respondedAt: nullableDateTime,
  }),
  capabilities: z.object({ movieVoting: z.boolean(), mealRequests: z.boolean() }),
  mealRequestDates: z.array(dateOnly),
  wifi: z
    .object({ ssid: z.string(), security: guestWifiSecurity, qrPayload: z.string() })
    .nullable(),
  expiresAt: isoDateTime,
});
export type GuestInvitationPreview = z.infer<typeof guestInvitationPreviewSchema>;

/** publicMealOptions()：来访期间开放菜单里可选的菜。 */
export const guestMealOptionSchema = z.object({
  id: uuid,
  mealDate: dateOnly,
  mealType,
  items: z.array(
    z.object({
      id: uuid,
      dishName: z.string(),
      dishCategory,
      photoUrl: z.string().nullable(),
      request: guestMealRequestSchema.nullable(),
    }),
  ),
});
export type GuestMealOption = z.infer<typeof guestMealOptionSchema>;

/** publicMoviePollProfile()：不暴露成员投票明细，只给计数。 */
export const guestMoviePollSchema = z.object({
  id: uuid,
  title: z.string(),
  description: z.string().nullable(),
  voteMode: pollVoteMode,
  maxChoices: z.number().int(),
  closesAt: nullableDateTime,
  totalVoters: z.number().int(),
  selectedOptionIds: z.array(uuid),
  options: z.array(
    z.object({
      id: uuid,
      label: z.string(),
      description: z.string().nullable(),
      voteCount: z.number().int(),
      media: z
        .object({
          title: z.string(),
          originalTitle: z.string().nullable(),
          year: z.number().int().nullable(),
          posterUrl: z.string().nullable(),
        })
        .nullable(),
    }),
  ),
});
export type GuestMoviePoll = z.infer<typeof guestMoviePollSchema>;

// ---- 请求 -------------------------------------------------------------------

export const createGuestBody = z.object({
  name: z.string().min(1).max(64),
  avatarEmoji: z.string().max(16).optional(),
  note: z.string().max(240).nullish(),
});
export const updateGuestBody = createGuestBody
  .partial()
  .extend({ isActive: z.boolean().optional() });

export const createGuestWifiProfileBody = z.object({
  name: z.string().min(1).max(64),
  ssid: z.string().min(1).max(32),
  security: guestWifiSecurity,
  password: z.string().max(63).nullish(),
});
export const updateGuestWifiProfileBody = createGuestWifiProfileBody
  .partial()
  .extend({ isActive: z.boolean().optional() });

export const createVisitBody = z.object({
  title: z.string().min(1).max(120),
  startsAt: isoDateOrDateTime,
  endsAt: isoDateOrDateTime.nullish(),
  note: z.string().max(1000).nullish(),
  hostMemberId: uuid.optional(),
  guestWifiProfileId: uuid.nullish(),
  guestIds: z.array(uuid),
});
export const updateVisitBody = createVisitBody
  .partial()
  .extend({ status: visitStatus.optional() });
export const visitListQuery = z.object({ status: visitStatus.optional() });

export const createGuestInvitationBody = z.object({
  guestId: uuid,
  expiresInHours: z.number().int().min(1).max(24 * 30).optional(),
  allowsMovieVoting: z.boolean().optional(),
  allowsMealRequests: z.boolean().optional(),
});

export const guestResponseBody = z.object({ attending: z.boolean() });
export const guestPollVoteBody = z.object({ optionIds: z.array(uuid) });
export const guestMealRequestBody = z.object({
  mealDate: dateOnly,
  mealType,
  dishName: z.string().min(1).max(120),
  note: z.string().max(300).nullish(),
});
export const reviewGuestMealRequestBody = z.object({
  status: z.enum(['accepted', 'rejected']),
  reviewNote: z.string().max(200).nullish(),
});

// ---- 端点 -------------------------------------------------------------------

export const guests = {
  list: defineEndpoint({
    method: 'GET',
    path: '/guests',
    summary: '访客名册（停用的排后面）',
    response: z.array(guestSchema),
  }),
  create: defineEndpoint({
    method: 'POST',
    path: '/guests',
    summary: '新增访客',
    body: createGuestBody,
    response: guestSchema,
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: '/guests/:id',
    summary: '修改或停用访客（已匿名化的不能改）',
    params: idParams,
    body: updateGuestBody,
    response: guestSchema,
  }),
  anonymize: defineEndpoint({
    method: 'POST',
    path: '/guests/:id/anonymize',
    summary: '匿名化访客资料并撤销其有效邀请（幂等）',
    params: idParams,
    response: guestSchema,
  }),
  wifiProfiles: defineEndpoint({
    method: 'GET',
    path: '/guest-wifi-profiles',
    summary: '访客 Wi-Fi 配置',
    response: z.array(guestWifiProfileSchema),
  }),
  createWifiProfile: defineEndpoint({
    method: 'POST',
    path: '/guest-wifi-profiles',
    summary: '新增访客 Wi-Fi 配置（密码加密存储）',
    body: createGuestWifiProfileBody,
    response: guestWifiProfileSchema,
  }),
  updateWifiProfile: defineEndpoint({
    method: 'PATCH',
    path: '/guest-wifi-profiles/:id',
    summary: '修改或停用访客 Wi-Fi 配置',
    params: idParams,
    body: updateGuestWifiProfileBody,
    response: guestWifiProfileSchema,
  }),
  visits: defineEndpoint({
    method: 'GET',
    path: '/visits',
    summary: '来访计划（含参与访客、邀请与点菜请求）',
    query: visitListQuery,
    response: z.array(visitSchema),
  }),
  createVisit: defineEndpoint({
    method: 'POST',
    path: '/visits',
    summary: '安排来访',
    body: createVisitBody,
    response: visitSchema,
  }),
  updateVisit: defineEndpoint({
    method: 'PATCH',
    path: '/visits/:id',
    summary: '修改来访（换访客或取消会撤销既有邀请）',
    params: idParams,
    body: updateVisitBody,
    response: visitSchema,
  }),
  createInvitation: defineEndpoint({
    method: 'POST',
    path: '/visits/:id/invitations',
    summary: '给来访中的某位访客签发邀请链接（旧邀请作废）',
    params: idParams,
    body: createGuestInvitationBody,
    response: createdGuestInvitationSchema,
  }),
  revokeInvitation: defineEndpoint({
    method: 'DELETE',
    path: '/guest-invitations/:id',
    summary: '撤销邀请（幂等）',
    params: idParams,
    response: z.object({ id: uuid, revoked: z.literal(true) }),
  }),
  publicInvitation: defineEndpoint({
    method: 'GET',
    path: '/guest-invitations/:token',
    summary: '访客查看邀请（公开）',
    params: invitationTokenParams,
    response: guestInvitationPreviewSchema,
  }),
  respond: defineEndpoint({
    method: 'POST',
    path: '/guest-invitations/:token/response',
    summary: '访客回复是否参加（只能回复一次，公开）',
    params: invitationTokenParams,
    body: guestResponseBody,
    response: guestInvitationPreviewSchema,
  }),
  publicMoviePolls: defineEndpoint({
    method: 'GET',
    path: '/guest-invitations/:token/movie-polls',
    summary: '访客可参与的观影投票（公开）',
    params: invitationTokenParams,
    response: z.array(guestMoviePollSchema),
  }),
  voteMoviePoll: defineEndpoint({
    method: 'POST',
    path: '/guest-invitations/:token/movie-polls/:pollId/votes',
    summary: '访客投票（覆盖式，公开）',
    params: invitationTokenParams.extend({ pollId: uuid }),
    body: guestPollVoteBody,
    response: guestMoviePollSchema,
  }),
  publicMealRequests: defineEndpoint({
    method: 'GET',
    path: '/guest-invitations/:token/meal-requests',
    summary: '访客自己的点菜请求（公开）',
    params: invitationTokenParams,
    response: z.array(guestMealRequestSchema),
  }),
  publicMealOptions: defineEndpoint({
    method: 'GET',
    path: '/guest-invitations/:token/meal-options',
    summary: '来访期间开放菜单里可选的菜（公开）',
    params: invitationTokenParams,
    response: z.array(guestMealOptionSchema),
  }),
  claimMealOption: defineEndpoint({
    method: 'POST',
    path: '/guest-invitations/:token/meal-options/:menuItemId/request',
    summary: '访客从菜单里选一道菜（幂等，公开）',
    params: invitationTokenParams.extend({ menuItemId: uuid }),
    response: guestMealRequestSchema,
  }),
  submitMealRequest: defineEndpoint({
    method: 'POST',
    path: '/guest-invitations/:token/meal-requests',
    summary: '访客自由点菜（同日同餐覆盖，公开）',
    params: invitationTokenParams,
    body: guestMealRequestBody,
    response: guestMealRequestSchema,
  }),
  reviewMealRequest: defineEndpoint({
    method: 'PATCH',
    path: '/guest-meal-requests/:id',
    summary: '家庭成员接受或婉拒点菜请求',
    params: idParams,
    body: reviewGuestMealRequestBody,
    response: guestMealRequestSchema,
  }),
};
