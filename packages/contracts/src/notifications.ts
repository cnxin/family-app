import { z } from 'zod';
import {
  idParams,
  isoDateTime,
  memberSchema,
  nullableDateTime,
  uuid,
} from './common';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/notifications/*（站内通知、外部渠道、成员偏好、投递重试）
// 与 docs/m3-tasks-acceptance.md（通用通知）、docs/m6-external-notifications-acceptance.md

export const NOTIFICATION_MODULES = [
  'menu',
  'task',
  'poll',
  'calendar',
  'reminder',
  'media',
  'guest',
  'points',
  'agent',
  'system',
] as const;
export const notificationModule = z.enum(NOTIFICATION_MODULES);
export type NotificationModule = z.infer<typeof notificationModule>;

export const NOTIFICATION_CHANNEL_KINDS = ['webhook', 'ntfy'] as const;
export const notificationChannelKind = z.enum(NOTIFICATION_CHANNEL_KINDS);
export type NotificationChannelKind = z.infer<typeof notificationChannelKind>;

export const NOTIFICATION_DELIVERY_STATUSES = [
  'pending',
  'processing',
  'retry_scheduled',
  'sent',
  'failed',
] as const;
export const notificationDeliveryStatus = z.enum(NOTIFICATION_DELIVERY_STATUSES);
export type NotificationDeliveryStatus = z.infer<
  typeof notificationDeliveryStatus
>;

// ---- 站内通知 ---------------------------------------------------------------

export const appNotificationSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    recipientId: uuid,
    recipient: memberSchema,
    module: notificationModule,
    type: z.string(),
    sourceId: uuid.nullable(),
    title: z.string(),
    body: z.string().nullable(),
    targetPath: z.string(),
    readAt: nullableDateTime,
    createdAt: isoDateTime,
  });
export type AppNotification = z.infer<typeof appNotificationSchema>;

export const notificationListQuery = z.object({
  includeRead: z.enum(['true', 'false']).optional(),
  module: notificationModule.optional(),
});

// ---- 外部渠道 ---------------------------------------------------------------

export const notificationChannelPreferenceSchema = z.object({
  id: uuid.nullable(),
  isEnabled: z.boolean(),
  modules: z.array(notificationModule),
  updatedAt: nullableDateTime,
});
export type NotificationChannelPreference = z.infer<
  typeof notificationChannelPreferenceSchema
>;

/** 渠道视图：不含明文地址与凭据，只有提示串。 */
export const notificationChannelSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    name: z.string(),
    kind: notificationChannelKind,
    endpointHint: z.string(),
    credentialConfigured: z.boolean(),
    credentialHint: z.string().nullable(),
    isEnabled: z.boolean(),
    createdBy: memberSchema.nullable(),
    lastTestedAt: nullableDateTime,
    lastTestStatus: z.enum(['success', 'failed']).nullable(),
    lastTestError: z.string().nullable(),
    preference: notificationChannelPreferenceSchema,
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  });
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

export const createNotificationChannelBody = z.object({
  name: z.string().min(1).max(120),
  kind: notificationChannelKind,
  endpoint: z.string().min(8).max(2000),
  credential: z.string().min(4).max(2000).optional(),
  isEnabled: z.boolean().optional(),
});
export type CreateNotificationChannelBody = z.infer<
  typeof createNotificationChannelBody
>;

export const updateNotificationChannelBody = createNotificationChannelBody
  .partial()
  .extend({ clearCredential: z.boolean().optional() });
export type UpdateNotificationChannelBody = z.infer<
  typeof updateNotificationChannelBody
>;

export const updateNotificationPreferenceBody = z.object({
  isEnabled: z.boolean(),
  modules: z.array(notificationModule).min(1),
});
export type UpdateNotificationPreferenceBody = z.infer<
  typeof updateNotificationPreferenceBody
>;

export const notificationPreferenceResultSchema = z.object({
  id: uuid,
  channelId: uuid,
  memberId: uuid,
  isEnabled: z.boolean(),
  modules: z.array(notificationModule),
  updatedAt: isoDateTime,
});

export const channelTestResultSchema = z.object({
  success: z.literal(true),
  testedAt: isoDateTime,
});

// ---- 投递 -------------------------------------------------------------------

export const notificationDeliveryAttemptSchema = z
  .object({
    id: uuid,
    deliveryId: uuid,
    attemptNumber: z.number().int(),
    status: z.enum(['sent', 'failed']),
    httpStatus: z.number().int().nullable(),
    errorCode: z.string().nullable(),
    errorMessage: z.string().nullable(),
    startedAt: isoDateTime,
    finishedAt: isoDateTime,
    createdAt: isoDateTime,
  });
export type NotificationDeliveryAttempt = z.infer<
  typeof notificationDeliveryAttemptSchema
>;

/** 投递实体。retry 端点用 QueryBuilder 加载，此时 notification/recipient 未带出。 */
export const notificationDeliveryRecordSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    notificationId: uuid,
    notification: appNotificationSchema.optional(),
    recipientId: uuid,
    recipient: memberSchema.optional(),
    channelId: uuid.nullable(),
    channelName: z.string(),
    channelKind: notificationChannelKind,
    endpointHint: z.string(),
    status: notificationDeliveryStatus,
    attemptCount: z.number().int(),
    maxAttempts: z.number().int(),
    nextAttemptAt: nullableDateTime,
    lastAttemptAt: nullableDateTime,
    deliveredAt: nullableDateTime,
    lastError: z.string().nullable(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  });
export type NotificationDeliveryRecord = z.infer<
  typeof notificationDeliveryRecordSchema
>;

/** 投递列表行：实体 + 尝试历史 + 可重试判断。 */
export const notificationDeliverySchema = notificationDeliveryRecordSchema.extend({
  notification: appNotificationSchema,
  recipient: memberSchema,
  attempts: z.array(notificationDeliveryAttemptSchema),
  canRetry: z.boolean(),
});
export type NotificationDelivery = z.infer<typeof notificationDeliverySchema>;

export const notificationDeliveryQuery = z.object({
  status: z.enum([...NOTIFICATION_DELIVERY_STATUSES, 'all']).optional(),
});

export const notifications = {
  list: defineEndpoint({
    method: 'GET',
    path: '/notifications',
    summary: '我的站内通知（默认只看未读，最多 30/50 条）',
    query: notificationListQuery,
    response: z.array(appNotificationSchema),
  }),
  markAllRead: defineEndpoint({
    method: 'PATCH',
    path: '/notifications/read-all',
    summary: '全部标记已读',
    response: z.object({ updated: z.number().int() }),
  }),
  markRead: defineEndpoint({
    method: 'PATCH',
    path: '/notifications/:id/read',
    summary: '标记单条已读（菜单类同步 menu_events）',
    params: idParams,
    response: appNotificationSchema,
  }),
  channels: defineEndpoint({
    method: 'GET',
    path: '/notification-channels',
    summary: '外部渠道列表（含我的接收偏好）',
    response: z.array(notificationChannelSchema),
  }),
  createChannel: defineEndpoint({
    method: 'POST',
    path: '/notification-channels',
    summary: '管理员新建 Webhook / ntfy 渠道（地址与凭据加密存储）',
    body: createNotificationChannelBody,
    response: notificationChannelSchema,
  }),
  updateChannel: defineEndpoint({
    method: 'PATCH',
    path: '/notification-channels/:id',
    summary: '修改渠道',
    params: idParams,
    body: updateNotificationChannelBody,
    response: notificationChannelSchema,
  }),
  deleteChannel: defineEndpoint({
    method: 'DELETE',
    path: '/notification-channels/:id',
    summary: '删除渠道',
    params: idParams,
    response: z.object({ id: uuid, deleted: z.literal(true) }),
  }),
  testChannel: defineEndpoint({
    method: 'POST',
    path: '/notification-channels/:id/test',
    summary: '发送测试投递（失败返回 502）',
    params: idParams,
    response: channelTestResultSchema,
  }),
  updatePreference: defineEndpoint({
    method: 'PUT',
    path: '/notification-channels/:id/preference',
    summary: '设置我在该渠道接收哪些模块',
    params: idParams,
    body: updateNotificationPreferenceBody,
    response: notificationPreferenceResultSchema,
  }),
  deliveries: defineEndpoint({
    method: 'GET',
    path: '/notification-deliveries',
    summary: '投递记录（管理员看全家，成员只看自己）',
    query: notificationDeliveryQuery,
    response: z.array(notificationDeliverySchema),
  }),
  retryDelivery: defineEndpoint({
    method: 'POST',
    path: '/notification-deliveries/:id/retry',
    summary: '人工重试失败投递',
    params: idParams,
    response: notificationDeliveryRecordSchema,
  }),
};
