import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { MemberRole, Household, Member } from './household';

/**
 * H3 白名单。R1 起一行 = 一台设备（smart-home-redesign §4.1）：主实体决定卡片的状态句和主按钮，
 * 主面板项（至多 6 个）进详情主面板；haDeviceId 为 null 的是单实体设备（场景、脚本…）。
 * mergeState = 'legacy'：迁移前按实体登记的旧行，等连上 HA 后由 SmartHomeMergeService 按设备归并。
 */
@Entity('smart_home_devices')
@Unique('UQ_smart_home_devices_household_primary', ['householdId', 'primaryEntityId'])
@Index('UQ_smart_home_devices_household_ha_device', ['householdId', 'haDeviceId'], {
  unique: true,
  where: '"haDeviceId" IS NOT NULL',
})
@Check('CHK_smart_home_devices_domain', `"primaryDomain" NOT IN ('lock', 'alarm_control_panel') AND "primaryEntityId" LIKE "primaryDomain" || '.%'`)
@Check('CHK_smart_home_devices_min_role', `"minRole" IN ('owner', 'admin', 'member')`)
@Check(
  'CHK_smart_home_devices_icon',
  `"icon" IN ('vacuum', 'curtain', 'air_conditioner', 'washer', 'dryer', 'water_purifier', 'fridge', 'switch', 'light', 'fan', 'sensor', 'scene', 'other')`,
)
@Check('CHK_smart_home_devices_merge_state', `"mergeState" IN ('legacy', 'ok')`)
@Check(
  'CHK_smart_home_devices_entity_lists',
  `CASE WHEN jsonb_typeof("featuredEntityIds") = 'array'
                AND jsonb_typeof("hiddenEntityIds") = 'array'
                AND jsonb_typeof("knownEntityIds") = 'array'
            THEN jsonb_array_length("featuredEntityIds") <= 6
            ELSE false END`,
)
export class SmartHomeDevice {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_smart_home_devices' })
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'householdId', foreignKeyConstraintName: 'FK_smart_home_devices_household' })
  household: Household;

  @Column('uuid')
  householdId: string;

  /** HA 设备注册表的 id；null = 单实体设备 */
  @Column({ type: 'varchar', length: 64, nullable: true })
  haDeviceId: string | null;

  @Column({ type: 'varchar', length: 255 })
  primaryEntityId: string;

  @Column({ type: 'varchar', length: 32 })
  primaryDomain: string;

  @Column({ type: 'varchar', length: 40 })
  displayName: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  area: string | null;

  @Column({ type: 'varchar', length: 24, default: 'other' })
  icon: string;

  /** 主面板项，至多 6 个，顺序即显示顺序 */
  @Column({ type: 'jsonb', default: [] })
  featuredEntityIds: string[];

  /** 管理员藏掉的子实体：不显示、也不放行命令 */
  @Column({ type: 'jsonb', default: [] })
  hiddenEntityIds: string[];

  /** 管理员确认过的子实体（加进来 / 归并时的全部，之后点「放出来」的）；HA 新冒出来的不在里面，默认藏着 */
  @Column({ type: 'jsonb', default: [] })
  knownEntityIds: string[];

  @Column({ type: 'varchar', length: 16, default: 'ok' })
  mergeState: 'legacy' | 'ok';

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ default: false })
  controllable: boolean;

  @Column({ type: 'varchar', length: 16, default: 'admin' })
  minRole: MemberRole;

  @Column({ default: false })
  pinnedToToday: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/** 智能家居页重做：最近一次「按实体 → 按设备」归并的结果，每个家庭一行（redesign §5.3）。 */
@Entity('smart_home_merge_reports')
export class SmartHomeMergeReportRecord {
  @PrimaryColumn('uuid', { primaryKeyConstraintName: 'PK_smart_home_merge_reports' })
  householdId: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'householdId', foreignKeyConstraintName: 'FK_smart_home_merge_reports_household' })
  household: Household;

  @Column({ type: 'jsonb' })
  report: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

/** H3 E2：智能家居控制审计。(householdId, requestId) 唯一，即幂等键。 */
@Entity('smart_home_commands')
@Unique('UQ_smart_home_commands_household_request', ['householdId', 'requestId'])
@Index('IDX_smart_home_commands_household_created', ['householdId', 'createdAt'])
@Index('IDX_smart_home_commands_device_created', ['deviceId', 'createdAt'])
@Index('IDX_smart_home_commands_household_source_created', ['householdId', 'source', 'createdAt'])
@Check('CHK_smart_home_commands_status', `"status" IN ('pending', 'succeeded', 'failed')`)
@Check('CHK_smart_home_commands_source', `"source" IN ('manual', 'link')`)
export class SmartHomeCommandRecord {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_smart_home_commands' })
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'householdId', foreignKeyConstraintName: 'FK_smart_home_commands_household' })
  household: Household;

  @Column('uuid')
  householdId: string;

  // NO ACTION：整个家庭删除时成员和审计在同一条语句里级联删掉；单删成员（实际只停用不删）会被挡住
  @ManyToOne(() => Member, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'memberId', foreignKeyConstraintName: 'FK_smart_home_commands_member' })
  member: Member;

  @Column('uuid')
  memberId: string;

  @Column('uuid')
  requestId: string;

  /** 哪台白名单设备；设备移出后置空，审计本身留着 */
  @ManyToOne(() => SmartHomeDevice, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'deviceId', foreignKeyConstraintName: 'FK_smart_home_commands_device' })
  device: SmartHomeDevice | null;

  @Column('uuid', { nullable: true })
  deviceId: string | null;

  @Column({ type: 'varchar', length: 255 })
  entityId: string;

  @Column({ type: 'varchar', length: 32 })
  action: string;

  /** 发给 HA 的 service，比如 vacuum.start */
  @Column({ type: 'varchar', length: 80 })
  service: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: 'pending' | 'succeeded' | 'failed';

  /** HA 回了什么：成功时是变化的实体数，失败时是原因 */
  @Column({ type: 'varchar', length: 300, nullable: true })
  message: string | null;

  /** E5：家里人手按的（manual）还是 E4 联动按的（link） */
  @Column({ type: 'varchar', length: 16, default: 'manual' })
  source: 'manual' | 'link';

  /** source = link 时是哪条联动；联动删了置空 */
  @ManyToOne(() => SmartHomeLink, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'linkId', foreignKeyConstraintName: 'FK_smart_home_commands_link' })
  link: SmartHomeLink | null;

  @Column('uuid', { nullable: true })
  linkId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}

/** H3 E3：HA → 小管家 webhook 的密钥（加密存、只写不读）与三条联动的开关。每个家庭一行。 */
@Entity('smart_home_webhook_settings')
export class SmartHomeWebhookSettings {
  @PrimaryColumn('uuid', { primaryKeyConstraintName: 'PK_smart_home_webhook_settings' })
  householdId: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'householdId', foreignKeyConstraintName: 'FK_smart_home_webhook_settings_household' })
  household: Household;

  @Column({ type: 'text', nullable: true, select: false })
  secretEncrypted: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  secretHint: string | null;

  /** 轮换前的密钥，宽限期内仍然认 */
  @Column({ type: 'text', nullable: true, select: false })
  previousSecretEncrypted: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  previousValidUntil: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  rotatedAt: Date | null;

  @Column({ type: 'jsonb', default: {} })
  rules: Record<string, unknown>;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/** H3 E3：HA 打进来的事件流水。(householdId, eventId) 唯一用来去重；保留一天，排查用。 */
@Entity('smart_home_events')
@Unique('UQ_smart_home_events_household_event', ['householdId', 'eventId'])
@Index('IDX_smart_home_events_household_received', ['householdId', 'receivedAt'])
@Check('CHK_smart_home_events_status', `"status" IN ('processed', 'ignored', 'failed')`)
export class SmartHomeEventRecord {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_smart_home_events' })
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'householdId', foreignKeyConstraintName: 'FK_smart_home_events_household' })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 128 })
  eventId: string;

  @Column({ type: 'varchar', length: 32 })
  event: string;

  @Column({ type: 'varchar', length: 16, default: 'processed' })
  status: 'processed' | 'ignored' | 'failed';

  @Column({ type: 'varchar', length: 300, nullable: true })
  result: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  receivedAt: Date;
}

/** H3 E4：小管家 → HA 的联动规则（家务打勾 / 日程开始前 → 控制一台白名单设备）。 */
@Entity('smart_home_links')
@Index('IDX_smart_home_links_household', ['householdId'])
@Index('IDX_smart_home_links_target_device', ['targetDeviceId'])
@Check('CHK_smart_home_links_trigger', `"trigger" IN ('task_done', 'calendar_before')`)
@Check('CHK_smart_home_links_offset', `"offsetMinutes" >= 0 AND "offsetMinutes" <= 720`)
export class SmartHomeLink {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_smart_home_links' })
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'householdId', foreignKeyConstraintName: 'FK_smart_home_links_household' })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 40 })
  name: string;

  @Column({ type: 'varchar', length: 24 })
  trigger: 'task_done' | 'calendar_before';

  @Column({ type: 'varchar', length: 40 })
  keyword: string;

  @Column({ type: 'int', default: 0 })
  offsetMinutes: number;

  /** 目标设备（R1 起）；R1 之前建的、目标早已移出白名单的为 null，这种联动已停用 */
  @ManyToOne(() => SmartHomeDevice, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'targetDeviceId', foreignKeyConstraintName: 'FK_smart_home_links_target_device' })
  targetDevice: SmartHomeDevice | null;

  @Column('uuid', { nullable: true })
  targetDeviceId: string | null;

  /** 目标设备的主实体（建联动时的），只做显示和审计 */
  @Column({ type: 'varchar', length: 255 })
  targetEntityId: string;

  @Column({ type: 'varchar', length: 32 })
  action: string;

  @Column({ default: true })
  enabled: boolean;

  // NO ACTION：同 smart_home_commands，整个家庭删除时一起级联
  @ManyToOne(() => Member, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'createdById', foreignKeyConstraintName: 'FK_smart_home_links_created_by' })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/** H3 E4：联动的每一次运行。(linkId, occurrenceKey) 唯一：同一次发生只跑一次（幂等）。 */
@Entity('smart_home_link_runs')
@Unique('UQ_smart_home_link_runs_link_occurrence', ['linkId', 'occurrenceKey'])
@Index('IDX_smart_home_link_runs_household_created', ['householdId', 'createdAt'])
@Check('CHK_smart_home_link_runs_status', `"status" IN ('pending', 'succeeded', 'failed')`)
export class SmartHomeLinkRun {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_smart_home_link_runs' })
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'householdId', foreignKeyConstraintName: 'FK_smart_home_link_runs_household' })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => SmartHomeLink, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'linkId', foreignKeyConstraintName: 'FK_smart_home_link_runs_link' })
  link: SmartHomeLink;

  @Column('uuid')
  linkId: string;

  /** task:<taskId>:<日期> 或 calendar:<eventId>:<开始时间> */
  @Column({ type: 'varchar', length: 200 })
  occurrenceKey: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: 'pending' | 'succeeded' | 'failed';

  @Column({ type: 'varchar', length: 300, nullable: true })
  message: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
