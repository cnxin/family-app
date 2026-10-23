import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Household, Member } from './household';

export type AgentRuntimeKind = 'fake' | 'hermes' | 'native';

export type AgentProviderKind = 'deepseek' | 'qwen' | 'zhipu' | 'kimi' | 'custom';

export type AgentTier2Scope = 'admins' | 'all';

export type AgentResponseStyle = 'concise' | 'balanced' | 'detailed';

export type AgentRoutineKind = 'nightly_digest' | 'weekly_report';

export type AgentRoutineItemStatus = 'pending' | 'digested' | 'expired';

@Entity('agent_settings')
@Unique('UQ_agent_settings_household', ['householdId'])
@Check('CHK_agent_settings_runtime_kind', `"runtimeKind" IN ('fake', 'hermes', 'native')`)
@Check('CHK_agent_settings_retention_days', `"retentionDays" BETWEEN 1 AND 30`)
@Check(
  'CHK_agent_settings_daily_routine_notification_limit',
  `"dailyRoutineNotificationLimit" BETWEEN 0 AND 50`,
)
@Check('CHK_agent_settings_tier2_daily_limit', `"tier2DailyLimit" BETWEEN 1 AND 1000`)
@Check(
  'CHK_agent_settings_provider_kind',
  `"providerKind" IS NULL OR "providerKind" IN ('deepseek', 'qwen', 'zhipu', 'kimi', 'custom')`,
)
@Check('CHK_agent_settings_tier2_scope', `"tier2Scope" IN ('admins', 'all')`)
export class AgentSetting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_settings_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ default: true })
  enabled: boolean;

  @Column({ type: 'varchar', length: 16, default: 'fake' })
  runtimeKind: AgentRuntimeKind;

  @Column({ type: 'varchar', length: 64, default: 'default' })
  runtimeProfile: string;

  @Column({ type: 'varchar', length: 120, default: 'hermes-agent' })
  modelAlias: string;

  @Column({ type: 'int', default: 7 })
  retentionDays: number;

  @Column({ type: 'int', default: 3 })
  dailyRoutineNotificationLimit: number;

  @Column({ default: false })
  routineNotificationsEnabled: boolean;

  /** J2 助理三档（architecture §2）：第 0 档规则引擎。J3 实现，这里只存。 */
  @Column({ type: 'boolean', default: true })
  tier0Enabled: boolean;

  /** 第 1 档本地模型（OpenAI 兼容，如家里的 Ollama）。J5 实现，这里只存、不连。 */
  @Column({ type: 'boolean', default: false })
  tier1Enabled: boolean;

  @Column({ type: 'varchar', length: 300, nullable: true })
  tier1BaseUrl: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  tier1Model: string | null;

  /** 第 2 档（云端）的开关就是上面的 enabled；每家每日调用上限与脱敏由 J4 执行。 */
  @Column({ type: 'int', default: 50 })
  tier2DailyLimit: number;

  @Column({ type: 'boolean', default: true })
  tier2Redact: boolean;

  /** 是否记录助理原话（assistant_utterances）；关掉后 ⌘K 不再落表。 */
  @Column({ type: 'boolean', default: true })
  captureUtterances: boolean;

  /** J4.3 云端档（第 2 档）的 OpenAI 兼容服务：服务商、地址、模型；key 用 AGENT_DATA_KEY 加密后存。 */
  @Column({ type: 'varchar', length: 16, nullable: true })
  providerKind: AgentProviderKind | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  providerBaseUrl: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  providerModel: string | null;

  @Column({ type: 'text', nullable: true })
  providerKeyEncrypted: string | null;

  /** 「测一下」的时间与结果；改了服务商、地址、模型或 key 都会清掉，切到 native 前必须是 true。 */
  @Column({ type: 'timestamptz', nullable: true })
  providerCheckedAt: Date | null;

  @Column({ type: 'boolean', default: false })
  providerCheckOk: boolean;

  /** 第 2 档对谁开放：admins 时普通成员看到的小管家是关着的（试用期默认）。 */
  @Column({ type: 'varchar', length: 8, default: 'admins' })
  tier2Scope: AgentTier2Scope;

  /** == contracts 的 AGENT_READ_TOOLS（含顺序），agent-tools.check.ts 断言两者一致；改了工具名单要配一份迁移。 */
  @Column({
    type: 'jsonb',
    default: [
      'get_today_summary',
      'get_family_schedule',
      'get_member_profile',
      'get_weather',
      'search_knowledge',
      'get_recent_memories',
      'get_travel_checklist',
      'get_polls',
      'search_recipes',
      'get_points_summary',
      'get_upcoming_visits',
      'get_finance_summary',
      'get_shopping_list',
      'get_tasks',
      'get_member_tasks',
      'get_calendar',
      'get_reminders',
      'get_meal_plan',
      'get_dish_plan',
      'find_item',
      'list_location_contents',
      'get_inventory_alerts',
      'get_inventory_summary',
      'get_asset_detail',
      'get_watch_candidates',
      'get_device_status',
    ],
  })
  readToolsEnabled: string[];

  @Column({
    type: 'jsonb',
    default: [
      'propose_task',
      'propose_reminder',
      'propose_poll',
      'propose_menu',
      'propose_shopping_items',
      'propose_plan',
      'propose_finance_transaction',
    ],
  })
  proposalToolsEnabled: string[];

  @Column({ type: 'int', default: 1 })
  version: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'updatedByMemberId',
    foreignKeyConstraintName: 'FK_agent_settings_updated_by',
  })
  updatedByMember: Member;

  @Column('uuid')
  updatedByMemberId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('agent_routines')
@Unique('UQ_agent_routines_household_kind', ['householdId', 'kind'])
@Check(
  'CHK_agent_routines_kind',
  `"kind" IN ('nightly_digest', 'weekly_report')`,
)
@Check('CHK_agent_routines_schedule_hour', `"scheduleHour" BETWEEN 0 AND 23`)
@Check(
  'CHK_agent_routines_schedule_minute',
  `"scheduleMinute" BETWEEN 0 AND 59`,
)
@Check('CHK_agent_routines_version', `"version" >= 1`)
@Index('IDX_agent_routines_next_run', ['nextRunAt'])
export class AgentRoutine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_routines_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 32 })
  kind: AgentRoutineKind;

  @Column({ default: false })
  enabled: boolean;

  @Column({ type: 'int', default: 21 })
  scheduleHour: number;

  @Column({ type: 'int', default: 0 })
  scheduleMinute: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastRunAt: Date | null;

  @Column({ type: 'timestamptz' })
  nextRunAt: Date;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('agent_routine_items')
@Check(
  'CHK_agent_routine_items_kind',
  `"routineKind" IN ('nightly_digest')`,
)
@Check(
  'CHK_agent_routine_items_status',
  `"status" IN ('pending', 'digested', 'expired')`,
)
@Index(
  'IDX_agent_routine_items_pending',
  ['householdId', 'routineKind'],
  { where: `"status" = 'pending'` },
)
export class AgentRoutineItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_routine_items_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 32 })
  routineKind: AgentRoutineKind;

  @Column({ type: 'varchar', length: 40 })
  sourceType: string;

  @Column({ type: 'varchar', length: 120 })
  sourceId: string;

  @Column({ type: 'varchar', length: 200 })
  summary: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: AgentRoutineItemStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  digestedAt: Date | null;
}

@Entity('agent_member_profiles')
@Unique('UQ_agent_member_profiles_household_member', [
  'householdId',
  'memberId',
])
@Check(
  'CHK_agent_member_profiles_response_style',
  `"responseStyle" IN ('concise', 'balanced', 'detailed')`,
)
@Check('CHK_agent_member_profiles_version', `"version" >= 1`)
export class AgentMemberProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_member_profiles_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Member, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_agent_member_profiles_member',
  })
  member: Member;

  @Column('uuid')
  memberId: string;

  @Column({ default: true })
  enabled: boolean;

  @Column({ type: 'varchar', length: 32, default: '小管家' })
  assistantName: string;

  @Column({ type: 'varchar', length: 16, default: 'balanced' })
  responseStyle: AgentResponseStyle;

  @Column({ default: true })
  memoryEnabled: boolean;

  @Column({ default: false })
  memorySuggestionEnabled: boolean;

  @Column({ default: false })
  proactiveRoutinesEnabled: boolean;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
