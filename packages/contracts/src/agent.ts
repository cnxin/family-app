import { z } from 'zod';
import { idParams, isoDateTime, nullableDateTime, uuid } from './common';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/agent/*.ts 与 docs/m14-agent-acceptance.md
//
// 40 个端点的响应全部经 presentXxx() 逐字段挑选或手写字面量对象，没有直接回传实体，
// 所以 relations / eager / save() 那套加载路径规律不影响响应形状。
//
// ## 两个需要写明的取舍
//
// 1）**六个 `@Res()` 端点的契约是 `z.undefined()`，不是遗漏。**
//    `internal/agent/channels` 的三个端点与 `internal/agent/mcp` 的三个端点都用 `@Res()`
//    自己写响应体（前者手写 `{data}` 包装，后者由 MCP SDK 生成 JSON-RPC，
//    且 Content-Type 随请求的 Accept 头在 application/json 与 text/event-stream 之间变）。
//    处理函数本身不返回值，拦截器拿到的就是 `undefined`，所以 `z.undefined()` 是这几个端点
//    **准确**的契约——它断言的是"响应体不经过拦截器"，而不是"响应体为空"。
//    代价是这六个端点的实际 wire 格式不受契约保护；真要覆盖得另写黑盒断言。
//    注册它们（而不是留空）是为了让 `docs/api-inventory.md` 的覆盖率等于真实覆盖意图：
//    没有契约的行 = 还没做，`z.undefined()` 的行 = 已经判定为不适用。
//
// 2）**时序字段被刻意放宽，代价是失去约束。**
//    这个域有两个后台循环（`AgentRoutineService` 轮询例行任务、`AgentRetentionService` 物理清理），
//    外加 `queueMessage` / `retry` 之后 fire-and-forget 的 `processRun`。于是：
//    - `AgentRun.status` 在写端点返回时基本是 `queued`，在 `detail()` 里取决于 worker 跑到哪；
//    - `messages` 会从 1 条变 2 条（助手回复落库），也可能被保留策略清空；
//    - `toolEvents` / `proposals` 只有真的调过工具才有元素。
//    所以 status 用完整 union、数组一律不加 `.min()`、`errorCode` / `errorMessage` 不枚举。
//    这样能消除偶发失败，但也意味着**这些字段实际上不再被契约校验**——worker 若有 bug 让
//    `messages` 永远为空，契约不会报。Phase 3 把调度抽成可控的（测试里能同步 drain 队列）之后，
//    这些放宽应该收回来。

export const AGENT_RUNTIME_KINDS = ['fake', 'hermes'] as const;
export const agentRuntimeKind = z.enum(AGENT_RUNTIME_KINDS);
export type AgentRuntimeKind = z.infer<typeof agentRuntimeKind>;

export const AGENT_RESPONSE_STYLES = ['concise', 'balanced', 'detailed'] as const;
export const agentResponseStyle = z.enum(AGENT_RESPONSE_STYLES);
export type AgentResponseStyle = z.infer<typeof agentResponseStyle>;

export const AGENT_ROUTINE_KINDS = ['nightly_digest', 'weekly_report'] as const;
export const agentRoutineKind = z.enum(AGENT_ROUTINE_KINDS);
export type AgentRoutineKind = z.infer<typeof agentRoutineKind>;

export const AGENT_MEMORY_SCOPES = ['member_private', 'household'] as const;
export const agentMemoryScope = z.enum(AGENT_MEMORY_SCOPES);
export type AgentMemoryScope = z.infer<typeof agentMemoryScope>;

export const AGENT_MEMORY_KINDS = [
  'preference',
  'fact',
  'episodic_summary',
  'routine_context',
] as const;
export const agentMemoryKind = z.enum(AGENT_MEMORY_KINDS);
export type AgentMemoryKind = z.infer<typeof agentMemoryKind>;

export const AGENT_MEMORY_STATUSES = [
  'candidate',
  'active',
  'revoked',
  'forgotten',
  'expired',
] as const;
export const agentMemoryStatus = z.enum(AGENT_MEMORY_STATUSES);
export type AgentMemoryStatus = z.infer<typeof agentMemoryStatus>;

export const AGENT_MEMORY_CONFIDENCE_SOURCES = [
  'explicit',
  'business',
  'summary_candidate',
] as const;
export const agentMemoryConfidenceSource = z.enum(AGENT_MEMORY_CONFIDENCE_SOURCES);
export type AgentMemoryConfidenceSource = z.infer<typeof agentMemoryConfidenceSource>;

export const AGENT_MEMORY_KEYS = [
  'diet_restriction',
  'spice_level',
  'cooking_skill',
  'schedule_preference',
  'reply_style',
  'other',
] as const;
export const agentMemoryKey = z.enum(AGENT_MEMORY_KEYS);
export type AgentMemoryKey = z.infer<typeof agentMemoryKey>;

export const AGENT_CONVERSATION_STATUSES = ['active', 'archived', 'expired'] as const;
export const agentConversationStatus = z.enum(AGENT_CONVERSATION_STATUSES);

export const AGENT_RUN_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;
export const agentRunStatus = z.enum(AGENT_RUN_STATUSES);
export type AgentRunStatus = z.infer<typeof agentRunStatus>;

export const AGENT_TOOL_EVENT_STATUSES = ['running', 'completed', 'failed'] as const;
export const agentToolEventStatus = z.enum(AGENT_TOOL_EVENT_STATUSES);

export const AGENT_ACTION_TYPES = [
  'task',
  'reminder',
  'poll',
  'menu',
  'shopping',
  'finance',
] as const;
export const agentActionType = z.enum(AGENT_ACTION_TYPES);
export type AgentActionType = z.infer<typeof agentActionType>;

export const AGENT_PROPOSAL_STATUSES = [
  'pending',
  'confirmed',
  'executed',
  'rejected',
  'expired',
  'failed',
] as const;
export const agentProposalStatus = z.enum(AGENT_PROPOSAL_STATUSES);
export type AgentProposalStatus = z.infer<typeof agentProposalStatus>;

export const AGENT_PROPOSAL_GROUP_STATUSES = [
  'pending',
  'confirmed',
  'rejected',
  'expired',
  'failed',
] as const;
export const agentProposalGroupStatus = z.enum(AGENT_PROPOSAL_GROUP_STATUSES);
export type AgentProposalGroupStatus = z.infer<typeof agentProposalGroupStatus>;

export const AGENT_PROPOSAL_GROUP_EVENT_OPERATIONS = [
  'created',
  'confirmed',
  'rejected',
  'expired',
  'failed',
] as const;
export const agentProposalGroupEventOperation = z.enum(
  AGENT_PROPOSAL_GROUP_EVENT_OPERATIONS,
);

/** 配对码状态是 presentPairing() 派生的，实体里没有这一列。 */
export const AGENT_CHANNEL_PAIRING_STATUSES = ['pending', 'used', 'expired', 'revoked'] as const;
export const agentChannelPairingStatus = z.enum(AGENT_CHANNEL_PAIRING_STATUSES);
export type AgentChannelPairingStatus = z.infer<typeof agentChannelPairingStatus>;

export const AGENT_PAGE_ENTITY_TYPES = ['dish', 'asset', 'knowledge', 'travel', 'poll'] as const;
export const agentPageEntityType = z.enum(AGENT_PAGE_ENTITY_TYPES);
export type AgentPageEntityType = z.infer<typeof agentPageEntityType>;
/** 客户端发起会话消息时可带的页面上下文。 */
export type AgentPageContext = z.infer<typeof agentPageContextInput>;

export const AGENT_READ_TOOLS = [
  'get_today_summary',
  'get_calendar',
  'get_tasks',
  'get_shopping_list',
  'get_meal_plan',
  'get_inventory_alerts',
  'search_knowledge',
  'get_travel_checklist',
  'get_watch_candidates',
  'get_recent_memories',
  'get_member_tasks',
  'get_family_schedule',
  'get_inventory_summary',
  'search_recipes',
  'get_dish_plan',
  'get_weather',
  'get_member_profile',
  'get_asset_detail',
  'get_finance_summary',
] as const;
export const AGENT_PROPOSAL_TOOLS = [
  'propose_task',
  'propose_reminder',
  'propose_poll',
  'propose_menu',
  'propose_shopping_items',
  'propose_plan',
  'propose_finance_transaction',
] as const;

const expectedVersion = z.number().int().min(1);
const clientRequestId = z.string().min(1).max(180);

// ---- 响应：状态与设置 --------------------------------------------------------

/** AgentRuntimeHealth；接口上 message 是可选的，两个 runtime 的所有分支都填了。 */
export const agentRuntimeHealthSchema = z.object({
  available: z.boolean(),
  configured: z.boolean(),
  version: z.string(),
  message: z.string().optional(),
});
export type AgentRuntimeHealth = z.infer<typeof agentRuntimeHealthSchema>;

export const agentStatusSchema = z.object({
  enabled: z.boolean(),
  runtimeKind: agentRuntimeKind,
  selected: agentRuntimeHealthSchema,
  runtimes: z.object({
    fake: agentRuntimeHealthSchema,
    hermes: agentRuntimeHealthSchema,
  }),
  fallbackAvailable: z.boolean(),
  persistenceEncrypted: z.boolean(),
  readToolsEnabled: z.array(z.string()),
  proposalToolsEnabled: z.array(z.string()),
});
export type AgentStatus = z.infer<typeof agentStatusSchema>;

/** presentSettings() */
export const agentSettingsSchema = z.object({
  enabled: z.boolean(),
  runtimeKind: agentRuntimeKind,
  runtimeProfile: z.string(),
  modelAlias: z.string(),
  retentionDays: z.number().int(),
  dailyRoutineNotificationLimit: z.number().int(),
  routineNotificationsEnabled: z.boolean(),
  readToolsEnabled: z.array(z.string()),
  proposalToolsEnabled: z.array(z.string()),
  version: z.number().int(),
  updatedAt: isoDateTime,
});
export type AgentSettings = z.infer<typeof agentSettingsSchema>;

/** presentRoutine()；lastRunAt 在轮询器跑过一次之后才非 null。 */
export const agentRoutineSchema = z.object({
  id: uuid,
  kind: agentRoutineKind,
  enabled: z.boolean(),
  scheduleHour: z.number().int(),
  scheduleMinute: z.number().int(),
  lastRunAt: nullableDateTime,
  nextRunAt: isoDateTime,
  version: z.number().int(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type AgentRoutine = z.infer<typeof agentRoutineSchema>;

export const agentNightlyDeliverySchema = z.object({
  enabled: z.boolean(),
  routine: agentRoutineSchema,
  settingsVersion: z.number().int(),
});
export type AgentNightlyDelivery = z.infer<typeof agentNightlyDeliverySchema>;

/** presentProfile() */
export const agentMemberProfileSchema = z.object({
  id: uuid,
  memberId: uuid,
  enabled: z.boolean(),
  assistantName: z.string(),
  responseStyle: agentResponseStyle,
  memoryEnabled: z.boolean(),
  memorySuggestionEnabled: z.boolean(),
  proactiveRoutinesEnabled: z.boolean(),
  version: z.number().int(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type AgentMemberProfile = z.infer<typeof agentMemberProfileSchema>;

// ---- 响应：记忆 --------------------------------------------------------------

/**
 * AgentMemoryService.present()：content 是**解密后的明文**，密文列不出现在响应里。
 * 非 candidate/active 状态时 content 恒为 null；解密失败直接 503，不会给出半条记录。
 * memoryKey 是 varchar 列，但每条写入路径都过 assertMemoryKey()，所以按枚举约束；
 * category 同为 varchar（写入时取 category ?? memoryKey），没有同等保证，保持 string。
 */
export const agentMemoryItemSchema = z.object({
  id: uuid,
  ownerMemberId: uuid,
  scope: agentMemoryScope,
  kind: agentMemoryKind,
  category: z.string(),
  memoryKey: agentMemoryKey,
  content: z.string().nullable(),
  status: agentMemoryStatus,
  confidenceSource: agentMemoryConfidenceSource,
  confirmedByMemberId: uuid.nullable(),
  validFrom: nullableDateTime,
  expiresAt: nullableDateTime,
  source: z.object({
    type: z.string(),
    id: z.string().nullable(),
    conversationId: uuid.nullable(),
    messageId: uuid.nullable(),
  }),
  visibility: agentMemoryScope,
  untrustedContent: z.literal(true),
  version: z.number().int(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type AgentMemoryItem = z.infer<typeof agentMemoryItemSchema>;

export const agentMemoryForgetResultSchema = z.object({
  id: uuid,
  forgotten: z.literal(true),
  status: z.enum(['forgotten', 'expired']),
});
export const agentMemoryClearResultSchema = z.object({
  forgottenCount: z.number().int(),
});
export type AgentMemoryForgetResult = z.infer<typeof agentMemoryForgetResultSchema>;
export type AgentMemoryClearResult = z.infer<typeof agentMemoryClearResultSchema>;
export type CreateAgentMemoryCandidateDto = z.infer<typeof createAgentMemoryCandidateBody>;

// ---- 响应：会话与运行 --------------------------------------------------------

/**
 * presentRun()。status 用完整 union、errorCode / errorMessage 不枚举——见文件头取舍 2。
 * retryable 依赖调用方：写端点一律传 false，只有 detail() 里的 runs[] 会算出 true。
 */
export const agentRunSchema = z.object({
  id: uuid,
  conversationId: uuid,
  retryOfRunId: uuid.nullable(),
  runtimeKind: agentRuntimeKind,
  status: agentRunStatus,
  startedAt: nullableDateTime,
  finishedAt: nullableDateTime,
  cancelRequestedAt: nullableDateTime,
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  retryable: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type AgentRun = z.infer<typeof agentRunSchema>;

/** conversationSummary()；新建会话时 latestRun 必为 null。 */
export const agentConversationSchema = z.object({
  id: uuid,
  title: z.string(),
  status: agentConversationStatus,
  expiresAt: isoDateTime,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  latestRun: agentRunSchema.nullable(),
});
export type AgentConversation = z.infer<typeof agentConversationSchema>;

/** content 是解密后的明文；解密失败的那条会被 flatMap 整条丢弃，数组因此可能变短甚至为空。 */
export const agentMessageSchema = z.object({
  id: uuid,
  runId: uuid.nullable(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  createdAt: isoDateTime,
});
export type AgentMessage = z.infer<typeof agentMessageSchema>;

/** resultPresentation() 产出的结构化卡片（解密后的明文 JSON）。footer 只有一个分支会带。 */
export const agentToolPresentationSchema = z.object({
  kind: z.enum([
    'tasks',
    'shopping',
    'meals',
    'schedule',
    'inventory',
    'recipes',
    'dish-plan',
    'weather',
    'member-profile',
    'asset-detail',
    'finance',
  ]),
  title: z.string(),
  emptyText: z.string(),
  targetPath: z.string(),
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      detail: z.string(),
      status: z.string(),
      targetPath: z.string(),
    }),
  ),
  footer: z.string().optional(),
});
export type AgentToolPresentation = z.infer<typeof agentToolPresentationSchema>;
export type AgentToolPresentationItem = AgentToolPresentation['items'][number];

/** 只有 status=completed 且工具命中卡片分支时 presentation 非 null；解密失败也是 null。 */
export const agentToolEventSchema = z.object({
  id: uuid,
  runId: uuid,
  toolName: z.string(),
  status: agentToolEventStatus,
  startedAt: isoDateTime,
  finishedAt: nullableDateTime,
  presentation: agentToolPresentationSchema.nullable(),
});
export type AgentToolEvent = z.infer<typeof agentToolEventSchema>;

/** buildPreview()：六个 actionType 都有 targetPath；只有 finance / shopping 带 warning。 */
export const agentProposalPreviewSchema = z.object({
  title: z.string(),
  summary: z.string(),
  changes: z.array(z.object({ label: z.string(), value: z.string() })),
  targetPath: z.string(),
  warning: z.string().optional(),
});

/** AgentProposalsService.present() */
export const agentActionProposalSchema = z.object({
  id: uuid,
  runId: uuid,
  actionType: agentActionType,
  actionLabel: z.string(),
  preview: agentProposalPreviewSchema,
  status: agentProposalStatus,
  expiresAt: isoDateTime,
  confirmedAt: nullableDateTime,
  executedAt: nullableDateTime,
  resultModule: z.string().nullable(),
  resultId: z.string().nullable(),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  version: z.number().int(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type AgentActionProposal = z.infer<typeof agentActionProposalSchema>;

/**
 * detail()。四个数组都不加 min()——见文件头取舍 2：
 * messages 会随 worker 从 1 条变 2 条、被保留策略清空；toolEvents / proposals 只有调过工具才有；
 * proposals 还过滤掉了属于多步骤组的提案（那些只出现在 /agent/proposal-groups）。
 */
export const agentConversationDetailSchema = agentConversationSchema.extend({
  messages: z.array(agentMessageSchema),
  runs: z.array(agentRunSchema),
  toolEvents: z.array(agentToolEventSchema),
  proposals: z.array(agentActionProposalSchema),
});
export type AgentConversationDetail = z.infer<typeof agentConversationDetailSchema>;

export const agentArchiveResultSchema = z.object({
  id: uuid,
  archived: z.literal(true),
});

// ---- 响应：多步骤提案组 ------------------------------------------------------

export const agentProposalGroupStepSchema = agentActionProposalSchema.extend({
  groupId: uuid,
  stepOrder: z.number().int(),
});
export type AgentProposalGroupStep = z.infer<typeof agentProposalGroupStepSchema>;

export const agentProposalGroupEventSchema = z.object({
  id: uuid,
  operation: agentProposalGroupEventOperation,
  actorMemberId: uuid,
  stepCount: z.number().int(),
  createdAt: isoDateTime,
});
export type AgentProposalGroupEvent = z.infer<typeof agentProposalGroupEventSchema>;

/** AgentProposalGroupsService.present()；conversationId 可为 null（工具直接发起时）。 */
export const agentProposalGroupSchema = z.object({
  id: uuid,
  conversationId: uuid.nullable(),
  runId: uuid,
  requestedByMemberId: uuid,
  title: z.string(),
  summary: z.string(),
  status: agentProposalGroupStatus,
  confirmedByMemberId: uuid.nullable(),
  confirmedAt: nullableDateTime,
  rejectedAt: nullableDateTime,
  expiresAt: isoDateTime,
  version: z.number().int(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  steps: z.array(agentProposalGroupStepSchema),
  events: z.array(agentProposalGroupEventSchema),
});
export type AgentProposalGroup = z.infer<typeof agentProposalGroupSchema>;

// ---- 响应：渠道与配对 --------------------------------------------------------

/** presentChannel()；canRevoke 依赖调用方是否带 user，内部配对端点没有 user 所以恒 false。 */
export const agentMemberChannelSchema = z.object({
  id: uuid,
  memberId: uuid,
  memberName: z.string().nullable(),
  platform: z.string(),
  externalAccountLabel: z.string().nullable(),
  externalAccountHint: z.string().nullable(),
  pairedAt: isoDateTime,
  lastUsedAt: nullableDateTime,
  revokedAt: nullableDateTime,
  version: z.number().int(),
  canRevoke: z.boolean(),
});
export type AgentMemberChannel = z.infer<typeof agentMemberChannelSchema>;

/** presentPairing()：注意没有 updatedAt，status 是派生值；明文配对码只在创建时给。 */
export const agentChannelPairingSchema = z.object({
  id: uuid,
  memberId: uuid,
  memberName: z.string().nullable(),
  platform: z.string(),
  expiresAt: isoDateTime,
  usedAt: nullableDateTime,
  revokedAt: nullableDateTime,
  channelId: uuid.nullable(),
  status: agentChannelPairingStatus,
  version: z.number().int(),
  createdAt: isoDateTime,
});
export type AgentChannelPairing = z.infer<typeof agentChannelPairingSchema>;

/** 创建配对：两个字段总是存在，重放时 pairingCode 为 null。 */
export const createdAgentChannelPairingSchema = agentChannelPairingSchema.extend({
  pairingCode: z.string().nullable(),
  replayed: z.boolean(),
});
export type CreatedAgentChannelPairing = z.infer<typeof createdAgentChannelPairingSchema>;

export const agentChannelPairResultSchema = z.object({
  channel: agentMemberChannelSchema,
  replayed: z.boolean(),
});

/** 内部渠道查询运行：content 是解密后的助手回复，worker 未跑完时为 null。 */
export const agentChannelRunSchema = agentRunSchema.extend({
  content: z.string().nullable(),
  readOnly: z.literal(true),
});

// ---- 请求 -------------------------------------------------------------------

export const agentPageContextInput = z.object({
  route: z.string().max(120),
  entityType: agentPageEntityType.optional(),
  entityId: uuid.optional(),
  selectedDate: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/).optional(),
});

export const updateAgentSettingsBody = z.object({
  enabled: z.boolean().optional(),
  runtimeKind: agentRuntimeKind.optional(),
  runtimeProfile: z.string().max(64).optional(),
  modelAlias: z.string().max(120).optional(),
  retentionDays: z.number().int().min(1).max(30).optional(),
  dailyRoutineNotificationLimit: z.number().int().min(0).max(50).optional(),
  routineNotificationsEnabled: z.boolean().optional(),
  readToolsEnabled: z.array(z.string()).max(AGENT_READ_TOOLS.length).optional(),
  proposalToolsEnabled: z.array(z.string()).max(AGENT_PROPOSAL_TOOLS.length).optional(),
  expectedVersion,
});

export const updateAgentRoutineBody = z.object({
  enabled: z.boolean().optional(),
  scheduleHour: z.number().int().min(0).max(23).optional(),
  scheduleMinute: z.number().int().min(0).max(59).optional(),
  nextRunAt: isoDateTime.optional(),
  expectedVersion,
});
export const configureNightlyDeliveryBody = z.object({
  enabled: z.boolean(),
  expectedSettingsVersion: expectedVersion,
  expectedRoutineVersion: expectedVersion,
});

export const updateAgentProfileBody = z.object({
  enabled: z.boolean().optional(),
  assistantName: z.string().min(1).max(32).optional(),
  responseStyle: agentResponseStyle.optional(),
  memoryEnabled: z.boolean().optional(),
  memorySuggestionEnabled: z.boolean().optional(),
  proactiveRoutinesEnabled: z.boolean().optional(),
  expectedVersion,
});

export const listAgentMemoriesQuery = z.object({
  status: agentMemoryStatus.optional(),
  scope: agentMemoryScope.optional(),
});
export const createAgentMemoryCandidateBody = z.object({
  content: z.string().min(1).max(2000),
  memoryKey: agentMemoryKey,
  category: agentMemoryKey.optional(),
  kind: agentMemoryKind.optional(),
});
export const agentMemoryVersionBody = z.object({ expectedVersion });
export const correctAgentMemoryBody = agentMemoryVersionBody.extend({
  content: z.string().min(1).max(2000),
  memoryKey: agentMemoryKey.optional(),
  category: agentMemoryKey.optional(),
  kind: agentMemoryKind.optional(),
});

export const createAgentConversationBody = z.object({
  title: z.string().max(120).optional(),
});
export const sendAgentMessageBody = z.object({
  message: z.string().min(1).max(2000),
  clientRequestId,
  pageContext: agentPageContextInput.optional(),
});
export const retryAgentRunBody = z.object({ clientRequestId });

export const confirmAgentProposalBody = z.object({ expectedVersion, clientRequestId });
export const rejectAgentProposalBody = z.object({ expectedVersion });
export const listAgentProposalGroupsQuery = z.object({
  status: agentProposalGroupStatus.optional(),
});
export const agentProposalGroupVersionBody = z.object({ expectedVersion });

export const createAgentChannelPairingBody = z.object({
  memberId: uuid,
  platform: z.string().min(2).max(32),
  expiresInMinutes: z.number().int().min(1).max(60).optional(),
  idempotencyKey: z.string().min(1).max(180),
});
export const revokeAgentChannelBody = z.object({ expectedVersion });

export const pairAgentChannelBody = z.object({
  pairingCode: z.string().min(8).max(64),
  externalAccountId: z.string().min(1).max(200),
  externalDisplayName: z.string().max(120).optional(),
  externalAccountHint: z.string().max(32).optional(),
});
export const agentChannelMessageBody = z.object({
  externalThreadRef: z.string().min(1).max(180),
  message: z.string().min(1).max(2000),
  clientRequestId,
});

export const agentRoutineParams = z.object({ kind: agentRoutineKind });
export const agentChannelParams = z.object({ channelId: uuid });
export const agentChannelRunParams = z.object({ channelId: uuid, runId: uuid });

/** 六个 @Res() 端点的响应契约，见文件头取舍 1。 */
const writesResponseDirectly = z.undefined();

// ---- 端点 -------------------------------------------------------------------

export const agent = {
  status: defineEndpoint({
    method: 'GET',
    path: '/agent/status',
    summary: '智能体开关与两个运行时的健康状态',
    response: agentStatusSchema,
  }),
  settings: defineEndpoint({
    method: 'GET',
    path: '/agent/settings',
    summary: '家庭级智能体设置',
    response: agentSettingsSchema,
  }),
  updateSettings: defineEndpoint({
    method: 'PUT',
    path: '/agent/settings',
    summary: '修改设置（乐观锁；管理员）',
    body: updateAgentSettingsBody,
    response: agentSettingsSchema,
  }),
  patchSettings: defineEndpoint({
    method: 'PATCH',
    path: '/agent/settings',
    summary: '同 PUT，走同一个处理函数',
    body: updateAgentSettingsBody,
    response: agentSettingsSchema,
  }),
  routines: defineEndpoint({
    method: 'GET',
    path: '/agent/routines',
    summary: '例行任务（恒 2 条：夜间摘要、周报；首次访问自动补建）',
    response: z.array(agentRoutineSchema),
  }),
  updateRoutine: defineEndpoint({
    method: 'PATCH',
    path: '/agent/routines/:kind',
    summary: '改例行任务的开关与执行时刻（乐观锁）',
    params: agentRoutineParams,
    body: updateAgentRoutineBody,
    response: agentRoutineSchema,
  }),
  configureNightlyDelivery: defineEndpoint({
    method: 'PUT',
    path: '/agent/routines/nightly_digest/delivery',
    summary: '开关夜间摘要推送（同时校验设置与例行任务两个版本号）',
    body: configureNightlyDeliveryBody,
    response: agentNightlyDeliverySchema,
  }),
  profile: defineEndpoint({
    method: 'GET',
    path: '/agent/profile',
    summary: '成员个人的智能体偏好',
    response: agentMemberProfileSchema,
  }),
  updateProfile: defineEndpoint({
    method: 'PATCH',
    path: '/agent/profile',
    summary: '改个人偏好（乐观锁）',
    body: updateAgentProfileBody,
    response: agentMemberProfileSchema,
  }),
  memories: defineEndpoint({
    method: 'GET',
    path: '/agent/memories',
    summary: '记忆列表（最多 50 条；content 已解密）',
    query: listAgentMemoriesQuery,
    response: z.array(agentMemoryItemSchema),
  }),
  createMemoryCandidate: defineEndpoint({
    method: 'POST',
    path: '/agent/memories/candidates',
    summary: '成员主动记一条（sourceType 固定 user_explicit）',
    body: createAgentMemoryCandidateBody,
    response: agentMemoryItemSchema,
  }),
  confirmMemory: defineEndpoint({
    method: 'POST',
    path: '/agent/memories/:id/confirm',
    summary: '把候选记忆确认为生效',
    params: idParams,
    body: agentMemoryVersionBody,
    response: agentMemoryItemSchema,
  }),
  shareMemory: defineEndpoint({
    method: 'POST',
    path: '/agent/memories/:id/share',
    summary: '把私人记忆共享到家庭范围',
    params: idParams,
    body: agentMemoryVersionBody,
    response: agentMemoryItemSchema,
  }),
  correctMemory: defineEndpoint({
    method: 'PATCH',
    path: '/agent/memories/:id',
    summary: '更正记忆内容（重新加密写入）',
    params: idParams,
    body: correctAgentMemoryBody,
    response: agentMemoryItemSchema,
  }),
  clearMemories: defineEndpoint({
    method: 'DELETE',
    path: '/agent/memories',
    summary: '清空本人记忆（抹掉密文，保留审计事件）',
    response: agentMemoryClearResultSchema,
  }),
  forgetMemory: defineEndpoint({
    method: 'DELETE',
    path: '/agent/memories/:id',
    summary: '遗忘一条记忆（幂等；已是终态直接回传）',
    params: idParams,
    response: agentMemoryForgetResultSchema,
  }),
  conversations: defineEndpoint({
    method: 'GET',
    path: '/agent/conversations',
    summary: '活跃会话（最多 30 条；过期的先批量标记）',
    response: z.array(agentConversationSchema),
  }),
  createConversation: defineEndpoint({
    method: 'POST',
    path: '/agent/conversations',
    summary: '新建会话（latestRun 必为 null）',
    body: createAgentConversationBody,
    response: agentConversationSchema,
  }),
  conversation: defineEndpoint({
    method: 'GET',
    path: '/agent/conversations/:id',
    summary: '会话详情：消息、运行、工具事件、待确认提案',
    params: idParams,
    response: agentConversationDetailSchema,
  }),
  archiveConversation: defineEndpoint({
    method: 'DELETE',
    path: '/agent/conversations/:id',
    summary: '归档会话（幂等）',
    params: idParams,
    response: agentArchiveResultSchema,
  }),
  sendMessage: defineEndpoint({
    method: 'POST',
    path: '/agent/conversations/:id/messages',
    summary: '发消息并排队一次运行（202；返回时 status 通常还是 queued）',
    params: idParams,
    body: sendAgentMessageBody,
    response: agentRunSchema,
  }),
  cancelRun: defineEndpoint({
    method: 'POST',
    path: '/agent/runs/:id/cancel',
    summary: '请求取消运行',
    params: idParams,
    response: agentRunSchema,
  }),
  retryRun: defineEndpoint({
    method: 'POST',
    path: '/agent/runs/:id/retry',
    summary: '用原输入重跑一次（202）',
    params: idParams,
    body: retryAgentRunBody,
    response: agentRunSchema,
  }),
  confirmProposal: defineEndpoint({
    method: 'POST',
    path: '/agent/proposals/:id/confirm',
    summary: '确认单条提案并落库到对应业务域（乐观锁 + 幂等）',
    params: idParams,
    body: confirmAgentProposalBody,
    response: agentActionProposalSchema,
  }),
  rejectProposal: defineEndpoint({
    method: 'POST',
    path: '/agent/proposals/:id/reject',
    summary: '拒绝单条提案',
    params: idParams,
    body: rejectAgentProposalBody,
    response: agentActionProposalSchema,
  }),
  proposalGroups: defineEndpoint({
    method: 'GET',
    path: '/agent/proposal-groups',
    summary: '多步骤提案组（最多 50 条；到期的先批量标记）',
    query: listAgentProposalGroupsQuery,
    response: z.array(agentProposalGroupSchema),
  }),
  proposalGroup: defineEndpoint({
    method: 'GET',
    path: '/agent/proposal-groups/:id',
    summary: '提案组详情（含步骤与审计事件）',
    params: idParams,
    response: agentProposalGroupSchema,
  }),
  confirmProposalGroup: defineEndpoint({
    method: 'POST',
    path: '/agent/proposal-groups/:id/confirm',
    summary: '整组确认（按 stepOrder 顺序执行）',
    params: idParams,
    body: agentProposalGroupVersionBody,
    response: agentProposalGroupSchema,
  }),
  rejectProposalGroup: defineEndpoint({
    method: 'POST',
    path: '/agent/proposal-groups/:id/reject',
    summary: '整组拒绝',
    params: idParams,
    body: agentProposalGroupVersionBody,
    response: agentProposalGroupSchema,
  }),
  channels: defineEndpoint({
    method: 'GET',
    path: '/agent/channels',
    summary: '已配对的外部渠道（最多 100 条）',
    response: z.array(agentMemberChannelSchema),
  }),
  revokeChannel: defineEndpoint({
    method: 'POST',
    path: '/agent/channels/:id/revoke',
    summary: '解绑渠道（本人或管理员）',
    params: idParams,
    body: revokeAgentChannelBody,
    response: agentMemberChannelSchema,
  }),
  pairings: defineEndpoint({
    method: 'GET',
    path: '/agent/channel-pairings',
    summary: '配对码列表（管理员；不含明文码）',
    response: z.array(agentChannelPairingSchema),
  }),
  createPairing: defineEndpoint({
    method: 'POST',
    path: '/agent/channel-pairings',
    summary: '签发配对码（幂等；明文码只此一次）',
    body: createAgentChannelPairingBody,
    response: createdAgentChannelPairingSchema,
  }),
  revokePairing: defineEndpoint({
    method: 'POST',
    path: '/agent/channel-pairings/:id/revoke',
    summary: '作废配对码',
    params: idParams,
    response: agentChannelPairingSchema,
  }),

  // ---- 内部端点：处理函数用 @Res() 自己写响应，见文件头取舍 1 ----------------

  internalPair: defineEndpoint({
    method: 'POST',
    path: '/internal/agent/channels/pair',
    summary: '外部渠道用配对码换绑定（内部凭据；@Res 手写 {data}，实际形状见 agentChannelPairResultSchema）',
    body: pairAgentChannelBody,
    response: writesResponseDirectly,
  }),
  internalChannelMessage: defineEndpoint({
    method: 'POST',
    path: '/internal/agent/channels/:channelId/messages',
    summary: '外部渠道发消息（内部凭据；202；@Res 手写 {data}，实际形状见 agentRunSchema）',
    params: agentChannelParams,
    body: agentChannelMessageBody,
    response: writesResponseDirectly,
  }),
  internalChannelRun: defineEndpoint({
    method: 'GET',
    path: '/internal/agent/channels/:channelId/runs/:runId',
    summary: '外部渠道查运行结果（内部凭据；@Res 手写 {data}，实际形状见 agentChannelRunSchema）',
    params: agentChannelRunParams,
    response: writesResponseDirectly,
  }),
  mcp: defineEndpoint({
    method: 'POST',
    path: '/internal/agent/mcp',
    summary: 'MCP 工具端点（内部凭据；JSON-RPC 或 SSE，由 SDK 生成，刻意不做响应校验）',
    response: writesResponseDirectly,
  }),
  mcpGet: defineEndpoint({
    method: 'GET',
    path: '/internal/agent/mcp',
    summary: 'MCP 端点不支持 GET，恒 405 JSON-RPC 错误',
    response: writesResponseDirectly,
  }),
  mcpDelete: defineEndpoint({
    method: 'DELETE',
    path: '/internal/agent/mcp',
    summary: 'MCP 端点不支持 DELETE，恒 405 JSON-RPC 错误',
    response: writesResponseDirectly,
  }),
};
