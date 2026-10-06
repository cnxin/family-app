// 插件 manifest 的类型（docs/architecture.md §3.2、§8.4）。J1 起各处登记从 PLUGINS（index.ts）里的
// manifest 生成；还没迁的域仍手写，scripts/check-plugins.mjs 逐域断言两边一致。
//
// 按第三方可写的标准设计（§6 第 6 条）：
//   - manifest 只放可序列化的声明。需要代码的地方（hasData 特判、留意规则、查询执行）写 `server` id，
//     由插件自己目录里的服务端实现按 id 注册；contracts 里不出现 Nest / React / 执行逻辑。
//   - 依赖写在 `requires` 里，说清楚依赖谁、走什么通道（契约端点 / 进程内事件 / 内核扩展点）；
//     不允许 import 别的插件的 Service。
//   - 一个插件一个 key，事件域、模块开关、导航、⌘K 动作的 domain 都用它；历史上并存的其他 key
//     （动态流水 module、通知 module、导航分段 key、提案 actionType）是内核的迁移包袱，统一登记在
//     keys.ts 的别名表里，不进 manifest——第三方插件没有历史 key。

/** 角色。与 apps/api 的 MemberRole 一致。 */
export type PluginRole = 'owner' | 'admin' | 'member';

/** 默认所在层（家里页 / 侧栏 / 设置）。家庭可用模块开关覆盖 shelf 层的显隐。 */
export type PluginTier = 'core' | 'shelf' | 'settings';

// ---- 依赖 -------------------------------------------------------------------------------------

/**
 * 声明式依赖。`via` 决定允许的耦合方式：
 * - `contract`：调对方在 contracts 里登记的端点 / 服务端门面（J1 起由内核提供进程内调用，不经 HTTP）；
 * - `event`：订阅对方发出的进程内事件（如 `tasks.completed`），对方不知道谁在听；
 * - `kernel`：只用内核扩展点（留意注册表、事件通道、家庭日期），不依赖另一插件。
 * `optional`：对方被家庭关掉时本插件降级而不是报错。
 */
export interface PluginDependency {
  plugin: string;
  via: 'contract' | 'event' | 'kernel';
  /** 用到对方的哪些东西：端点 key（`POST /tasks`）、事件名或扩展点名。 */
  uses: readonly string[];
  optional?: boolean;
  reason: string;
}

// ---- 导航 -------------------------------------------------------------------------------------

export interface PluginNavSegment {
  /** 导航分段 key。与插件 key 不同时（如 menus 的 order / kitchen）必须在 keys.ts 的 PLUGIN_ALIASES.nav 里登记。 */
  key: string;
  label: string;
  glyph: string;
  /** 场景 key：today / eat / schedule / house / life / me */
  scene: string;
  path: string;
  tier?: PluginTier;
  managerOnly?: boolean;
  /** 手机底栏的哪个 tab 里展示（只对 core 有意义）。 */
  mobileTab?: string;
}

// ---- 模块开关与 hasData ------------------------------------------------------------------------

/**
 * hasData 的声明式判定。内核按 tables 生成
 * `SELECT 1 FROM <table> WHERE "householdId" = $1 [AND <where>]` 再 UNION ALL；
 * 依赖环境变量或跨表条件太复杂的，写 `server` 由插件服务端实现。
 */
export type PluginHasData =
  | { kind: 'always' }
  | { kind: 'tables'; tables: readonly { table: string; where?: string }[] }
  | { kind: 'server'; id: string };

export interface PluginModule {
  /** core 层插件没有开关（一直在）；shelf 层才进 GET /system/modules。 */
  overridable: boolean;
  hasData: PluginHasData;
}

// ---- 事件 -------------------------------------------------------------------------------------

/** 一条写端点前缀 → 受影响的域。domains 缺省为只影响本插件。 */
export interface PluginEventRoute {
  prefix: string;
  domains?: readonly string[];
  /** 没有登录用户的写入（webhook、访客公开页），由服务端显式发。 */
  emit?: 'explicit';
}

export interface PluginEvents {
  routes: readonly PluginEventRoute[];
  exempt?: readonly { prefix: string; reason: string }[];
  /** 客户端收到本域 changed 后要失效的 React Query key 前缀（现 apps/web/src/lib/events.ts）。 */
  queryKeys: readonly string[];
  /** 本插件发出的进程内事件，供别的插件以 `via: 'event'` 订阅。 */
  emits?: readonly string[];
}

// ---- 留意 -------------------------------------------------------------------------------------

export interface PluginAttentionKind {
  kind: string;
  /** 服务端规则 id，由插件服务端注册到内核的 AttentionRegistry。 */
  server: string;
  /** 单条卡片的按钮文案（现 attention-copy.ts kindActions）。 */
  actionLabel: string;
  /**
   * 单条卡片点进去的地址。`{id}` 换成实体 id，`{dueOn}` 换成日期；缺省用插件的 attention.path。
   * 可以指向别的插件的页面（如智能家居的「晾衣服」指向任务页）。
   */
  path?: string;
  /** 只有拥有这个能力的成员看得到。 */
  capability?: string;
  /**
   * 单条卡片的标题。`{name}` 是实体名（没有时用域名），`{soon}` 是「今天 / 3 天后」，没有截止日时为空。
   * 逾期的统一写成「{name}已逾期 N 天」，不走模板。
   */
  title: string;
  /** 没有截止日时的标题；缺省用 title。 */
  titleNoDue?: string;
  /** 同一种事合并成一张卡时的标题，`{n}` 是条数；缺省用 attention.mergedTitle。 */
  mergedTitle?: string;
}

export interface PluginAttention {
  /** 卡片上的域名（现 attention-copy.ts labels）。 */
  label: string;
  /** 一个域只出一张卡时的默认按钮文案与落点（现 actions / listActions / attentionRoutes）。 */
  actionLabel: string;
  listActionLabel: string;
  path: string;
  /** 今天页里的排序位次，越小越靠前（现 today-attention.service.ts DOMAIN_ORDER）。 */
  order: number;
  /** 合并卡的默认标题，`{n}` 是条数。 */
  mergedTitle: string;
  /** 合并卡里混着几种事时的标题；缺省用 mergedTitle。 */
  mixedTitle?: string;
  /** 合并卡里有逾期的时的标题；缺省按 kind 取。 */
  mergedOverdueTitle?: string;
  kinds: readonly PluginAttentionKind[];
}

// ---- 动作与查询（⌘K、第 0 档、agent 共用） --------------------------------------------------------

/** 第 0 档引擎认识的槽位类型。`?` 结尾表示可省。 */
export type PluginSlotType =
  | 'text' | 'money' | 'quantity' | 'unit' | 'date' | 'datetime' | 'month' | 'meal'
  | 'member' | 'location' | 'device' | 'item' | 'dish' | 'room';
export type PluginSlot = PluginSlotType | `${PluginSlotType}?`;

/** agent 写提案：现有工具名、agent_action_proposals.actionType 现值、提案卡上的类型名、能否放进 propose_plan。 */
export interface PluginProposal {
  legacyTool?: string;
  actionType: string;
  label: string;
  grouped?: boolean;
}

export interface PluginAction {
  /** `<plugin>.<verb>`，全局唯一。 */
  id: string;
  label: string;
  /** ⌘K 别名（现 actions.ts keywords）。 */
  keywords: readonly string[];
  /** 打开页面并带上预填参数；`{slot}` 换成槽位值。 */
  deepLink: string;
  slots?: Readonly<Record<string, PluginSlot>>;
  /** 第 0 档模板；J3 前允许为空。 */
  templates?: readonly string[];
  /**
   * 生成 agent 的写提案工具。`legacyTool` 是现有工具名（J4 保留为别名），
   * `actionType` 是 agent_action_proposals.actionType 的现值，`label` 是提案卡上的类型名；
   * `grouped: false` 表示不能放进 propose_plan 的一组里，必须单独确认（财务）。
   */
  propose?: PluginProposal;
  /** 执行或看到这个动作需要的能力；缺省为任何成员。 */
  capability?: string;
  managerOnly?: boolean;
}

export interface PluginQuery {
  id: string;
  label: string;
  templates?: readonly string[];
  slots?: Readonly<Record<string, PluginSlot>>;
  /** 服务端查询实现 id；第 0 档和 agent 读工具都调它。 */
  server: string;
  /** 第 0 档的答复模板，`{field}` 取查询结果字段。复杂答复写 `server` 由服务端拼。 */
  answer?: string | { server: string };
  /** 现有 agent 读工具名（J4 保留为别名）。 */
  legacyTool?: string;
  capability?: string;
}

// ---- 设置、用量、通知、权限 ------------------------------------------------------------------------

export interface PluginSettingsRow {
  title: string;
  hint: string;
  path: string;
  /** 状态文案由服务端或页面算，manifest 只给 id。 */
  status?: { server: string };
  managerOnly?: boolean;
}

/** usage-report 的「主表新增」一行。 */
export interface PluginUsageTable {
  label: string;
  table: string;
  memberColumn: string | null;
  createdColumn: string;
  /** createdColumn 是 timestamp（无时区）时为 false，按会话时区比较。 */
  createdTz?: boolean;
  where?: string;
  /** 计数来源一栏的补充说明，输出成「主表新增 <table>（<note>）」。 */
  note?: string;
  /** 这张表本身就是操作流水（每行一次操作，如 menu_events），来源写成「流水 <table>」而不是「主表新增」。 */
  log?: boolean;
}

export interface PluginUsage {
  /** 中文域名（usage-report 的输出列）。 */
  label: string;
  /** household_activity_logs.module 里属于本插件的值。 */
  activityModules?: readonly string[];
  tables?: readonly PluginUsageTable[];
  /** 统计不到的，写原因。 */
  uncounted?: readonly string[];
  /**
   * 现状快照（不是写操作次数）：改动没有操作人、按成员数不了的域（位置），每个家庭另起一段列现状。
   * 查询要专门写，manifest 只给 id，实现按 id 写在 apps/api/scripts/usage-report.mjs 的 SNAPSHOT_SOURCES。
   */
  snapshots?: readonly { server: string; label: string }[];
}

export interface PluginNotificationModule {
  /** notifications.module 的值。 */
  key: string;
  label: string;
  icon: string;
}

export interface PluginCapability {
  key: string;
  roles: readonly PluginRole[];
}

// ---- manifest ---------------------------------------------------------------------------------

export interface PluginManifest {
  /** 唯一 key，同时是事件域 key 与模块开关 key。 */
  key: string;
  name: string;
  glyph: string;
  /** manifest 契约版本；第三方插件按版本兼容。 */
  manifestVersion: 1;
  tier: PluginTier;
    requires?: readonly PluginDependency[];
  nav: readonly PluginNavSegment[];
  /** 旧路径 → 新路径（现 apps/web/src/lib/routes.ts MOVED）。 */
  legacyPaths?: readonly (readonly [string, string])[];
  module: PluginModule;
  events: PluginEvents;
  attention?: PluginAttention;
  actions?: readonly PluginAction[];
  /**
   * 还没有对应 ⌘K 动作的写提案（点菜：⌘K 是缺项，J3 补动作时挪进 actions[].propose）。
   * actions 里的每一条都会出现在 ⌘K，所以不能为了挂提案凭空加一条动作。
   */
  proposals?: readonly PluginProposal[];
  queries?: readonly PluginQuery[];
  settingsRows?: readonly PluginSettingsRow[];
  usage?: PluginUsage;
  notifications?: readonly PluginNotificationModule[];
  /** 本插件新增的能力；J1 起 ROLE_CAPABILITIES 由此汇总。 */
  capabilities?: readonly PluginCapability[];
}
