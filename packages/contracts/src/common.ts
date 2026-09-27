import { z } from 'zod';

// ---- 基础标量 ---------------------------------------------------------------

/** UUID 主键。 */
export const uuid = z.uuid();
/** 真实存在的纯日历日期；不代表 UTC 零点或任意时刻。 */
export const PlainDate = z.iso.date().refine((value) => {
  const [year, month, day] = value.split('-').map(Number);
  const roundTrip = new Date(0);
  roundTrip.setUTCFullYear(year, month - 1, day);
  return roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 && roundTrip.getUTCDate() === day;
}, '不是有效的日历日期');
export type PlainDate = z.infer<typeof PlainDate>;
/** 保持原契约的 dateOnly 名称，升级为严格纯日期校验。 */
export const dateOnly = PlainDate;
/** ISO 8601 时间戳（API 序列化 Date 后的形态）。 */
export const isoDateTime = z.iso.datetime({ offset: true });
/** 可为 null 的 ISO 时间戳。 */
export const nullableDateTime = isoDateTime.nullable();
/** 请求里允许只传日期或完整时间戳（对应 class-validator 的 IsISO8601）。 */
export const isoDateOrDateTime = z.union([dateOnly, isoDateTime]);

// ---- 家庭成员 ---------------------------------------------------------------

export const MEMBER_ROLES = ['owner', 'admin', 'member'] as const;
export const memberRole = z.enum(MEMBER_ROLES);
export type MemberRole = z.infer<typeof memberRole>;

/**
 * 成员公开档案。目前 API 直接回传实体，可能带有额外字段（accountId 等）；
 * Zod 4 的 z.object 默认忽略未知字段，所以只约束客户端依赖的字段即可。
 */
export const memberSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    name: z.string(),
    avatarEmoji: z.string(),
    role: memberRole,
    prefersCooking: z.boolean(),
    disabledAt: nullableDateTime.optional(),
    createdAt: isoDateTime.optional(),
  });
export type Member = z.infer<typeof memberSchema>;

/** presenter 手工挑出的成员摘要（guests / travel 等域用）。 */
export const memberBriefSchema = z.object({
  id: uuid,
  name: z.string(),
  avatarEmoji: z.string(),
});
export type MemberBrief = z.infer<typeof memberBriefSchema>;

// ---- 通用响应 ---------------------------------------------------------------

/** 归档类端点的统一响应：`{ id, archived: true }`。 */
export const archivedResponse = z.object({
  id: uuid,
  archived: z.literal(true),
});
export type ArchivedResponse = z.infer<typeof archivedResponse>;

/** 删除类端点的统一响应：`{ id, removed: true }`。 */
export const removedResponse = z.object({
  id: uuid,
  removed: z.literal(true),
});
export type RemovedResponse = z.infer<typeof removedResponse>;

/** API 错误响应体。 */
export const errorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
  requestId: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof errorResponse>;

/** 路径参数 `:id`。 */
export const idParams = z.object({ id: uuid });
