import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export type MemberRole = 'owner' | 'admin' | 'member';
export type DishCategory = '荤菜' | '素菜' | '汤' | '主食' | '甜品';
export type IngredientCategory = '蔬菜' | '肉类' | '海鲜' | '蛋奶' | '调料' | '主食' | '其他';
export type MealType = 'breakfast' | 'lunch' | 'dinner';
export type MenuItemStatus = 'pending' | 'accepted' | 'cooking' | 'done' | 'rejected';
export type MenuEventType =
  | 'item_ordered'
  | 'item_status_changed'
  | 'item_assigned'
  | 'item_note_changed'
  | 'meal_chef_assigned'
  | 'menu_completed';
export type InventoryCategory =
  | '调料'
  | '主食'
  | '饮料'
  | '零食'
  | '日用品'
  | '药品'
  | '其他';
export type InventoryTransactionType =
  | 'receipt'
  | 'consumption'
  | 'adjustment'
  | 'reversal';
export type InventoryTransactionSourceType =
  | 'shopping_item'
  | 'menu'
  | 'maintenance_record'
  | 'inventory_item'
  | 'manual_adjustment'
  | 'inventory_transaction';
export type InventoryBatchSourceType = 'manual' | 'shopping_item';
export type InventoryBatchMovementType =
  | 'allocation'
  | 'receipt'
  | 'consumption'
  | 'adjustment'
  | 'reversal';
export type InventoryBatchMovementSourceType =
  | 'batch_registration'
  | 'shopping_item'
  | 'menu'
  | 'maintenance_record'
  | 'manual_adjustment'
  | 'inventory_transaction';
export type SmartMenuPlanStatus = 'draft' | 'voting' | 'adopted';
export type PointsLedgerType =
  | 'award'
  | 'adjustment'
  | 'redemption'
  | 'reversal';
export type PointsLedgerSourceType =
  | 'manual'
  | 'task'
  | 'reward_redemption'
  | 'points_ledger';
export type FinanceAccountType =
  | 'cash'
  | 'bank'
  | 'alipay'
  | 'wechat'
  | 'other';
export type FinanceCategoryKind = 'expense' | 'income';
export type FinanceTransactionType =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'reversal';
export type FinanceTransactionSourceType =
  | 'manual'
  | 'agent'
  | 'shopping_item'
  | 'asset'
  | 'media_subscription'
  | 'finance_transaction';
export type RewardRedemptionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'reversed';
export type KnowledgeArticleCategory =
  | 'procedure'
  | 'appliance'
  | 'contact'
  | 'home'
  | 'other';
export type KnowledgeRevisionChangeType =
  | 'create'
  | 'update'
  | 'archive'
  | 'restore'
  | 'restore_revision';
export type FamilyMemoryCategory =
  | 'daily'
  | 'celebration'
  | 'travel'
  | 'meal'
  | 'visit'
  | 'milestone'
  | 'other';
export type FamilyMemorySourceModule =
  | 'calendar'
  | 'travel'
  | 'menu'
  | 'media'
  | 'visit';
export type FamilyMemoryOperationType =
  | 'create'
  | 'update'
  | 'archive'
  | 'restore';
export type TravelPlanStatus = 'planned' | 'completed' | 'cancelled';
export type TravelChecklistStatus = 'pending' | 'completed' | 'skipped';
export type TravelChecklistCategory =
  | 'documents'
  | 'clothing'
  | 'toiletries'
  | 'electronics'
  | 'supplies'
  | 'other';
export type DishSkillLevel = 'learning' | 'can_cook' | 'signature';
export type TaskRecurrence = 'once' | 'daily' | 'weekly' | 'monthly';
export type TaskInstanceStatus = 'pending' | 'done' | 'skipped';
export type PollCategory = 'general' | 'meal' | 'activity' | 'movie' | 'shopping';
export type PollVoteMode = 'single' | 'multiple';
export type PollStatus = 'open' | 'closed';
export type MediaType = 'movie' | 'series';
export type MediaMetadataSource = 'tmdb' | 'douban' | 'bangumi';
export type MediaCredentialKind = 'token' | 'api_key';
export type IntegrationKind = 'plex' | 'emby' | 'moviepilot';
export type IntegrationEventStatus = 'processed' | 'ignored' | 'failed';
export type ViewingSessionStatus =
  | 'active'
  | 'paused'
  | 'stopped'
  | 'completed';
export type MediaExternalProvider =
  | 'tmdb'
  | 'imdb'
  | 'douban'
  | 'bangumi'
  | 'plex'
  | 'emby'
  | 'moviepilot';
export type HouseholdMediaStatus =
  | 'watchlist'
  | 'voting'
  | 'scheduled'
  | 'watching'
  | 'completed'
  | 'dropped';
export type MediaRequestStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type MediaLibraryProviderKind = 'plex' | 'emby';
export type ReminderSourceModule =
  | 'menu'
  | 'task'
  | 'calendar'
  | 'poll'
  | 'maintenance'
  | 'travel';
export type ReminderStatus = 'scheduled' | 'sent' | 'cancelled';
export type AssetCategory =
  | 'appliance'
  | 'furniture'
  | 'electronics'
  | 'tool'
  | 'subscription'
  | 'other';
export type AssetStatus = 'active' | 'retired';
export type AssetDocumentType = 'receipt' | 'manual' | 'warranty' | 'other';
export type VisitStatus = 'scheduled' | 'cancelled' | 'completed';
export type GuestWifiSecurity = 'WPA' | 'nopass';
export type GuestMealRequestStatus = 'pending' | 'accepted' | 'rejected';
export type ActivityModule =
  | 'member'
  | 'invitation'
  | 'menu'
  | 'calendar'
  | 'task'
  | 'poll'
  | 'reminder'
  | 'shopping'
  | 'inventory'
  | 'recipe'
  | 'media'
  | 'guest'
  | 'asset'
  | 'points'
  | 'knowledge'
  | 'memory'
  | 'travel'
  | 'finance'
  | 'system';
export type NotificationModule =
  | 'menu'
  | 'task'
  | 'poll'
  | 'calendar'
  | 'reminder'
  | 'media'
  | 'guest'
  | 'points'
  | 'agent'
  | 'system';
export type NotificationChannelKind = 'webhook' | 'ntfy';
export type NotificationDeliveryStatus =
  | 'pending'
  | 'processing'
  | 'retry_scheduled'
  | 'sent'
  | 'failed';
export type NotificationDeliveryAttemptStatus = 'sent' | 'failed';
export type BackupScheduleFrequency = 'daily' | 'weekly';
export type BackupRunKind = 'backup' | 'restore_drill' | 'capacity_check';
export type BackupRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';
export type BackupRunTrigger = 'manual' | 'scheduled';
export type BackupCapacityStatus = 'unknown' | 'ok' | 'warning' | 'critical';
export type AgentRuntimeKind = 'fake' | 'hermes';
export type AgentResponseStyle = 'concise' | 'balanced' | 'detailed';
export type AgentRoutineKind = 'nightly_digest' | 'weekly_report';
export type AgentRoutineItemStatus = 'pending' | 'digested' | 'expired';
export type AgentMemoryScope = 'member_private' | 'household';
export type AgentMemoryKind =
  | 'preference'
  | 'fact'
  | 'episodic_summary'
  | 'routine_context';
export type AgentMemoryStatus =
  | 'candidate'
  | 'active'
  | 'revoked'
  | 'forgotten'
  | 'expired';
export type AgentMemoryConfidenceSource =
  | 'explicit'
  | 'business'
  | 'summary_candidate';
export type AgentMemoryEventOperation =
  | 'created'
  | 'confirmed'
  | 'corrected'
  | 'shared'
  | 'revoked'
  | 'forgotten'
  | 'expired';
export type AgentConversationStatus = 'active' | 'archived' | 'expired';
export type AgentConversationSource = 'app' | 'channel';
export type AgentChannelPlatform = string;
export type AgentMessageRole = 'user' | 'assistant';
export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type AgentToolEventStatus = 'running' | 'completed' | 'failed';
export type AgentActionType =
  | 'task'
  | 'reminder'
  | 'poll'
  | 'menu'
  | 'shopping'
  | 'finance';
export type AgentActionProposalStatus =
  | 'pending'
  | 'confirmed'
  | 'executed'
  | 'rejected'
  | 'expired'
  | 'failed';
export type AgentProposalGroupStatus =
  | 'pending'
  | 'confirmed'
  | 'rejected'
  | 'expired'
  | 'failed';
export type AgentProposalGroupEventOperation =
  | 'created'
  | 'confirmed'
  | 'rejected'
  | 'expired'
  | 'failed';

export interface DishRecipeStep {
  text: string;
  imageUrl?: string | null;
}

export interface DishReferenceLink {
  title?: string;
  url: string;
}

export interface MaintenanceConsumableSnapshot {
  consumableId: string;
  inventoryItemId: string;
  inventoryItemName: string;
  quantity: number;
  unit: string;
  consumed: boolean;
  quantityBefore: number | null;
  quantityAfter: number | null;
  transactionId: string | null;
}

export interface DishRecipeSnapshot {
  variantId: string;
  name: string;
  authorMemberId: string | null;
  authorName: string | null;
  note: string | null;
  estMinutes: number | null;
  ingredients: {
    ingredientId: string;
    name: string;
    category: IngredientCategory;
    isPantryStaple: boolean;
    quantity: number;
    unit: string;
  }[];
  steps: DishRecipeStep[];
  referenceLinks: DishReferenceLink[];
}

@Entity('accounts')
@Index('UQ_accounts_login_name_normalized', ['loginNameNormalized'], {
  unique: true,
})
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  loginName: string;

  @Column({ type: 'varchar', length: 64, select: false })
  loginNameNormalized: string;

  @Column({ type: 'varchar', nullable: true, select: false })
  passwordHash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  disabledAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('households')
export class Household {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  slug: string;

  @Column({ default: 'Asia/Shanghai' })
  timezone: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('members')
@Check('CHK_members_role', `"role" IN ('owner', 'admin', 'member')`)
@Index('IDX_members_household', ['householdId'])
@Index('IDX_members_account', ['accountId'])
@Index('IDX_members_household_status', ['householdId', 'disabledAt'])
@Unique('UQ_members_household_account', ['householdId', 'accountId'])
export class Member {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_members_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Account, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'accountId',
    foreignKeyConstraintName: 'FK_members_account',
  })
  account: Account | null;

  @Column({ type: 'uuid', nullable: true, select: false })
  accountId: string | null;

  @Column()
  name: string;

  @Column({ default: '🙂' })
  avatarEmoji: string;

  @Column({ type: 'varchar', default: 'member' })
  role: MemberRole;

  @Column({ default: false })
  prefersCooking: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  disabledAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}

@Entity('household_activity_logs')
@Check(
  'CHK_household_activity_logs_module',
  `"module" IN ('member', 'invitation', 'menu', 'calendar', 'task', 'poll', 'reminder', 'shopping', 'inventory', 'recipe', 'media', 'guest', 'asset', 'points', 'knowledge', 'travel', 'system')`,
)
@Index('IDX_household_activity_logs_household_created', [
  'householdId',
  'createdAt',
])
@Index('IDX_household_activity_logs_subject', ['subjectMemberId', 'createdAt'])
export class HouseholdActivityLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_household_activity_logs_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'actorId',
    foreignKeyConstraintName: 'FK_household_activity_logs_actor',
  })
  actor: Member | null;

  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', length: 64 })
  actorName: string;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'subjectMemberId',
    foreignKeyConstraintName: 'FK_household_activity_logs_subject',
  })
  subjectMember: Member | null;

  @Column({ type: 'uuid', nullable: true })
  subjectMemberId: string | null;

  @Column({ type: 'varchar', length: 32 })
  module: ActivityModule;

  @Column({ type: 'varchar', length: 64 })
  action: string;

  @Column({ type: 'varchar', length: 180 })
  summary: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  detail: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  targetPath: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('auth_sessions')
@Check(
  'CHK_auth_sessions_role_snapshot',
  `"roleSnapshot" IN ('owner', 'admin', 'member')`,
)
@Index('UQ_auth_sessions_refresh_token_hash', ['refreshTokenHash'], {
  unique: true,
})
@Index('IDX_auth_sessions_member_status', ['memberId', 'revokedAt'])
@Index('IDX_auth_sessions_account_status', ['accountId', 'revokedAt'])
export class AuthSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_auth_sessions_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'accountId',
    foreignKeyConstraintName: 'FK_auth_sessions_account',
  })
  account: Account;

  @Column('uuid')
  accountId: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_auth_sessions_member',
  })
  member: Member;

  @Column('uuid')
  memberId: string;

  @Column({ type: 'varchar', length: 64 })
  refreshTokenHash: string;

  @Column({ type: 'varchar' })
  roleSnapshot: MemberRole;

  @Column({ type: 'varchar', length: 64 })
  credentialSnapshot: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('household_invitations')
@Check(
  'CHK_household_invitations_role',
  `"role" IN ('admin', 'member')`,
)
@Index('UQ_household_invitations_token_hash', ['tokenHash'], {
  unique: true,
})
@Index('IDX_household_invitations_household_status', [
  'householdId',
  'acceptedAt',
  'revokedAt',
])
export class HouseholdInvitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_household_invitations_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 64, select: false })
  tokenHash: string;

  @Column({ type: 'varchar', length: 64 })
  memberName: string;

  @Column({ type: 'varchar', length: 16, default: '🙂' })
  avatarEmoji: string;

  @Column({ type: 'varchar', default: 'member' })
  role: Exclude<MemberRole, 'owner'>;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'invitedById',
    foreignKeyConstraintName: 'FK_household_invitations_invited_by',
  })
  invitedBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  invitedById: string | null;

  @ManyToOne(() => Account, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'acceptedByAccountId',
    foreignKeyConstraintName: 'FK_household_invitations_accepted_by_account',
  })
  acceptedByAccount: Account | null;

  @Column({ type: 'uuid', nullable: true })
  acceptedByAccountId: string | null;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('ingredients')
@Unique('UQ_ingredients_household_name', ['householdId', 'name'])
@Index('IDX_ingredients_household', ['householdId'])
export class Ingredient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_ingredients_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', default: '其他' })
  category: IngredientCategory;

  @Column({ default: '份' })
  defaultUnit: string;

  @Column({ default: false })
  isPantryStaple: boolean;
}

@Entity('dishes')
@Index('IDX_dishes_household_active', ['householdId', 'isActive'])
export class Dish {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_dishes_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', nullable: true })
  photoUrl: string | null;

  @Column({ type: 'varchar', default: '荤菜' })
  category: DishCategory;

  @Column({ type: 'int', default: 1 })
  difficulty: number;

  @Column({ type: 'int', nullable: true })
  estMinutes: number | null;

  @Column({ type: 'varchar', nullable: true })
  note: string | null;

  @Column({ type: 'jsonb', default: [] })
  recipeSteps: DishRecipeStep[];

  @Column({ type: 'jsonb', default: [] })
  referenceLinks: DishReferenceLink[];

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'uuid', nullable: true })
  createdBy: string | null;

  @OneToMany(() => DishIngredient, (di) => di.dish, { cascade: true, eager: true })
  ingredients: DishIngredient[];

  @OneToMany(() => DishRecipeVariant, (variant) => variant.dish)
  recipeVariants: DishRecipeVariant[];

  @CreateDateColumn()
  createdAt: Date;
}

@Entity('dish_ingredients')
export class DishIngredient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Dish, (d) => d.ingredients, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'dishId',
    foreignKeyConstraintName: 'FK_2421c4c7496b67cf6211c6b7c4b',
  })
  dish: Dish;

  @Column('uuid')
  dishId: string;

  @ManyToOne(() => Ingredient, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'ingredientId',
    foreignKeyConstraintName: 'FK_36a5d4baef5ddf0e9f7a9b9b038',
  })
  ingredient: Ingredient;

  @Column('uuid')
  ingredientId: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 1 })
  quantity: string;

  @Column({ default: '份' })
  unit: string;
}

@Entity('dish_recipe_variants')
@Index('IDX_dish_recipe_variants_household_dish', [
  'householdId',
  'dishId',
  'isArchived',
])
@Index('UQ_dish_recipe_variants_default', ['dishId'], {
  unique: true,
  where: '"isDefault" = true AND "isArchived" = false',
})
export class DishRecipeVariant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_dish_recipe_variants_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Dish, (dish) => dish.recipeVariants, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'dishId',
    foreignKeyConstraintName: 'FK_dish_recipe_variants_dish',
  })
  dish: Dish;

  @Column('uuid')
  dishId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'authorMemberId',
    foreignKeyConstraintName: 'FK_dish_recipe_variants_author',
  })
  author: Member | null;

  @Column({ type: 'uuid', nullable: true })
  authorMemberId: string | null;

  @Column({ default: false })
  isDefault: boolean;

  @Column({ default: false })
  isArchived: boolean;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  @Column({ type: 'int', nullable: true })
  estMinutes: number | null;

  @OneToMany(() => DishRecipeVariantStep, (step) => step.variant, {
    eager: true,
  })
  steps: DishRecipeVariantStep[];

  @OneToMany(() => DishRecipeVariantLink, (link) => link.variant, {
    eager: true,
  })
  referenceLinks: DishRecipeVariantLink[];

  @OneToMany(
    () => DishRecipeVariantIngredient,
    (ingredient) => ingredient.variant,
    { eager: true },
  )
  ingredients: DishRecipeVariantIngredient[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('dish_recipe_variant_steps')
@Unique('UQ_dish_recipe_variant_steps_position', ['variantId', 'position'])
export class DishRecipeVariantStep {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => DishRecipeVariant, (variant) => variant.steps, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'variantId',
    foreignKeyConstraintName: 'FK_dish_recipe_variant_steps_variant',
  })
  variant: DishRecipeVariant;

  @Column('uuid')
  variantId: string;

  @Column({ type: 'int' })
  position: number;

  @Column({ type: 'varchar', length: 2000 })
  text: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  imageUrl: string | null;
}

@Entity('dish_recipe_variant_links')
@Unique('UQ_dish_recipe_variant_links_position', ['variantId', 'position'])
export class DishRecipeVariantLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => DishRecipeVariant, (variant) => variant.referenceLinks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'variantId',
    foreignKeyConstraintName: 'FK_dish_recipe_variant_links_variant',
  })
  variant: DishRecipeVariant;

  @Column('uuid')
  variantId: string;

  @Column({ type: 'int' })
  position: number;

  @Column({ type: 'varchar', length: 120, nullable: true })
  title: string | null;

  @Column({ type: 'varchar', length: 1000 })
  url: string;
}

@Entity('dish_recipe_variant_ingredients')
@Unique('UQ_dish_recipe_variant_ingredients_item', [
  'variantId',
  'ingredientId',
  'unit',
])
export class DishRecipeVariantIngredient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => DishRecipeVariant, (variant) => variant.ingredients, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'variantId',
    foreignKeyConstraintName: 'FK_dish_recipe_variant_ingredients_variant',
  })
  variant: DishRecipeVariant;

  @Column('uuid')
  variantId: string;

  @ManyToOne(() => Ingredient, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'ingredientId',
    foreignKeyConstraintName: 'FK_dish_recipe_variant_ingredients_ingredient',
  })
  ingredient: Ingredient;

  @Column('uuid')
  ingredientId: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  quantity: string;

  @Column({ type: 'varchar', length: 32 })
  unit: string;
}

@Entity('member_dish_skills')
@Check(
  'CHK_member_dish_skills_level',
  `"level" IN ('learning', 'can_cook', 'signature')`,
)
@Unique('UQ_member_dish_skills_member_dish', [
  'householdId',
  'memberId',
  'dishId',
])
@Index('IDX_member_dish_skills_household_member', ['householdId', 'memberId'])
export class MemberDishSkill {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_member_dish_skills_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_member_dish_skills_member',
  })
  member: Member;

  @Column('uuid')
  memberId: string;

  @ManyToOne(() => Dish, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'dishId',
    foreignKeyConstraintName: 'FK_member_dish_skills_dish',
  })
  dish: Dish;

  @Column('uuid')
  dishId: string;

  @ManyToOne(() => DishRecipeVariant, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'preferredRecipeId',
    foreignKeyConstraintName: 'FK_member_dish_skills_preferred_recipe',
  })
  preferredRecipe: DishRecipeVariant | null;

  @Column({ type: 'uuid', nullable: true })
  preferredRecipeId: string | null;

  @Column({ type: 'varchar', default: 'can_cook' })
  level: DishSkillLevel;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('menus')
@Check('CHK_menus_status', `"status" IN ('open', 'done')`)
@Unique('UQ_menus_household_date_meal', ['householdId', 'date', 'mealType'])
@Index('IDX_menus_household_date', ['householdId', 'date'])
export class Menu {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_menus_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar' })
  mealType: MealType;

  @Column({ type: 'varchar', default: 'open' })
  status: 'open' | 'done';

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'chefId',
    foreignKeyConstraintName: 'FK_menus_chef',
  })
  chef: Member | null;

  @Column({ type: 'uuid', nullable: true })
  chefId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'completedById',
    foreignKeyConstraintName: 'FK_menus_completed_by',
  })
  completedBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  completedById: string | null;

  @OneToMany(() => MenuItem, (mi) => mi.menu)
  items: MenuItem[];

  @OneToMany(() => MenuEvent, (event) => event.menu)
  events: MenuEvent[];
}

@Entity('menu_items')
@Check(
  'CHK_menu_items_status',
  `"status" IN ('pending', 'accepted', 'cooking', 'done', 'rejected')`,
)
@Index(
  'UQ_menu_items_active_order',
  ['menuId', 'dishId', 'requestedById'],
  { unique: true, where: `"status" <> 'rejected'` },
)
export class MenuItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Menu, (m) => m.items, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'menuId',
    foreignKeyConstraintName: 'FK_a6b42bf45dbdef19cbf05a4cacf',
  })
  menu: Menu;

  @Column('uuid')
  menuId: string;

  @ManyToOne(() => Dish, { eager: true })
  @JoinColumn({
    name: 'dishId',
    foreignKeyConstraintName: 'FK_037d26d0e12b19e0b9e6d0bd6fd',
  })
  dish: Dish;

  @Column('uuid')
  dishId: string;

  @ManyToOne(() => Member, { eager: true })
  @JoinColumn({
    name: 'requestedById',
    foreignKeyConstraintName: 'FK_d1a44683ed9d4672028be559472',
  })
  requestedBy: Member;

  @Column('uuid')
  requestedById: string;

  @Column({ type: 'varchar', nullable: true })
  note: string | null;

  @Column({ type: 'varchar', default: 'pending' })
  status: MenuItemStatus;

  @Column({ type: 'varchar', nullable: true })
  statusReason: string | null;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'assignedToId',
    foreignKeyConstraintName: 'FK_menu_items_assigned_to',
  })
  assignedTo: Member | null;

  @Column({ type: 'uuid', nullable: true })
  assignedToId: string | null;

  @ManyToOne(() => DishRecipeVariant, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'recipeVariantId',
    foreignKeyConstraintName: 'FK_menu_items_recipe_variant',
  })
  recipeVariant: DishRecipeVariant | null;

  @Column({ type: 'uuid', nullable: true })
  recipeVariantId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  recipeSnapshot: DishRecipeSnapshot | null;

  @CreateDateColumn()
  createdAt: Date;
}

@Entity('menu_events')
@Check(
  'CHK_menu_events_type',
  `"type" IN ('item_ordered', 'item_status_changed', 'item_assigned', 'item_note_changed', 'meal_chef_assigned', 'menu_completed')`,
)
@Index('IDX_menu_events_household_menu', ['householdId', 'menuId'])
@Index('IDX_menu_events_recipient_read', ['recipientId', 'readAt'])
export class MenuEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_menu_events_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Menu, (menu) => menu.events, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'menuId',
    foreignKeyConstraintName: 'FK_menu_events_menu',
  })
  menu: Menu;

  @Column('uuid')
  menuId: string;

  @ManyToOne(() => MenuItem, { eager: true, nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'menuItemId',
    foreignKeyConstraintName: 'FK_menu_events_item',
  })
  menuItem: MenuItem | null;

  @Column({ type: 'uuid', nullable: true })
  menuItemId: string | null;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'actorId',
    foreignKeyConstraintName: 'FK_menu_events_actor',
  })
  actor: Member;

  @Column('uuid')
  actorId: string;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'recipientId',
    foreignKeyConstraintName: 'FK_menu_events_recipient',
  })
  recipient: Member | null;

  @Column({ type: 'uuid', nullable: true })
  recipientId: string | null;

  @Column({ type: 'varchar' })
  type: MenuEventType;

  @Column({ type: 'varchar', nullable: true })
  fromValue: string | null;

  @Column({ type: 'varchar', nullable: true })
  toValue: string | null;

  @Column({ type: 'varchar', nullable: true })
  reason: string | null;

  @Column({ type: 'timestamp', nullable: true })
  readAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}

@Entity('calendar_events')
@Index('IDX_calendar_events_household_date', ['householdId', 'date'])
export class CalendarEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_calendar_events_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'timestamptz', nullable: true })
  startsAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endsAt: Date | null;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_calendar_events_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('guests')
@Index('IDX_guests_household_name', ['householdId', 'name'])
export class Guest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_guests_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ type: 'varchar', length: 16, default: '👋' })
  avatarEmoji: string;

  @Column({ type: 'varchar', length: 240, nullable: true })
  note: string | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  anonymizedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('visits')
@Check('CHK_visits_status', `"status" IN ('scheduled', 'cancelled', 'completed')`)
@Index('IDX_visits_household_start', ['householdId', 'startsAt'])
export class Visit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_visits_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'timestamptz' })
  startsAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  endsAt: Date | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  @Column({ type: 'varchar', default: 'scheduled' })
  status: VisitStatus;

  @ManyToOne(() => GuestWifiProfile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'guestWifiProfileId',
    foreignKeyConstraintName: 'FK_visits_guest_wifi_profile',
  })
  guestWifiProfile: GuestWifiProfile | null;

  @Column({ type: 'uuid', nullable: true })
  guestWifiProfileId: string | null;

  @ManyToOne(() => Member, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'hostMemberId',
    foreignKeyConstraintName: 'FK_visits_host_member',
  })
  hostMember: Member;

  @Column('uuid')
  hostMemberId: string;

  @ManyToOne(() => Member, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_visits_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @OneToMany(() => VisitGuest, (visitGuest) => visitGuest.visit)
  guests: VisitGuest[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('visit_guests')
@Unique('UQ_visit_guests_visit_guest', ['visitId', 'guestId'])
@Index('IDX_visit_guests_guest', ['guestId'])
export class VisitGuest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Visit, (visit) => visit.guests, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'visitId',
    foreignKeyConstraintName: 'FK_visit_guests_visit',
  })
  visit: Visit;

  @Column('uuid')
  visitId: string;

  @ManyToOne(() => Guest, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'guestId',
    foreignKeyConstraintName: 'FK_visit_guests_guest',
  })
  guest: Guest;

  @Column('uuid')
  guestId: string;

  @Column({ type: 'boolean', nullable: true })
  isAttending: boolean | null;

  @Column({ type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('guest_invitations')
@Index('UQ_guest_invitations_token_hash', ['tokenHash'], { unique: true })
@Index('IDX_guest_invitations_visit_guest', ['visitId', 'guestId'])
export class GuestInvitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Visit, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'visitId',
    foreignKeyConstraintName: 'FK_guest_invitations_visit',
  })
  visit: Visit;

  @Column('uuid')
  visitId: string;

  @ManyToOne(() => Guest, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'guestId',
    foreignKeyConstraintName: 'FK_guest_invitations_guest',
  })
  guest: Guest;

  @Column('uuid')
  guestId: string;

  @Column({ type: 'varchar', length: 64, select: false })
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ default: false })
  allowsMovieVoting: boolean;

  @Column({ default: false })
  allowsMealRequests: boolean;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_guest_invitations_created_by',
  })
  createdBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @OneToMany(() => GuestPollVote, (vote) => vote.invitation)
  pollVotes: GuestPollVote[];

  @OneToMany(() => GuestMealRequest, (request) => request.invitation)
  mealRequests: GuestMealRequest[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('guest_wifi_profiles')
@Check('CHK_guest_wifi_profiles_security', `"security" IN ('WPA', 'nopass')`)
@Index('IDX_guest_wifi_profiles_household_active', ['householdId', 'isActive'])
export class GuestWifiProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_guest_wifi_profiles_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  ssid: string;

  @Column({ type: 'varchar', length: 8 })
  security: GuestWifiSecurity;

  @Column({ type: 'text', nullable: true, select: false })
  passwordEncrypted: string | null;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('household_tasks')
@Check(
  'CHK_household_tasks_recurrence',
  `"recurrence" IN ('once', 'daily', 'weekly', 'monthly')`,
)
@Check(
  'CHK_household_tasks_interval',
  `"repeatInterval" >= 1 AND "repeatInterval" <= 365`,
)
@Check(
  'CHK_household_tasks_date_range',
  `"endsOn" IS NULL OR "endsOn" >= "startsOn"`,
)
@Check(
  'CHK_household_tasks_reward_points',
  `"rewardPoints" >= 0 AND "rewardPoints" <= 10000`,
)
@Index('IDX_household_tasks_household_active', [
  'householdId',
  'isArchived',
  'startsOn',
])
export class HouseholdTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_household_tasks_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  @Column({ type: 'date' })
  startsOn: string;

  @Column({ type: 'varchar', default: 'once' })
  recurrence: TaskRecurrence;

  @Column({ type: 'int', default: 1 })
  repeatInterval: number;

  @Column({ type: 'date', nullable: true })
  endsOn: string | null;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_household_tasks_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'defaultAssigneeId',
    foreignKeyConstraintName: 'FK_household_tasks_default_assignee',
  })
  defaultAssignee: Member | null;

  @Column({ type: 'uuid', nullable: true })
  defaultAssigneeId: string | null;

  @Column({ type: 'int', default: 0 })
  rewardPoints: number;

  @Column({ default: false })
  isArchived: boolean;

  @OneToMany(() => HouseholdTaskInstance, (instance) => instance.task)
  instances: HouseholdTaskInstance[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('household_task_instances')
@Check(
  'CHK_household_task_instances_status',
  `"status" IN ('pending', 'done', 'skipped')`,
)
@Check(
  'CHK_household_task_instances_points_version',
  `"pointsAwardVersion" >= 0`,
)
@Unique('UQ_household_task_instances_task_date', ['taskId', 'dueDate'])
@Index('IDX_household_task_instances_household_date', [
  'householdId',
  'dueDate',
  'status',
])
export class HouseholdTaskInstance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_household_task_instances_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => HouseholdTask, (task) => task.instances, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'taskId',
    foreignKeyConstraintName: 'FK_household_task_instances_task',
  })
  task: HouseholdTask;

  @Column('uuid')
  taskId: string;

  @Column({ type: 'date' })
  dueDate: string;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'assigneeId',
    foreignKeyConstraintName: 'FK_household_task_instances_assignee',
  })
  assignee: Member | null;

  @Column({ type: 'uuid', nullable: true })
  assigneeId: string | null;

  @Column({ type: 'varchar', default: 'pending' })
  status: TaskInstanceStatus;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'resolvedById',
    foreignKeyConstraintName: 'FK_household_task_instances_resolved_by',
  })
  resolvedBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  resolvedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @ManyToOne(() => PointsLedger, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'pointsLedgerId',
    foreignKeyConstraintName: 'FK_household_task_instances_points_ledger',
  })
  pointsLedger: object | null;

  @Column({ type: 'uuid', nullable: true })
  pointsLedgerId: string | null;

  @Column({ type: 'int', default: 0 })
  pointsAwardVersion: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('notifications')
@Check(
  'CHK_notifications_module',
  `"module" IN ('menu', 'task', 'poll', 'calendar', 'reminder', 'media', 'guest', 'points', 'agent', 'system')`,
)
@Index('IDX_notifications_recipient_read', ['recipientId', 'readAt', 'createdAt'])
@Index('IDX_notifications_household_source', ['householdId', 'module', 'sourceId'])
@Index('IDX_notifications_external_route', ['createdAt'], {
  where: '"externalRoutedAt" IS NULL',
})
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_notifications_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'recipientId',
    foreignKeyConstraintName: 'FK_notifications_recipient',
  })
  recipient: Member;

  @Column('uuid')
  recipientId: string;

  @Column({ type: 'varchar' })
  module: NotificationModule;

  @Column({ type: 'varchar', length: 64 })
  type: string;

  @Column({ type: 'uuid', nullable: true })
  sourceId: string | null;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  body: string | null;

  @Column({ type: 'varchar', length: 500 })
  targetPath: string;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  externalRoutedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('notification_channels')
@Check('CHK_notification_channels_kind', `"kind" IN ('webhook', 'ntfy')`)
@Check(
  'CHK_notification_channels_test_status',
  `"lastTestStatus" IS NULL OR "lastTestStatus" IN ('success', 'failed')`,
)
@Unique('UQ_notification_channels_household_name', ['householdId', 'name'])
@Index('IDX_notification_channels_household_enabled', [
  'householdId',
  'isEnabled',
  'createdAt',
])
export class NotificationChannel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_notification_channels_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 24 })
  kind: NotificationChannelKind;

  @Column({ type: 'text', select: false })
  endpointEncrypted: string;

  @Column({ type: 'varchar', length: 255 })
  endpointHint: string;

  @Column({ type: 'text', nullable: true, select: false })
  credentialEncrypted: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  credentialHint: string | null;

  @Column({ default: true })
  isEnabled: boolean;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_notification_channels_created_by',
  })
  createdBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastTestedAt: Date | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  lastTestStatus: 'success' | 'failed' | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  lastTestError: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('member_notification_preferences')
@Unique('UQ_member_notification_preferences_member_channel', [
  'memberId',
  'channelId',
])
@Index('IDX_member_notification_preferences_route', [
  'householdId',
  'memberId',
  'isEnabled',
])
export class MemberNotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_member_notification_preferences_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_member_notification_preferences_member',
  })
  member: Member;

  @Column('uuid')
  memberId: string;

  @ManyToOne(() => NotificationChannel, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'channelId',
    foreignKeyConstraintName: 'FK_member_notification_preferences_channel',
  })
  channel: NotificationChannel;

  @Column('uuid')
  channelId: string;

  @Column({ default: false })
  isEnabled: boolean;

  @Column({ type: 'jsonb', default: [] })
  modules: NotificationModule[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('notification_deliveries')
@Check(
  'CHK_notification_deliveries_status',
  `"status" IN ('pending', 'processing', 'retry_scheduled', 'sent', 'failed')`,
)
@Check(
  'CHK_notification_deliveries_attempts',
  `"attemptCount" >= 0 AND "maxAttempts" >= 1`,
)
@Check(
  'CHK_notification_deliveries_channel_kind',
  `"channelKind" IN ('webhook', 'ntfy')`,
)
@Unique('UQ_notification_deliveries_notification_channel', [
  'notificationId',
  'channelId',
])
@Index('IDX_notification_deliveries_household_history', [
  'householdId',
  'recipientId',
  'createdAt',
])
@Index('IDX_notification_deliveries_dispatch', ['nextAttemptAt', 'createdAt'], {
  where: `"status" IN ('pending', 'retry_scheduled')`,
})
export class NotificationDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_notification_deliveries_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Notification, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'notificationId',
    foreignKeyConstraintName: 'FK_notification_deliveries_notification',
  })
  notification: Notification;

  @Column('uuid')
  notificationId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'recipientId',
    foreignKeyConstraintName: 'FK_notification_deliveries_recipient',
  })
  recipient: Member;

  @Column('uuid')
  recipientId: string;

  @ManyToOne(() => NotificationChannel, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'channelId',
    foreignKeyConstraintName: 'FK_notification_deliveries_channel',
  })
  channel: NotificationChannel | null;

  @Column({ type: 'uuid', nullable: true })
  channelId: string | null;

  @Column({ type: 'varchar', length: 120 })
  channelName: string;

  @Column({ type: 'varchar', length: 24 })
  channelKind: NotificationChannelKind;

  @Column({ type: 'varchar', length: 255 })
  endpointHint: string;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status: NotificationDeliveryStatus;

  @Column({ type: 'int', default: 0 })
  attemptCount: number;

  @Column({ type: 'int', default: 4 })
  maxAttempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  nextAttemptAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastAttemptAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  lastError: string | null;

  @OneToMany(
    () => NotificationDeliveryAttempt,
    (attempt) => attempt.delivery,
  )
  attempts: NotificationDeliveryAttempt[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('notification_delivery_attempts')
@Check(
  'CHK_notification_delivery_attempts_status',
  `"status" IN ('sent', 'failed')`,
)
@Check(
  'CHK_notification_delivery_attempts_number',
  `"attemptNumber" >= 1`,
)
@Unique('UQ_notification_delivery_attempts_number', [
  'deliveryId',
  'attemptNumber',
])
@Index('IDX_notification_delivery_attempts_delivery_created', [
  'deliveryId',
  'createdAt',
])
export class NotificationDeliveryAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => NotificationDelivery, (delivery) => delivery.attempts, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'deliveryId',
    foreignKeyConstraintName: 'FK_notification_delivery_attempts_delivery',
  })
  delivery: NotificationDelivery;

  @Column('uuid')
  deliveryId: string;

  @Column({ type: 'int' })
  attemptNumber: number;

  @Column({ type: 'varchar', length: 16 })
  status: NotificationDeliveryAttemptStatus;

  @Column({ type: 'int', nullable: true })
  httpStatus: number | null;

  @Column({ type: 'varchar', length: 48, nullable: true })
  errorCode: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  errorMessage: string | null;

  @Column({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz' })
  finishedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('polls')
@Check(
  'CHK_polls_category',
  `"category" IN ('general', 'meal', 'activity', 'movie', 'shopping')`,
)
@Check('CHK_polls_vote_mode', `"voteMode" IN ('single', 'multiple')`)
@Check('CHK_polls_status', `"status" IN ('open', 'closed')`)
@Check(
  'CHK_polls_max_choices',
  `("voteMode" = 'single' AND "maxChoices" = 1) OR ("voteMode" = 'multiple' AND "maxChoices" >= 1 AND "maxChoices" <= 12)`,
)
@Check(
  'CHK_polls_source_pair',
  `("sourceModule" IS NULL AND "sourceId" IS NULL) OR ("sourceModule" IS NOT NULL AND "sourceId" IS NOT NULL)`,
)
@Index('IDX_polls_household_active', [
  'householdId',
  'isArchived',
  'status',
  'createdAt',
])
@Index(
  'UQ_polls_active_media_source',
  ['householdId', 'sourceModule', 'sourceId'],
  {
    unique: true,
    where: `"sourceModule" = 'media' AND "isArchived" = false AND "status" = 'open'`,
  },
)
export class Poll {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_polls_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description: string | null;

  @Column({ type: 'varchar', default: 'general' })
  category: PollCategory;

  @Column({ type: 'varchar', default: 'single' })
  voteMode: PollVoteMode;

  @Column({ type: 'int', default: 1 })
  maxChoices: number;

  @Column({ type: 'timestamptz', nullable: true })
  closesAt: Date | null;

  @Column({ type: 'varchar', default: 'open' })
  status: PollStatus;

  @Column({ type: 'varchar', length: 40, nullable: true })
  sourceModule: string | null;

  @Column({ type: 'uuid', nullable: true })
  sourceId: string | null;

  @Column({ default: false })
  isArchived: boolean;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_polls_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'closedById',
    foreignKeyConstraintName: 'FK_polls_closed_by',
  })
  closedBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  closedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @OneToMany(() => PollOption, (option) => option.poll)
  options: PollOption[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('poll_options')
@Unique('UQ_poll_options_poll_order', ['pollId', 'sortOrder'])
@Index('IDX_poll_options_poll', ['pollId'])
@Index('IDX_poll_options_media', ['mediaId'])
@Index('UQ_poll_options_poll_media', ['pollId', 'mediaId'], { unique: true })
export class PollOption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Poll, (poll) => poll.options, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'pollId',
    foreignKeyConstraintName: 'FK_poll_options_poll',
  })
  poll: Poll;

  @Column('uuid')
  pollId: string;

  @Column({ type: 'varchar', length: 120 })
  label: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @ManyToOne(() => HouseholdMedia, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'mediaId',
    foreignKeyConstraintName: 'FK_poll_options_media',
  })
  media: HouseholdMedia | null;

  @Column({ type: 'uuid', nullable: true })
  mediaId: string | null;

  @Column({ type: 'int' })
  sortOrder: number;

  @OneToMany(() => PollVote, (vote) => vote.option)
  votes: PollVote[];

  @OneToMany(() => GuestPollVote, (vote) => vote.option)
  guestVotes: GuestPollVote[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('poll_votes')
@Unique('UQ_poll_votes_poll_option_member', ['pollId', 'optionId', 'memberId'])
@Index('IDX_poll_votes_household_poll', ['householdId', 'pollId'])
@Index('IDX_poll_votes_member_poll', ['memberId', 'pollId'])
export class PollVote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_poll_votes_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Poll, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'pollId',
    foreignKeyConstraintName: 'FK_poll_votes_poll',
  })
  poll: Poll;

  @Column('uuid')
  pollId: string;

  @ManyToOne(() => PollOption, (option) => option.votes, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'optionId',
    foreignKeyConstraintName: 'FK_poll_votes_option',
  })
  option: PollOption;

  @Column('uuid')
  optionId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_poll_votes_member',
  })
  member: Member;

  @Column('uuid')
  memberId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('guest_poll_votes')
@Unique('UQ_guest_poll_votes_poll_invitation_option', ['pollId', 'invitationId', 'optionId'])
@Index('IDX_guest_poll_votes_household_poll', ['householdId', 'pollId'])
@Index('IDX_guest_poll_votes_invitation_poll', ['invitationId', 'pollId'])
export class GuestPollVote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_guest_poll_votes_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => GuestInvitation, (invitation) => invitation.pollVotes, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'invitationId',
    foreignKeyConstraintName: 'FK_guest_poll_votes_invitation',
  })
  invitation: GuestInvitation;

  @Column('uuid')
  invitationId: string;

  @ManyToOne(() => Poll, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'pollId',
    foreignKeyConstraintName: 'FK_guest_poll_votes_poll',
  })
  poll: Poll;

  @Column('uuid')
  pollId: string;

  @ManyToOne(() => PollOption, (option) => option.guestVotes, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'optionId',
    foreignKeyConstraintName: 'FK_guest_poll_votes_option',
  })
  option: PollOption;

  @Column('uuid')
  optionId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('guest_meal_requests')
@Check('CHK_guest_meal_requests_status', `"status" IN ('pending', 'accepted', 'rejected')`)
@Index('UQ_guest_meal_requests_invitation_menu_item', ['invitationId', 'menuItemId'], {
  unique: true,
  where: `"menuItemId" IS NOT NULL`,
})
@Index('IDX_guest_meal_requests_household_visit', ['householdId', 'visitId'])
export class GuestMealRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_guest_meal_requests_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Visit, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'visitId',
    foreignKeyConstraintName: 'FK_guest_meal_requests_visit',
  })
  visit: Visit;

  @Column('uuid')
  visitId: string;

  @ManyToOne(() => GuestInvitation, (invitation) => invitation.mealRequests, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'invitationId',
    foreignKeyConstraintName: 'FK_guest_meal_requests_invitation',
  })
  invitation: GuestInvitation;

  @Column('uuid')
  invitationId: string;

  @ManyToOne(() => MenuItem, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'menuItemId',
    foreignKeyConstraintName: 'FK_guest_meal_requests_menu_item',
  })
  menuItem: MenuItem | null;

  @Column({ type: 'uuid', nullable: true })
  menuItemId: string | null;

  @Column({ type: 'date' })
  mealDate: string;

  @Column({ type: 'varchar' })
  mealType: MealType;

  @Column({ type: 'varchar', length: 120 })
  dishName: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  @Column({ type: 'varchar', default: 'pending' })
  status: GuestMealRequestStatus;

  @Column({ type: 'varchar', length: 200, nullable: true })
  reviewNote: string | null;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'reviewedById',
    foreignKeyConstraintName: 'FK_guest_meal_requests_reviewed_by',
  })
  reviewedBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('media_titles')
@Check('CHK_media_titles_type', `"type" IN ('movie', 'series')`)
@Check(
  'CHK_media_titles_year',
  `"year" IS NULL OR ("year" >= 1878 AND "year" <= 2199)`,
)
@Unique('UQ_media_titles_dedupe_key', ['dedupeKey'])
export class MediaTitle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16 })
  type: MediaType;

  @Column({ type: 'varchar', length: 180 })
  title: string;

  @Column({ type: 'varchar', length: 180, nullable: true })
  originalTitle: string | null;

  @Column({ type: 'int', nullable: true })
  year: number | null;

  @Column({ type: 'varchar', length: 5000, nullable: true })
  overview: string | null;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  posterUrl: string | null;

  @Column({ type: 'varchar', length: 500 })
  dedupeKey: string;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @OneToMany(() => MediaExternalRef, (externalRef) => externalRef.mediaTitle)
  externalRefs: MediaExternalRef[];

  @OneToMany(() => HouseholdMedia, (householdMedia) => householdMedia.mediaTitle)
  householdEntries: HouseholdMedia[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('media_external_refs')
@Check(
  'CHK_media_external_refs_provider',
  `"provider" IN ('tmdb', 'imdb', 'douban', 'bangumi', 'plex', 'emby', 'moviepilot')`,
)
@Check('CHK_media_external_refs_type', `"mediaType" IN ('movie', 'series')`)
@Check(
  'CHK_media_external_refs_scope',
  `("provider" IN ('tmdb', 'imdb', 'douban', 'bangumi') AND "connectorKey" IS NULL) OR ("provider" IN ('plex', 'emby', 'moviepilot') AND "connectorKey" IS NOT NULL)`,
)
@Index(
  'UQ_media_external_refs_tmdb_type_id',
  ['provider', 'mediaType', 'externalId'],
  { unique: true, where: `"provider" = 'tmdb'` },
)
@Index(
  'UQ_media_external_refs_imdb_id',
  ['provider', 'externalId'],
  { unique: true, where: `"provider" = 'imdb'` },
)
@Index(
  'UQ_media_external_refs_douban_id',
  ['provider', 'externalId'],
  { unique: true, where: `"provider" = 'douban'` },
)
@Index(
  'UQ_media_external_refs_bangumi_id',
  ['provider', 'externalId'],
  { unique: true, where: `"provider" = 'bangumi'` },
)
@Index(
  'UQ_media_external_refs_connector_id',
  ['provider', 'connectorKey', 'externalId'],
  {
    unique: true,
    where: `"provider" IN ('plex', 'emby', 'moviepilot')`,
  },
)
@Index('IDX_media_external_refs_title', ['mediaTitleId'])
export class MediaExternalRef {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => MediaTitle, (title) => title.externalRefs, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'mediaTitleId',
    foreignKeyConstraintName: 'FK_media_external_refs_title',
  })
  mediaTitle: MediaTitle;

  @Column('uuid')
  mediaTitleId: string;

  @Column({ type: 'varchar', length: 32 })
  provider: MediaExternalProvider;

  @Column({ type: 'varchar', length: 16 })
  mediaType: MediaType;

  @Column({ type: 'varchar', length: 180 })
  externalId: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  connectorKey: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('household_media_source_configs')
@Check(
  'CHK_household_media_source_configs_provider',
  `"provider" IN ('tmdb', 'douban', 'bangumi')`,
)
@Check(
  'CHK_household_media_source_configs_credential_kind',
  `"credentialKind" IS NULL OR "credentialKind" IN ('token', 'api_key')`,
)
@Unique('UQ_household_media_source_configs_scope', [
  'householdId',
  'provider',
])
@Index('IDX_household_media_source_configs_household', ['householdId'])
export class HouseholdMediaSourceConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_household_media_source_configs_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 24 })
  provider: MediaMetadataSource;

  @Column({ default: true })
  isEnabled: boolean;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  baseUrl: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  credentialKind: MediaCredentialKind | null;

  @Column({ type: 'text', nullable: true, select: false })
  credentialEncrypted: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  credentialHint: string | null;

  @Column({ type: 'jsonb', default: {} })
  settings: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('integrations')
@Unique('UQ_integrations_household_kind', ['householdId', 'kind'])
@Index('IDX_integrations_household', ['householdId'])
@Index('UQ_integrations_household_primary_library', ['householdId'], {
  unique: true,
  where: `"isPrimary" = true AND "kind" IN ('plex', 'emby')`,
})
export class Integration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_integrations_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 48 })
  kind: IntegrationKind;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ default: true })
  isEnabled: boolean;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  baseUrl: string | null;

  @Column({ default: false })
  isPrimary: boolean;

  @Column({ type: 'jsonb', default: [] })
  capabilities: string[];

  @Column({ type: 'jsonb', default: {} })
  settings: Record<string, unknown>;

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true, select: false })
  webhookSecretHash: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  webhookSourceIp: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  webhookUpdatedAt: Date | null;

  @OneToOne(() => IntegrationSecret, (secret) => secret.integration)
  secret: IntegrationSecret | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('integration_secrets')
@Unique('UQ_integration_secrets_integration', ['integrationId'])
export class IntegrationSecret {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Integration, (integration) => integration.secret, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'integrationId',
    foreignKeyConstraintName: 'FK_integration_secrets_integration',
  })
  integration: Integration;

  @Column('uuid')
  integrationId: string;

  @Column({ type: 'text', select: false })
  credentialEncrypted: string;

  @Column({ type: 'varchar', length: 16 })
  credentialHint: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('integration_events')
@Check(
  'CHK_integration_events_status',
  `"status" IN ('processed', 'ignored', 'failed')`,
)
@Unique('UQ_integration_events_idempotency', [
  'integrationId',
  'idempotencyKey',
])
@Index('IDX_integration_events_household_received', [
  'householdId',
  'receivedAt',
])
export class IntegrationEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_integration_events_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Integration, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'integrationId',
    foreignKeyConstraintName: 'FK_integration_events_integration',
  })
  integration: Integration;

  @Column('uuid')
  integrationId: string;

  @Column({ type: 'varchar', length: 48 })
  provider: IntegrationKind;

  @Column({ type: 'varchar', length: 80 })
  eventType: string;

  @Column({ type: 'varchar', length: 64 })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 24 })
  status: IntegrationEventStatus;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @Column({ type: 'varchar', length: 500, nullable: true })
  error: string | null;

  @ManyToOne(() => MediaRequest, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'mediaRequestId',
    foreignKeyConstraintName: 'FK_integration_events_media_request',
  })
  mediaRequest: MediaRequest | null;

  @Column({ type: 'uuid', nullable: true })
  mediaRequestId: string | null;

  @ManyToOne(() => ViewingSession, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'viewingSessionId',
    foreignKeyConstraintName: 'FK_integration_events_viewing_session',
  })
  viewingSession: ViewingSession | null;

  @Column({ type: 'uuid', nullable: true })
  viewingSessionId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  receivedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;
}

@Entity('media_user_mappings')
@Check(
  'CHK_media_user_mappings_provider',
  `"provider" IN ('plex', 'emby')`,
)
@Unique('UQ_media_user_mappings_external', [
  'householdId',
  'connectorKey',
  'serverId',
  'externalUserId',
])
@Unique('UQ_media_user_mappings_member', [
  'householdId',
  'connectorKey',
  'serverId',
  'memberId',
])
@Index('IDX_media_user_mappings_household_provider', [
  'householdId',
  'provider',
])
export class MediaUserMapping {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_media_user_mappings_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 32 })
  provider: MediaLibraryProviderKind;

  @Column({ type: 'varchar', length: 128 })
  connectorKey: string;

  @Column({ type: 'varchar', length: 180 })
  serverId: string;

  @Column({ type: 'varchar', length: 180 })
  externalUserId: string;

  @Column({ type: 'varchar', length: 180 })
  externalUserName: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_media_user_mappings_member',
  })
  member: Member;

  @Column('uuid')
  memberId: string;

  @Column({ type: 'timestamptz' })
  lastSeenAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('media_library_items')
@Check(
  'CHK_media_library_items_provider',
  `"provider" IN ('plex', 'emby')`,
)
@Check(
  'CHK_media_library_items_type',
  `"mediaType" IN ('movie', 'series')`,
)
@Unique('UQ_media_library_items_connector_item', [
  'householdId',
  'connectorKey',
  'libraryItemId',
])
@Index('IDX_media_library_items_household_title', [
  'householdId',
  'title',
])
@Index('IDX_media_library_items_media_title', ['mediaTitleId'])
export class MediaLibraryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_media_library_items_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => MediaTitle, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'mediaTitleId',
    foreignKeyConstraintName: 'FK_media_library_items_media_title',
  })
  mediaTitle: MediaTitle | null;

  @Column({ type: 'uuid', nullable: true })
  mediaTitleId: string | null;

  @Column({ type: 'varchar', length: 32 })
  provider: MediaLibraryProviderKind;

  @Column({ type: 'varchar', length: 128 })
  connectorKey: string;

  @Column({ type: 'varchar', length: 180 })
  libraryItemId: string;

  @Column({ type: 'varchar', length: 16 })
  mediaType: MediaType;

  @Column({ type: 'varchar', length: 180 })
  title: string;

  @Column({ type: 'varchar', length: 180, nullable: true })
  originalTitle: string | null;

  @Column({ type: 'int', nullable: true })
  year: number | null;

  @Column({ type: 'varchar', length: 5000, nullable: true })
  overview: string | null;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  posterUrl: string | null;

  @Column({ type: 'jsonb', default: [] })
  externalRefs: {
    provider: 'tmdb' | 'imdb';
    mediaType: MediaType;
    externalId: string;
  }[];

  @Column({ type: 'varchar', length: 4000, nullable: true })
  playbackUrl: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @Column({ type: 'timestamptz' })
  lastSeenAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('viewing_sessions')
@Check(
  'CHK_viewing_sessions_provider',
  `"provider" IN ('plex', 'emby')`,
)
@Check(
  'CHK_viewing_sessions_media_type',
  `"mediaType" IN ('movie', 'series')`,
)
@Check(
  'CHK_viewing_sessions_status',
  `"status" IN ('active', 'paused', 'stopped', 'completed')`,
)
@Unique('UQ_viewing_sessions_external', [
  'integrationId',
  'serverId',
  'externalSessionId',
])
@Index('IDX_viewing_sessions_household_last_event', [
  'householdId',
  'lastEventAt',
])
@Index('IDX_viewing_sessions_playback_key', [
  'integrationId',
  'serverId',
  'playbackKey',
  'lastEventAt',
])
export class ViewingSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_viewing_sessions_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Integration, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'integrationId',
    foreignKeyConstraintName: 'FK_viewing_sessions_integration',
  })
  integration: Integration | null;

  @Column({ type: 'uuid', nullable: true })
  integrationId: string | null;

  @Column({ type: 'varchar', length: 32 })
  provider: MediaLibraryProviderKind;

  @Column({ type: 'varchar', length: 128 })
  connectorKey: string;

  @Column({ type: 'varchar', length: 180 })
  serverId: string;

  @Column({ type: 'varchar', length: 180 })
  externalSessionId: string;

  @Column({ type: 'varchar', length: 64 })
  playbackKey: string;

  @ManyToOne(() => MediaLibraryItem, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'mediaLibraryItemId',
    foreignKeyConstraintName: 'FK_viewing_sessions_library_item',
  })
  mediaLibraryItem: MediaLibraryItem | null;

  @Column({ type: 'uuid', nullable: true })
  mediaLibraryItemId: string | null;

  @ManyToOne(() => MediaTitle, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'mediaTitleId',
    foreignKeyConstraintName: 'FK_viewing_sessions_media_title',
  })
  mediaTitle: MediaTitle | null;

  @Column({ type: 'uuid', nullable: true })
  mediaTitleId: string | null;

  @Column({ type: 'varchar', length: 180 })
  libraryItemId: string;

  @Column({ type: 'varchar', length: 180 })
  contentItemId: string;

  @Column({ type: 'varchar', length: 16 })
  mediaType: MediaType;

  @Column({ type: 'varchar', length: 240 })
  title: string;

  @Column({ type: 'varchar', length: 180, nullable: true })
  deviceName: string | null;

  @Column({ type: 'varchar', length: 24 })
  status: ViewingSessionStatus;

  @Column({ type: 'int', default: 0 })
  positionMs: number;

  @Column({ type: 'int', nullable: true })
  durationMs: number | null;

  @Column({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Column({ type: 'timestamptz' })
  lastEventAt: Date;

  @OneToMany(() => ViewingParticipant, (participant) => participant.session)
  participants: ViewingParticipant[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('viewing_participants')
@Index('UQ_viewing_participants_session_member', ['sessionId', 'memberId'], {
  unique: true,
  where: `"memberId" IS NOT NULL`,
})
@Index('IDX_viewing_participants_member_seen', ['memberId', 'lastSeenAt'])
export class ViewingParticipant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ViewingSession, (session) => session.participants, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'sessionId',
    foreignKeyConstraintName: 'FK_viewing_participants_session',
  })
  session: ViewingSession;

  @Column('uuid')
  sessionId: string;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_viewing_participants_member',
  })
  member: Member | null;

  @Column({ type: 'uuid', nullable: true })
  memberId: string | null;

  @Column({ type: 'varchar', length: 180 })
  memberName: string;

  @Column({ type: 'varchar', length: 180 })
  externalUserId: string;

  @Column({ type: 'varchar', length: 180 })
  externalUserName: string;

  @Column({ type: 'timestamptz' })
  joinedAt: Date;

  @Column({ type: 'timestamptz' })
  lastSeenAt: Date;

  @Column({ type: 'int', default: 0 })
  finalPositionMs: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('viewing_progress')
@Check(
  'CHK_viewing_progress_provider',
  `"provider" IN ('plex', 'emby')`,
)
@Unique('UQ_viewing_progress_member_item', [
  'householdId',
  'memberId',
  'connectorKey',
  'contentItemId',
])
@Index('IDX_viewing_progress_household_watched', [
  'householdId',
  'lastWatchedAt',
])
export class ViewingProgress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_viewing_progress_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Member, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_viewing_progress_member',
  })
  member: Member;

  @Column('uuid')
  memberId: string;

  @Column({ type: 'varchar', length: 32 })
  provider: MediaLibraryProviderKind;

  @Column({ type: 'varchar', length: 128 })
  connectorKey: string;

  @ManyToOne(() => MediaLibraryItem, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'mediaLibraryItemId',
    foreignKeyConstraintName: 'FK_viewing_progress_library_item',
  })
  mediaLibraryItem: MediaLibraryItem | null;

  @Column({ type: 'uuid', nullable: true })
  mediaLibraryItemId: string | null;

  @ManyToOne(() => MediaTitle, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'mediaTitleId',
    foreignKeyConstraintName: 'FK_viewing_progress_media_title',
  })
  mediaTitle: MediaTitle | null;

  @Column({ type: 'uuid', nullable: true })
  mediaTitleId: string | null;

  @ManyToOne(() => ViewingSession, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'lastViewingSessionId',
    foreignKeyConstraintName: 'FK_viewing_progress_last_session',
  })
  lastViewingSession: ViewingSession | null;

  @Column({ type: 'uuid', nullable: true })
  lastViewingSessionId: string | null;

  @Column({ type: 'varchar', length: 180 })
  contentItemId: string;

  @Column({ type: 'varchar', length: 240 })
  title: string;

  @Column({ type: 'int', default: 0 })
  positionMs: number;

  @Column({ type: 'int', nullable: true })
  durationMs: number | null;

  @Column({ type: 'double precision', default: 0 })
  percentage: number;

  @Column({ default: false })
  completed: boolean;

  @Column({ type: 'timestamptz' })
  lastWatchedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('household_media')
@Check(
  'CHK_household_media_status',
  `"status" IN ('watchlist', 'voting', 'scheduled', 'watching', 'completed', 'dropped')`,
)
@Check(
  'CHK_household_media_schedule',
  `"status" <> 'scheduled' OR "scheduledFor" IS NOT NULL`,
)
@Unique('UQ_household_media_household_title', ['householdId', 'mediaTitleId'])
@Index('IDX_household_media_household_status', [
  'householdId',
  'status',
  'updatedAt',
])
@Index('IDX_household_media_household_schedule', [
  'householdId',
  'scheduledFor',
])
export class HouseholdMedia {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_household_media_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => MediaTitle, (title) => title.householdEntries, {
    eager: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'mediaTitleId',
    foreignKeyConstraintName: 'FK_household_media_title',
  })
  mediaTitle: MediaTitle;

  @Column('uuid')
  mediaTitleId: string;

  @Column({ type: 'varchar', length: 24, default: 'watchlist' })
  status: HouseholdMediaStatus;

  @Column({ type: 'date', nullable: true })
  scheduledFor: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_household_media_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @OneToMany(() => MediaRequest, (request) => request.householdMedia)
  requests: MediaRequest[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('media_requests')
@Check(
  'CHK_media_requests_status',
  `"status" IN ('pending', 'processing', 'completed', 'failed', 'cancelled')`,
)
@Check(
  'CHK_media_requests_season',
  `"season" >= 0 AND "season" <= 999`,
)
@Index('IDX_media_requests_household_status', [
  'householdId',
  'status',
  'updatedAt',
])
@Index(
  'UQ_media_requests_active_scope',
  ['householdId', 'householdMediaId', 'connectorKey', 'season'],
  {
    unique: true,
    where: `"status" IN ('pending', 'processing')`,
  },
)
@Index(
  'UQ_media_requests_connector_external',
  ['connectorKey', 'externalRequestId'],
  { unique: true, where: `"externalRequestId" IS NOT NULL` },
)
export class MediaRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_media_requests_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => HouseholdMedia, (entry) => entry.requests, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'householdMediaId',
    foreignKeyConstraintName: 'FK_media_requests_household_media',
  })
  householdMedia: HouseholdMedia;

  @Column('uuid')
  householdMediaId: string;

  @Column({ type: 'varchar', length: 128 })
  connectorKey: string;

  @Column({ type: 'int', default: 0 })
  season: number;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status: MediaRequestStatus;

  @Column({ type: 'varchar', length: 180, nullable: true })
  externalRequestId: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  message: string | null;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'requestedById',
    foreignKeyConstraintName: 'FK_media_requests_requested_by',
  })
  requestedBy: Member;

  @Column('uuid')
  requestedById: string;

  @ManyToOne(() => Member, {
    eager: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'cancelledById',
    foreignKeyConstraintName: 'FK_media_requests_cancelled_by',
  })
  cancelledBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  cancelledById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('reminders')
@Check(
  'CHK_reminders_source_module',
  `"sourceModule" IN ('menu', 'task', 'calendar', 'poll', 'maintenance', 'travel')`,
)
@Check(
  'CHK_reminders_status',
  `"status" IN ('scheduled', 'sent', 'cancelled')`,
)
@Check(
  'CHK_reminders_occurrence_date',
  `("sourceModule" = 'task' AND "occurrenceDate" IS NOT NULL) OR ("sourceModule" <> 'task' AND "occurrenceDate" IS NULL)`,
)
@Index('IDX_reminders_household_status', ['householdId', 'status', 'remindAt'])
@Index('IDX_reminders_due', ['status', 'remindAt'])
export class Reminder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_reminders_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar' })
  sourceModule: ReminderSourceModule;

  @Column('uuid')
  sourceId: string;

  @Column({ type: 'date', nullable: true })
  occurrenceDate: string | null;

  @Column({ type: 'timestamptz' })
  remindAt: Date;

  @Column({ type: 'varchar', default: 'scheduled' })
  status: ReminderStatus;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_reminders_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @OneToMany(() => ReminderRecipient, (recipient) => recipient.reminder)
  recipients: ReminderRecipient[];

  @Column({ type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  cancelReason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('reminder_recipients')
@Unique('UQ_reminder_recipients_reminder_member', ['reminderId', 'memberId'])
@Index('IDX_reminder_recipients_pending', ['reminderId', 'deliveredAt'])
export class ReminderRecipient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_reminder_recipients_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Reminder, (reminder) => reminder.recipients, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'reminderId',
    foreignKeyConstraintName: 'FK_reminder_recipients_reminder',
  })
  reminder: Reminder;

  @Column('uuid')
  reminderId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_reminder_recipients_member',
  })
  member: Member;

  @Column('uuid')
  memberId: string;

  @ManyToOne(() => Notification, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'notificationId',
    foreignKeyConstraintName: 'FK_reminder_recipients_notification',
  })
  notification: Notification | null;

  @Column({ type: 'uuid', nullable: true })
  notificationId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('home_assets')
@Check(
  'CHK_home_assets_category',
  `"category" IN ('appliance', 'furniture', 'electronics', 'tool', 'subscription', 'other')`,
)
@Check('CHK_home_assets_status', `"status" IN ('active', 'retired')`)
@Check(
  'CHK_home_assets_purchase_price',
  `"purchasePrice" IS NULL OR "purchasePrice" >= 0`,
)
@Check(
  'CHK_home_assets_warranty_dates',
  `"purchaseDate" IS NULL OR "warrantyExpiresOn" IS NULL OR "warrantyExpiresOn" >= "purchaseDate"`,
)
@Index('IDX_home_assets_household_status', ['householdId', 'status'])
@Index('IDX_home_assets_household_category', ['householdId', 'category'])
export class HomeAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_home_assets_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 24 })
  category: AssetCategory;

  @Column({ type: 'varchar', length: 80, nullable: true })
  location: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  brand: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  model: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  serialNumber: string | null;

  @Column({ type: 'date', nullable: true })
  purchaseDate: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  purchasePrice: string | null;

  @Column({ type: 'date', nullable: true })
  warrantyExpiresOn: string | null;

  @Column({ type: 'date', nullable: true })
  renewsOn: string | null;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: AssetStatus;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_home_assets_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @OneToMany(() => AssetDocument, (document) => document.asset)
  documents: AssetDocument[];

  @OneToMany(() => MaintenancePlan, (plan) => plan.asset)
  maintenancePlans: MaintenancePlan[];

  @OneToMany(() => MaintenanceRecord, (record) => record.asset)
  maintenanceRecords: MaintenanceRecord[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('asset_documents')
@Check(
  'CHK_asset_documents_type',
  `"type" IN ('receipt', 'manual', 'warranty', 'other')`,
)
@Index('IDX_asset_documents_asset_created', ['assetId', 'createdAt'])
export class AssetDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_asset_documents_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => HomeAsset, (asset) => asset.documents, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'assetId',
    foreignKeyConstraintName: 'FK_asset_documents_asset',
  })
  asset: HomeAsset;

  @Column('uuid')
  assetId: string;

  @Column({ type: 'varchar', length: 24 })
  type: AssetDocumentType;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 2000 })
  url: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_asset_documents_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('maintenance_plans')
@Check(
  'CHK_maintenance_plans_frequency',
  `"frequencyDays" >= 1 AND "frequencyDays" <= 3650`,
)
@Unique('UQ_maintenance_plans_asset_title', ['assetId', 'title'])
@Index('IDX_maintenance_plans_household_due', [
  'householdId',
  'isEnabled',
  'nextDueDate',
])
export class MaintenancePlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_maintenance_plans_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => HomeAsset, (asset) => asset.maintenancePlans, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'assetId',
    foreignKeyConstraintName: 'FK_maintenance_plans_asset',
  })
  asset: HomeAsset;

  @Column('uuid')
  assetId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'integer' })
  frequencyDays: number;

  @Column({ type: 'date' })
  nextDueDate: string;

  @Column({ default: true })
  isEnabled: boolean;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_maintenance_plans_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @OneToMany(() => MaintenanceRecord, (record) => record.plan)
  records: MaintenanceRecord[];

  @OneToMany(() => MaintenanceConsumable, (consumable) => consumable.plan)
  consumables: MaintenanceConsumable[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('maintenance_records')
@Check(
  'CHK_maintenance_records_cost',
  `"cost" IS NULL OR "cost" >= 0`,
)
@Unique('UQ_maintenance_records_household_idempotency', [
  'householdId',
  'idempotencyKey',
])
@Index('IDX_maintenance_records_asset_performed', ['assetId', 'performedAt'])
@Index('IDX_maintenance_records_plan_performed', ['planId', 'performedAt'])
@Index('IDX_maintenance_records_inventory_operation', ['inventoryOperationId'], {
  where: '"inventoryOperationId" IS NOT NULL',
})
export class MaintenanceRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_maintenance_records_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => HomeAsset, (asset) => asset.maintenanceRecords, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'assetId',
    foreignKeyConstraintName: 'FK_maintenance_records_asset',
  })
  asset: HomeAsset;

  @Column('uuid')
  assetId: string;

  @ManyToOne(() => MaintenancePlan, (plan) => plan.records, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'planId',
    foreignKeyConstraintName: 'FK_maintenance_records_plan',
  })
  plan: MaintenancePlan;

  @Column('uuid')
  planId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'performedById',
    foreignKeyConstraintName: 'FK_maintenance_records_performed_by',
  })
  performedBy: Member;

  @Column('uuid')
  performedById: string;

  @Column({ type: 'timestamptz' })
  performedAt: Date;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  cost: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 160 })
  idempotencyKey: string;

  @Column({ type: 'date' })
  nextDueDateBefore: string;

  @Column({ type: 'date' })
  nextDueDateAfter: string;

  @Column({ type: 'jsonb', default: [] })
  consumablesSnapshot: MaintenanceConsumableSnapshot[];

  @Column({ type: 'uuid', nullable: true })
  inventoryOperationId: string | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt: Date;
}

@Entity('shopping_items')
@Index('IDX_shopping_household_date', ['householdId', 'date'])
@Index('IDX_shopping_items_inventory_item', ['inventoryItemId'], {
  where: '"inventoryItemId" IS NOT NULL',
})
@Index(
  'UQ_shopping_maintenance_date_link',
  ['householdId', 'date', 'maintenanceConsumableId'],
  {
    unique: true,
    where: '"source" = \'maintenance\' AND "maintenanceConsumableId" IS NOT NULL',
  },
)
export class ShoppingItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_shopping_items_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'date' })
  date: string;

  @ManyToOne(() => Ingredient, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'ingredientId',
    foreignKeyConstraintName: 'FK_5aaa346328d071175cc0903b902',
  })
  ingredient: Ingredient | null;

  @Column({ type: 'uuid', nullable: true })
  ingredientId: string | null;

  @Column({ type: 'varchar', nullable: true })
  customName: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  totalQty: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  requiredQty: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  availableQty: string | null;

  @Column({ type: 'varchar', nullable: true })
  unit: string | null;

  @Column({ default: false })
  checked: boolean;

  @Column({ type: 'varchar', default: 'auto' })
  source: 'auto' | 'manual' | 'maintenance';

  @ManyToOne(() => InventoryItem, {
    eager: true,
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'inventoryItemId',
    foreignKeyConstraintName: 'FK_shopping_items_inventory_item',
  })
  inventoryItem: InventoryItem | null;

  @Column({ type: 'uuid', nullable: true })
  inventoryItemId: string | null;

  @ManyToOne(() => MaintenanceConsumable, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'maintenanceConsumableId',
    foreignKeyConstraintName: 'FK_shopping_items_maintenance_consumable',
  })
  maintenanceConsumable: MaintenanceConsumable | null;

  @Column({ type: 'uuid', nullable: true })
  maintenanceConsumableId: string | null;
}

@Entity('inventory_items')
@Unique('UQ_inventory_household_name', ['householdId', 'name'])
@Index('IDX_inventory_household', ['householdId'])
@Index('UQ_inventory_household_ingredient_unit', ['householdId', 'ingredientId', 'unit'], {
  unique: true,
  where: '"ingredientId" IS NOT NULL',
})
export class InventoryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_inventory_items_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Ingredient, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'ingredientId',
    foreignKeyConstraintName: 'FK_inventory_items_ingredient',
  })
  ingredient: Ingredient | null;

  @Column({ type: 'uuid', nullable: true })
  ingredientId: string | null;

  @Column()
  name: string;

  @Column({ type: 'varchar', default: '其他' })
  category: InventoryCategory;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  quantity: string;

  @Column({ type: 'varchar', default: '份' })
  unit: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 1 })
  lowStockThreshold: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 1 })
  restockQuantity: string;

  @OneToMany(() => InventoryBatch, (batch) => batch.inventoryItem)
  batches: InventoryBatch[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('inventory_batches')
@Check(
  'CHK_inventory_batches_quantity',
  `"quantity" >= 0 AND "quantity" <= 99999999.99`,
)
@Check(
  'CHK_inventory_batches_source',
  `"sourceType" IN ('manual', 'shopping_item')`,
)
@Check('CHK_inventory_batches_version', `"version" > 0`)
@Check(
  'CHK_inventory_batches_dates',
  `"productionDate" IS NULL OR "expiresOn" IS NULL OR "expiresOn" >= "productionDate"`,
)
@Index(
  'UQ_inventory_batches_household_source',
  ['householdId', 'sourceType', 'sourceId'],
  { unique: true },
)
@Index('IDX_inventory_batches_household_expiry', ['householdId', 'expiresOn'], {
  where: '"quantity" > 0',
})
@Index('IDX_inventory_batches_item_received', [
  'inventoryItemId',
  'receivedOn',
  'createdAt',
])
export class InventoryBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_inventory_batches_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => InventoryItem, (item) => item.batches, {
    eager: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'inventoryItemId',
    foreignKeyConstraintName: 'FK_inventory_batches_item',
  })
  inventoryItem: InventoryItem;

  @Column('uuid')
  inventoryItemId: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  quantity: string;

  @Column({ type: 'date' })
  receivedOn: string;

  @Column({ type: 'date', nullable: true })
  productionDate: string | null;

  @Column({ type: 'date', nullable: true })
  expiresOn: string | null;

  @Column({ type: 'date', nullable: true })
  openedOn: string | null;

  @Column({ type: 'varchar', length: 32 })
  sourceType: InventoryBatchSourceType;

  @Column('uuid')
  sourceId: string;

  @Column({ type: 'int', default: 1 })
  version: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_inventory_batches_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @OneToMany(() => InventoryBatchMovement, (movement) => movement.batch)
  movements: InventoryBatchMovement[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('maintenance_consumables')
@Check(
  'CHK_maintenance_consumables_quantity',
  `"quantity" > 0 AND "quantity" <= 99999999.99`,
)
@Unique('UQ_maintenance_consumables_plan_inventory', [
  'planId',
  'inventoryItemId',
])
@Index('IDX_maintenance_consumables_household_plan', ['householdId', 'planId'])
@Index('IDX_maintenance_consumables_inventory_item', ['inventoryItemId'])
export class MaintenanceConsumable {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_maintenance_consumables_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => MaintenancePlan, (plan) => plan.consumables, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'planId',
    foreignKeyConstraintName: 'FK_maintenance_consumables_plan',
  })
  plan: MaintenancePlan;

  @Column('uuid')
  planId: string;

  @ManyToOne(() => InventoryItem, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'inventoryItemId',
    foreignKeyConstraintName: 'FK_maintenance_consumables_inventory_item',
  })
  inventoryItem: InventoryItem;

  @Column('uuid')
  inventoryItemId: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  quantity: string;

  @Column({ type: 'varchar', length: 16 })
  unit: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_maintenance_consumables_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('inventory_transactions')
@Check(
  'CHK_inventory_transactions_type',
  `"type" IN ('receipt', 'consumption', 'adjustment', 'reversal')`,
)
@Check(
  'CHK_inventory_transactions_source_type',
  `"sourceType" IN ('shopping_item', 'menu', 'maintenance_record', 'inventory_item', 'manual_adjustment', 'inventory_transaction')`,
)
@Check(
  'CHK_inventory_transactions_quantities',
  `"quantityBefore" >= 0 AND "quantityAfter" >= 0 AND "delta" <> 0 AND "quantityAfter" = "quantityBefore" + "delta"`,
)
@Check(
  'CHK_inventory_transactions_reversal',
  `("type" = 'reversal' AND "reversesTransactionId" IS NOT NULL) OR ("type" <> 'reversal' AND "reversesTransactionId" IS NULL)`,
)
@Index(
  'UQ_inventory_transactions_household_idempotency',
  ['householdId', 'idempotencyKey'],
  { unique: true },
)
@Index('IDX_inventory_transactions_household_created', [
  'householdId',
  'createdAt',
])
@Index('IDX_inventory_transactions_item_created', [
  'inventoryItemId',
  'createdAt',
])
@Index('IDX_inventory_transactions_operation', ['householdId', 'operationId'])
@Index('IDX_inventory_transactions_source', [
  'householdId',
  'sourceType',
  'sourceId',
])
@Index(
  'UQ_inventory_transactions_reversal',
  ['reversesTransactionId'],
  { unique: true, where: '"reversesTransactionId" IS NOT NULL' },
)
export class InventoryTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_inventory_transactions_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => InventoryItem, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'inventoryItemId',
    foreignKeyConstraintName: 'FK_inventory_transactions_item',
  })
  inventoryItem: InventoryItem;

  @Column('uuid')
  inventoryItemId: string;

  @Column('uuid')
  operationId: string;

  @Column({ type: 'varchar', length: 24 })
  type: InventoryTransactionType;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  quantityBefore: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  delta: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  quantityAfter: string;

  @Column({ type: 'varchar', length: 16 })
  unit: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'actorId',
    foreignKeyConstraintName: 'FK_inventory_transactions_actor',
  })
  actor: Member;

  @Column('uuid')
  actorId: string;

  @Column({ type: 'varchar', length: 80 })
  actorName: string;

  @Column({ type: 'varchar', length: 32 })
  sourceType: InventoryTransactionSourceType;

  @Column('uuid')
  sourceId: string;

  @Column({ type: 'varchar', length: 180 })
  idempotencyKey: string;

  @ManyToOne(() => InventoryTransaction, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'reversesTransactionId',
    foreignKeyConstraintName: 'FK_inventory_transactions_reverses',
  })
  reversesTransaction: InventoryTransaction | null;

  @Column({ type: 'uuid', nullable: true })
  reversesTransactionId: string | null;

  @OneToMany(
    () => InventoryBatchMovement,
    (movement) => movement.inventoryTransaction,
  )
  batchMovements: InventoryBatchMovement[];

  @CreateDateColumn({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt: Date;
}

@Entity('inventory_batch_movements')
@Check(
  'CHK_inventory_batch_movements_type',
  `"type" IN ('allocation', 'receipt', 'consumption', 'adjustment', 'reversal')`,
)
@Check(
  'CHK_inventory_batch_movements_source',
  `"sourceType" IN ('batch_registration', 'shopping_item', 'menu', 'maintenance_record', 'manual_adjustment', 'inventory_transaction')`,
)
@Check(
  'CHK_inventory_batch_movements_quantities',
  `"quantityBefore" >= 0 AND "quantityAfter" >= 0 AND "delta" <> 0 AND "quantityAfter" = "quantityBefore" + "delta"`,
)
@Check(
  'CHK_inventory_batch_movements_reversal',
  `("type" = 'reversal' AND "reversesMovementId" IS NOT NULL) OR ("type" <> 'reversal' AND "reversesMovementId" IS NULL)`,
)
@Index(
  'UQ_inventory_batch_movements_household_idempotency',
  ['householdId', 'idempotencyKey'],
  { unique: true },
)
@Index('IDX_inventory_batch_movements_batch_created', [
  'batchId',
  'createdAt',
])
@Index(
  'IDX_inventory_batch_movements_transaction',
  ['inventoryTransactionId'],
  { where: '"inventoryTransactionId" IS NOT NULL' },
)
@Index('UQ_inventory_batch_movements_reversal', ['reversesMovementId'], {
  unique: true,
  where: '"reversesMovementId" IS NOT NULL',
})
export class InventoryBatchMovement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_inventory_batch_movements_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => InventoryBatch, (batch) => batch.movements, {
    eager: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'batchId',
    foreignKeyConstraintName: 'FK_inventory_batch_movements_batch',
  })
  batch: InventoryBatch;

  @Column('uuid')
  batchId: string;

  @ManyToOne(
    () => InventoryTransaction,
    (transaction) => transaction.batchMovements,
    { nullable: true, onDelete: 'RESTRICT' },
  )
  @JoinColumn({
    name: 'inventoryTransactionId',
    foreignKeyConstraintName: 'FK_inventory_batch_movements_transaction',
  })
  inventoryTransaction: InventoryTransaction | null;

  @Column({ type: 'uuid', nullable: true })
  inventoryTransactionId: string | null;

  @Column('uuid')
  operationId: string;

  @Column({ type: 'varchar', length: 24 })
  type: InventoryBatchMovementType;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  quantityBefore: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  delta: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  quantityAfter: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'actorId',
    foreignKeyConstraintName: 'FK_inventory_batch_movements_actor',
  })
  actor: Member;

  @Column('uuid')
  actorId: string;

  @Column({ type: 'varchar', length: 80 })
  actorName: string;

  @Column({ type: 'varchar', length: 32 })
  sourceType: InventoryBatchMovementSourceType;

  @Column('uuid')
  sourceId: string;

  @Column({ type: 'varchar', length: 180 })
  idempotencyKey: string;

  @ManyToOne(() => InventoryBatchMovement, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'reversesMovementId',
    foreignKeyConstraintName: 'FK_inventory_batch_movements_reverses',
  })
  reversesMovement: InventoryBatchMovement | null;

  @Column({ type: 'uuid', nullable: true })
  reversesMovementId: string | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt: Date;
}

@Entity('points_accounts')
@Check('CHK_points_accounts_balance', `"balance" >= 0`)
@Unique('UQ_points_accounts_household_member', ['householdId', 'memberId'])
@Index('IDX_points_accounts_household_balance', ['householdId', 'balance'])
export class PointsAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_points_accounts_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_points_accounts_member',
  })
  member: Member;

  @Column('uuid')
  memberId: string;

  @Column({ type: 'int', default: 0 })
  balance: number;

  @OneToMany(() => PointsLedger, (entry) => entry.account)
  ledger: PointsLedger[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('points_ledger')
@Check(
  'CHK_points_ledger_type',
  `"type" IN ('award', 'adjustment', 'redemption', 'reversal')`,
)
@Check(
  'CHK_points_ledger_source_type',
  `"sourceType" IN ('manual', 'task', 'reward_redemption', 'points_ledger')`,
)
@Check(
  'CHK_points_ledger_quantities',
  `"pointsBefore" >= 0 AND "pointsAfter" >= 0 AND "delta" <> 0 AND "pointsAfter" = "pointsBefore" + "delta"`,
)
@Check(
  'CHK_points_ledger_reversal',
  `("type" = 'reversal' AND "reversesLedgerId" IS NOT NULL) OR ("type" <> 'reversal' AND "reversesLedgerId" IS NULL)`,
)
@Index(
  'UQ_points_ledger_household_idempotency',
  ['householdId', 'idempotencyKey'],
  { unique: true },
)
@Index('IDX_points_ledger_household_created', ['householdId', 'createdAt'])
@Index('IDX_points_ledger_member_created', ['memberId', 'createdAt'])
@Index('UQ_points_ledger_reversal', ['reversesLedgerId'], {
  unique: true,
  where: '"reversesLedgerId" IS NOT NULL',
})
export class PointsLedger {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_points_ledger_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => PointsAccount, (account) => account.ledger, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'accountId',
    foreignKeyConstraintName: 'FK_points_ledger_account',
  })
  account: PointsAccount;

  @Column('uuid')
  accountId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_points_ledger_member',
  })
  member: Member;

  @Column('uuid')
  memberId: string;

  @Column({ type: 'varchar', length: 24 })
  type: PointsLedgerType;

  @Column({ type: 'int' })
  pointsBefore: number;

  @Column({ type: 'int' })
  delta: number;

  @Column({ type: 'int' })
  pointsAfter: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'actorId',
    foreignKeyConstraintName: 'FK_points_ledger_actor',
  })
  actor: Member;

  @Column('uuid')
  actorId: string;

  @Column({ type: 'varchar', length: 80 })
  actorName: string;

  @Column({ type: 'varchar', length: 32 })
  sourceType: PointsLedgerSourceType;

  @Column({ type: 'varchar', length: 180 })
  sourceId: string;

  @Column({ type: 'varchar', length: 180 })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @ManyToOne(() => PointsLedger, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'reversesLedgerId',
    foreignKeyConstraintName: 'FK_points_ledger_reverses',
  })
  reversesLedger: PointsLedger | null;

  @Column({ type: 'uuid', nullable: true })
  reversesLedgerId: string | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt: Date;
}

@Entity('finance_accounts')
@Check(
  'CHK_finance_accounts_type',
  `"type" IN ('cash', 'bank', 'alipay', 'wechat', 'other')`,
)
@Check('CHK_finance_accounts_currency', `"currency" = 'CNY'`)
@Check('CHK_finance_accounts_version', `"version" >= 1`)
@Unique('UQ_finance_accounts_household_name', ['householdId', 'name'])
@Index('IDX_finance_accounts_household_active', [
  'householdId',
  'isActive',
  'createdAt',
])
export class FinanceAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_finance_accounts_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 16 })
  type: FinanceAccountType;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  openingBalance: string;

  @Column({ type: 'varchar', length: 3, default: 'CNY' })
  currency: 'CNY';

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 1 })
  version: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_finance_accounts_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('finance_categories')
@Check(
  'CHK_finance_categories_kind',
  `"kind" IN ('expense', 'income')`,
)
@Check('CHK_finance_categories_version', `"version" >= 1`)
@Unique('UQ_finance_categories_household_kind_name', [
  'householdId',
  'kind',
  'name',
])
@Index('UQ_finance_categories_household_system_key', [
  'householdId',
  'systemKey',
], {
  unique: true,
  where: '"systemKey" IS NOT NULL',
})
@Index('IDX_finance_categories_household_kind_active', [
  'householdId',
  'kind',
  'isActive',
  'sortOrder',
])
export class FinanceCategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_finance_categories_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 16 })
  kind: FinanceCategoryKind;

  @Column({ type: 'varchar', length: 64, nullable: true })
  systemKey: string | null;

  @Column({ type: 'varchar', length: 32, default: 'circle' })
  icon: string;

  @Column({ type: 'varchar', length: 7, default: '#26734D' })
  color: string;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 1 })
  version: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_finance_categories_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('finance_transactions')
@Check(
  'CHK_finance_transactions_type',
  `"type" IN ('expense', 'income', 'transfer', 'reversal')`,
)
@Check(
  'CHK_finance_transactions_source_type',
  `"sourceType" IN ('manual', 'agent', 'shopping_item', 'asset', 'media_subscription', 'finance_transaction')`,
)
@Check('CHK_finance_transactions_amount', `"amount" > 0`)
@Check('CHK_finance_transactions_currency', `"currency" = 'CNY'`)
@Check(
  'CHK_finance_transactions_category',
  `("type" IN ('expense', 'income') AND "categoryId" IS NOT NULL) OR ("type" IN ('transfer', 'reversal'))`,
)
@Check(
  'CHK_finance_transactions_reversal',
  `("type" = 'reversal' AND "reversalOfId" IS NOT NULL) OR ("type" <> 'reversal' AND "reversalOfId" IS NULL)`,
)
@Index(
  'UQ_finance_transactions_household_idempotency',
  ['householdId', 'idempotencyKey'],
  { unique: true },
)
@Index('UQ_finance_transactions_reversal', ['reversalOfId'], {
  unique: true,
  where: '"reversalOfId" IS NOT NULL',
})
@Index('IDX_finance_transactions_household_occurred', [
  'householdId',
  'occurredOn',
  'createdAt',
])
export class FinanceTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_finance_transactions_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 16 })
  type: FinanceTransactionType;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount: string;

  @Column({ type: 'varchar', length: 3, default: 'CNY' })
  currency: 'CNY';

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  @Column({ type: 'date' })
  occurredOn: string;

  @ManyToOne(() => FinanceCategory, { eager: true, nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'categoryId',
    foreignKeyConstraintName: 'FK_finance_transactions_category',
  })
  category: FinanceCategory | null;

  @Column({ type: 'uuid', nullable: true })
  categoryId: string | null;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'actorId',
    foreignKeyConstraintName: 'FK_finance_transactions_actor',
  })
  actor: Member;

  @Column('uuid')
  actorId: string;

  @Column({ type: 'varchar', length: 80 })
  actorName: string;

  @Column({ type: 'varchar', length: 32 })
  sourceType: FinanceTransactionSourceType;

  @Column({ type: 'varchar', length: 180 })
  sourceId: string;

  @Column({ type: 'varchar', length: 180 })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 64 })
  requestFingerprint: string;

  @ManyToOne(() => FinanceTransaction, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'reversalOfId',
    foreignKeyConstraintName: 'FK_finance_transactions_reversal_of',
  })
  reversalOf: FinanceTransaction | null;

  @Column({ type: 'uuid', nullable: true })
  reversalOfId: string | null;

  @OneToMany(() => FinancePosting, (posting) => posting.transaction, {
    eager: true,
  })
  postings: FinancePosting[];

  @CreateDateColumn({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt: Date;
}

@Entity('finance_postings')
@Check('CHK_finance_postings_delta', `"delta" <> 0`)
@Index('IDX_finance_postings_account_created', ['accountId', 'createdAt'])
@Index('IDX_finance_postings_household_transaction', [
  'householdId',
  'transactionId',
])
export class FinancePosting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_finance_postings_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => FinanceTransaction, (transaction) => transaction.postings, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'transactionId',
    foreignKeyConstraintName: 'FK_finance_postings_transaction',
  })
  transaction: FinanceTransaction;

  @Column('uuid')
  transactionId: string;

  @ManyToOne(() => FinanceAccount, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'accountId',
    foreignKeyConstraintName: 'FK_finance_postings_account',
  })
  account: FinanceAccount;

  @Column('uuid')
  accountId: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  delta: string;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt: Date;
}

@Entity('finance_budgets')
@Check('CHK_finance_budgets_amount', `"amount" >= 0`)
@Check('CHK_finance_budgets_month', `"month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`)
@Check('CHK_finance_budgets_version', `"version" >= 1`)
@Unique('UQ_finance_budgets_household_category_month', [
  'householdId',
  'categoryId',
  'month',
])
@Index('IDX_finance_budgets_household_month', ['householdId', 'month'])
export class FinanceBudget {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_finance_budgets_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => FinanceCategory, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'categoryId',
    foreignKeyConstraintName: 'FK_finance_budgets_category',
  })
  category: FinanceCategory;

  @Column('uuid')
  categoryId: string;

  @Column({ type: 'varchar', length: 7 })
  month: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount: string;

  @Column({ type: 'int', default: 1 })
  version: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'updatedById',
    foreignKeyConstraintName: 'FK_finance_budgets_updated_by',
  })
  updatedBy: Member;

  @Column('uuid')
  updatedById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('rewards')
@Check('CHK_rewards_cost', `"cost" >= 1 AND "cost" <= 1000000`)
@Unique('UQ_rewards_household_name', ['householdId', 'name'])
@Index('IDX_rewards_household_active', ['householdId', 'isActive', 'createdAt'])
export class Reward {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_rewards_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description: string | null;

  @Column({ type: 'int' })
  cost: number;

  @Column({ default: true })
  isActive: boolean;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_rewards_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('reward_redemptions')
@Check('CHK_reward_redemptions_cost', `"cost" >= 1`)
@Check(
  'CHK_reward_redemptions_status',
  `"status" IN ('pending', 'approved', 'rejected', 'cancelled', 'reversed')`,
)
@Index('UQ_reward_redemptions_household_request_key', ['householdId', 'requestIdempotencyKey'], { unique: true })
@Index('UQ_reward_redemptions_household_resolution_key', ['householdId', 'resolutionIdempotencyKey'], { unique: true, where: '"resolutionIdempotencyKey" IS NOT NULL' })
@Index('UQ_reward_redemptions_household_reversal_key', ['householdId', 'reversalIdempotencyKey'], { unique: true, where: '"reversalIdempotencyKey" IS NOT NULL' })
@Index('UQ_reward_redemptions_debit_ledger', ['debitLedgerId'], { unique: true })
@Index('UQ_reward_redemptions_restore_ledger', ['restoreLedgerId'], { unique: true, where: '"restoreLedgerId" IS NOT NULL' })
@Index('IDX_reward_redemptions_household_status', ['householdId', 'status', 'createdAt'])
@Index('IDX_reward_redemptions_member_created', ['memberId', 'createdAt'])
export class RewardRedemption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'householdId', foreignKeyConstraintName: 'FK_reward_redemptions_household' })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Reward, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'rewardId', foreignKeyConstraintName: 'FK_reward_redemptions_reward' })
  reward: Reward;

  @Column('uuid')
  rewardId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'memberId', foreignKeyConstraintName: 'FK_reward_redemptions_member' })
  member: Member;

  @Column('uuid')
  memberId: string;

  @Column({ type: 'varchar', length: 120 })
  rewardName: string;

  @Column({ type: 'int' })
  cost: number;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status: RewardRedemptionStatus;

  @Column({ type: 'varchar', length: 500, nullable: true })
  requestNote: string | null;

  @Column({ type: 'varchar', length: 180 })
  requestIdempotencyKey: string;

  @ManyToOne(() => PointsLedger, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'debitLedgerId', foreignKeyConstraintName: 'FK_reward_redemptions_debit' })
  debitLedger: PointsLedger;

  @Column('uuid')
  debitLedgerId: string;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'handledById', foreignKeyConstraintName: 'FK_reward_redemptions_handled_by' })
  handledBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  handledById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  handledAt: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  decisionNote: string | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  resolutionIdempotencyKey: string | null;

  @ManyToOne(() => PointsLedger, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'restoreLedgerId', foreignKeyConstraintName: 'FK_reward_redemptions_restore' })
  restoreLedger: PointsLedger | null;

  @Column({ type: 'uuid', nullable: true })
  restoreLedgerId: string | null;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'reversedById', foreignKeyConstraintName: 'FK_reward_redemptions_reversed_by' })
  reversedBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  reversedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reversedAt: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reversalNote: string | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  reversalIdempotencyKey: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('travel_plans')
@Check('CHK_travel_plans_dates', `"endDate" >= "startDate"`)
@Check(
  'CHK_travel_plans_status',
  `"status" IN ('planned', 'completed', 'cancelled')`,
)
@Check('CHK_travel_plans_version', `"version" >= 1`)
@Check(
  'CHK_travel_plans_completion',
  `("status" = 'completed' AND "completedAt" IS NOT NULL AND "completedById" IS NOT NULL) OR ("status" <> 'completed' AND "completedAt" IS NULL AND "completedById" IS NULL)`,
)
@Index('IDX_travel_plans_household_dates', [
  'householdId',
  'startDate',
  'endDate',
])
@Index('IDX_travel_plans_household_status', [
  'householdId',
  'archivedAt',
  'status',
  'startDate',
])
export class TravelPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_travel_plans_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  destination: string | null;

  @Column({ type: 'date' })
  startDate: string;

  @Column({ type: 'date' })
  endDate: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 16, default: 'planned' })
  status: TravelPlanStatus;

  @Column({ type: 'int', default: 1 })
  version: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_travel_plans_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'updatedById',
    foreignKeyConstraintName: 'FK_travel_plans_updated_by',
  })
  updatedBy: Member;

  @Column('uuid')
  updatedById: string;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'completedById',
    foreignKeyConstraintName: 'FK_travel_plans_completed_by',
  })
  completedBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  completedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @OneToMany(() => TravelChecklistItem, (item) => item.plan)
  items: TravelChecklistItem[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('travel_packing_templates')
@Check('CHK_travel_packing_templates_version', `"version" >= 1`)
@Index('IDX_travel_templates_household_active', [
  'householdId',
  'archivedAt',
  'updatedAt',
])
export class TravelPackingTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_travel_packing_templates_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_travel_packing_templates_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'updatedById',
    foreignKeyConstraintName: 'FK_travel_packing_templates_updated_by',
  })
  updatedBy: Member;

  @Column('uuid')
  updatedById: string;

  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @OneToMany(() => TravelPackingTemplateItem, (item) => item.template)
  items: TravelPackingTemplateItem[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('travel_packing_template_items')
@Check(
  'CHK_travel_template_items_category',
  `"category" IN ('documents', 'clothing', 'toiletries', 'electronics', 'supplies', 'other')`,
)
@Check('CHK_travel_template_items_quantity', `"quantity" BETWEEN 1 AND 99`)
@Check('CHK_travel_template_items_sort_order', `"sortOrder" >= 0`)
@Index('IDX_travel_template_items_template_order', [
  'templateId',
  'sortOrder',
  'createdAt',
])
export class TravelPackingTemplateItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_travel_template_items_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => TravelPackingTemplate, (template) => template.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'templateId',
    foreignKeyConstraintName: 'FK_travel_template_items_template',
  })
  template: TravelPackingTemplate;

  @Column('uuid')
  templateId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 24 })
  category: TravelChecklistCategory;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('travel_template_applications')
@Unique('UQ_travel_template_applications_plan_template', [
  'planId',
  'templateId',
])
@Check('CHK_travel_template_applications_version', `"templateVersion" >= 1`)
export class TravelTemplateApplication {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_travel_template_applications_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => TravelPlan, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'planId',
    foreignKeyConstraintName: 'FK_travel_template_applications_plan',
  })
  plan: TravelPlan;

  @Column('uuid')
  planId: string;

  @ManyToOne(() => TravelPackingTemplate, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'templateId',
    foreignKeyConstraintName: 'FK_travel_template_applications_template',
  })
  template: TravelPackingTemplate;

  @Column('uuid')
  templateId: string;

  @Column({ type: 'int' })
  templateVersion: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'appliedById',
    foreignKeyConstraintName: 'FK_travel_template_applications_applied_by',
  })
  appliedBy: Member;

  @Column('uuid')
  appliedById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('travel_checklist_items')
@Check(
  'CHK_travel_checklist_items_category',
  `"category" IN ('documents', 'clothing', 'toiletries', 'electronics', 'supplies', 'other')`,
)
@Check('CHK_travel_checklist_items_quantity', `"quantity" BETWEEN 1 AND 99`)
@Check('CHK_travel_checklist_items_sort_order', `"sortOrder" >= 0`)
@Check(
  'CHK_travel_checklist_items_status',
  `"status" IN ('pending', 'completed', 'skipped')`,
)
@Check('CHK_travel_checklist_items_version', `"version" >= 1`)
@Check(
  'CHK_travel_checklist_items_completion',
  `("status" = 'completed' AND "completedAt" IS NOT NULL AND "completedById" IS NOT NULL) OR ("status" <> 'completed' AND "completedAt" IS NULL AND "completedById" IS NULL)`,
)
@Index('IDX_travel_checklist_items_plan_status', [
  'planId',
  'archivedAt',
  'status',
  'sortOrder',
])
@Index('IDX_travel_checklist_items_assignee', [
  'householdId',
  'assignedMemberId',
  'status',
])
export class TravelChecklistItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_travel_checklist_items_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => TravelPlan, (plan) => plan.items, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'planId',
    foreignKeyConstraintName: 'FK_travel_checklist_items_plan',
  })
  plan: TravelPlan;

  @Column('uuid')
  planId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 24 })
  category: TravelChecklistCategory;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: TravelChecklistStatus;

  @Column({ type: 'int', default: 1 })
  version: number;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'assignedMemberId',
    foreignKeyConstraintName: 'FK_travel_checklist_items_assigned',
  })
  assignedMember: Member | null;

  @Column({ type: 'uuid', nullable: true })
  assignedMemberId: string | null;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'completedById',
    foreignKeyConstraintName: 'FK_travel_checklist_items_completed_by',
  })
  completedBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  completedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_travel_checklist_items_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'updatedById',
    foreignKeyConstraintName: 'FK_travel_checklist_items_updated_by',
  })
  updatedBy: Member;

  @Column('uuid')
  updatedById: string;

  @ManyToOne(() => TravelTemplateApplication, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'templateApplicationId',
    foreignKeyConstraintName: 'FK_travel_checklist_items_application',
  })
  templateApplication: TravelTemplateApplication | null;

  @Column({ type: 'uuid', nullable: true })
  templateApplicationId: string | null;

  @ManyToOne(() => TravelPackingTemplateItem, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'sourceTemplateItemId',
    foreignKeyConstraintName: 'FK_travel_checklist_items_source_template_item',
  })
  sourceTemplateItem: TravelPackingTemplateItem | null;

  @Column({ type: 'uuid', nullable: true })
  sourceTemplateItemId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('travel_operations')
@Unique('UQ_travel_operations_household_idempotency', [
  'householdId',
  'idempotencyKey',
])
@Check(
  'CHK_travel_operations_target_type',
  `"targetType" IN ('plan', 'item', 'template', 'application')`,
)
@Check('CHK_travel_operations_metadata', `jsonb_typeof("metadata") = 'object'`)
@Index('IDX_travel_operations_plan_created', ['planId', 'createdAt'])
export class TravelOperation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_travel_operations_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 40 })
  operation: string;

  @Column({ type: 'varchar', length: 20 })
  targetType: 'plan' | 'item' | 'template' | 'application';

  @Column('uuid')
  targetId: string;

  @Column({ type: 'uuid', nullable: true })
  planId: string | null;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'actorId',
    foreignKeyConstraintName: 'FK_travel_operations_actor',
  })
  actor: Member;

  @Column('uuid')
  actorId: string;

  @Column({ type: 'varchar', length: 64 })
  actorName: string;

  @Column({ type: 'varchar', length: 180 })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 64 })
  requestFingerprint: string;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt: Date;
}

@Entity('knowledge_articles')
@Check(
  'CHK_knowledge_articles_category',
  `"category" IN ('procedure', 'appliance', 'contact', 'home', 'other')`,
)
@Check('CHK_knowledge_articles_version', `"version" >= 1`)
@Check('CHK_knowledge_articles_tags', `jsonb_typeof("tags") = 'array'`)
@Index('IDX_knowledge_articles_household_active', [
  'householdId',
  'archivedAt',
  'isPinned',
  'updatedAt',
])
@Index('IDX_knowledge_articles_household_category', [
  'householdId',
  'category',
  'updatedAt',
])
export class KnowledgeArticle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_knowledge_articles_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 24 })
  category: KnowledgeArticleCategory;

  @Column({ type: 'varchar', length: 500, nullable: true })
  summary: string | null;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  referenceUrl: string | null;

  @Column({ type: 'jsonb', default: [] })
  tags: string[];

  @Column({ default: false })
  isPinned: boolean;

  @Column({ type: 'int', default: 1 })
  version: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_knowledge_articles_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'updatedById',
    foreignKeyConstraintName: 'FK_knowledge_articles_updated_by',
  })
  updatedBy: Member;

  @Column('uuid')
  updatedById: string;

  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('knowledge_article_revisions')
@Unique('UQ_knowledge_revisions_article_version', ['articleId', 'version'])
@Unique('UQ_knowledge_revisions_household_idempotency', [
  'householdId',
  'idempotencyKey',
])
@Check(
  'CHK_knowledge_revisions_change_type',
  `"changeType" IN ('create', 'update', 'archive', 'restore', 'restore_revision')`,
)
@Check(
  'CHK_knowledge_revisions_category',
  `"category" IN ('procedure', 'appliance', 'contact', 'home', 'other')`,
)
@Check('CHK_knowledge_revisions_version', `"version" >= 1`)
@Check('CHK_knowledge_revisions_tags', `jsonb_typeof("tags") = 'array'`)
@Index('IDX_knowledge_revisions_article_created', [
  'articleId',
  'createdAt',
])
export class KnowledgeArticleRevision {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_knowledge_revisions_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => KnowledgeArticle, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'articleId',
    foreignKeyConstraintName: 'FK_knowledge_revisions_article',
  })
  article: KnowledgeArticle;

  @Column('uuid')
  articleId: string;

  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'varchar', length: 24 })
  changeType: KnowledgeRevisionChangeType;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 24 })
  category: KnowledgeArticleCategory;

  @Column({ type: 'varchar', length: 500, nullable: true })
  summary: string | null;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  referenceUrl: string | null;

  @Column({ type: 'jsonb', default: [] })
  tags: string[];

  @Column({ default: false })
  isPinned: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'changedById',
    foreignKeyConstraintName: 'FK_knowledge_revisions_changed_by',
  })
  changedBy: Member;

  @Column('uuid')
  changedById: string;

  @Column({ type: 'varchar', length: 64 })
  changedByName: string;

  @Column({ type: 'varchar', length: 180 })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 64 })
  requestFingerprint: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('family_memories')
@Check(
  'CHK_family_memories_category',
  `"category" IN ('daily', 'celebration', 'travel', 'meal', 'visit', 'milestone', 'other')`,
)
@Check('CHK_family_memories_version', `"version" >= 1`)
@Check('CHK_family_memories_tags', `jsonb_typeof("tags") = 'array'`)
@Check(
  'CHK_family_memories_source',
  `("sourceModule" IS NULL AND "sourceId" IS NULL) OR ("sourceModule" IN ('calendar', 'travel', 'menu', 'media', 'visit') AND "sourceId" IS NOT NULL)`,
)
@Index('IDX_family_memories_household_date', [
  'householdId',
  'archivedAt',
  'happenedOn',
])
@Index('IDX_family_memories_household_category', [
  'householdId',
  'category',
  'happenedOn',
])
export class FamilyMemory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_family_memories_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'date' })
  happenedOn: string;

  @Column({ type: 'varchar', length: 24 })
  category: FamilyMemoryCategory;

  @Column({ type: 'text', nullable: true })
  story: string | null;

  @Column({ type: 'jsonb', default: [] })
  tags: string[];

  @Column({ type: 'varchar', length: 24, nullable: true })
  sourceModule: FamilyMemorySourceModule | null;

  @Column({ type: 'uuid', nullable: true })
  sourceId: string | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_family_memories_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'updatedById',
    foreignKeyConstraintName: 'FK_family_memories_updated_by',
  })
  updatedBy: Member;

  @Column('uuid')
  updatedById: string;

  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @OneToMany(() => FamilyMemoryPhoto, (photo) => photo.memory)
  photos: FamilyMemoryPhoto[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('family_memory_photos')
@Unique('UQ_family_memory_photos_household_idempotency', [
  'householdId',
  'idempotencyKey',
])
@Check('CHK_family_memory_photos_size', `"sizeBytes" BETWEEN 1 AND 10485760`)
@Index('IDX_family_memory_photos_memory_created', ['memoryId', 'createdAt'])
export class FamilyMemoryPhoto {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_family_memory_photos_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => FamilyMemory, (memory) => memory.photos, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'memoryId',
    foreignKeyConstraintName: 'FK_family_memory_photos_memory',
  })
  memory: FamilyMemory;

  @Column('uuid')
  memoryId: string;

  @Column({ type: 'varchar', length: 240, nullable: true })
  caption: string | null;

  @Column({ type: 'varchar', length: 180 })
  storageKey: string;

  @Column({ type: 'varchar', length: 64 })
  mimeType: string;

  @Column({ type: 'int' })
  sizeBytes: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_family_memory_photos_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @Column({ type: 'varchar', length: 180 })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 64 })
  requestFingerprint: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('family_memory_operations')
@Unique('UQ_family_memory_operations_household_idempotency', [
  'householdId',
  'idempotencyKey',
])
@Check(
  'CHK_family_memory_operations_type',
  `"operation" IN ('create', 'update', 'archive', 'restore')`,
)
@Check('CHK_family_memory_operations_version', `"resultVersion" >= 1`)
@Index('IDX_family_memory_operations_memory_created', [
  'memoryId',
  'createdAt',
])
export class FamilyMemoryOperation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_family_memory_operations_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => FamilyMemory, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'memoryId',
    foreignKeyConstraintName: 'FK_family_memory_operations_memory',
  })
  memory: FamilyMemory;

  @Column('uuid')
  memoryId: string;

  @Column({ type: 'varchar', length: 24 })
  operation: FamilyMemoryOperationType;

  @Column({ type: 'int' })
  resultVersion: number;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'actorId',
    foreignKeyConstraintName: 'FK_family_memory_operations_actor',
  })
  actor: Member;

  @Column('uuid')
  actorId: string;

  @Column({ type: 'varchar', length: 64 })
  actorName: string;

  @Column({ type: 'varchar', length: 180 })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 64 })
  requestFingerprint: string;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt: Date;
}

@Entity('backup_policies')
@Unique('UQ_backup_policies_household', ['householdId'])
@Check(
  'CHK_backup_policies_frequency',
  `"frequency" IN ('daily', 'weekly')`,
)
@Check(
  'CHK_backup_policies_schedule',
  `"scheduledHour" BETWEEN 0 AND 23 AND "scheduledMinute" BETWEEN 0 AND 59 AND ("weeklyDay" IS NULL OR "weeklyDay" BETWEEN 0 AND 6)`,
)
@Check(
  'CHK_backup_policies_retention',
  `"retentionDays" BETWEEN 1 AND 3650 AND "retentionCount" BETWEEN 1 AND 365`,
)
@Check(
  'CHK_backup_policies_capacity_thresholds',
  `"capacityWarningPercent" BETWEEN 1 AND 98 AND "capacityCriticalPercent" BETWEEN 2 AND 99 AND "capacityWarningPercent" < "capacityCriticalPercent"`,
)
@Check(
  'CHK_backup_policies_restore_schedule',
  `"restoreDrillDay" BETWEEN 1 AND 28 AND "restoreDrillHour" BETWEEN 0 AND 23`,
)
@Check(
  'CHK_backup_policies_capacity_status',
  `"capacityStatus" IN ('unknown', 'ok', 'warning', 'critical') AND ("capacityNotifiedStatus" IS NULL OR "capacityNotifiedStatus" IN ('warning', 'critical'))`,
)
export class BackupPolicy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_backup_policies_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ default: false })
  scheduleEnabled: boolean;

  @Column({ type: 'varchar', length: 16, default: 'daily' })
  frequency: BackupScheduleFrequency;

  @Column({ type: 'smallint', nullable: true })
  weeklyDay: number | null;

  @Column({ type: 'smallint', default: 3 })
  scheduledHour: number;

  @Column({ type: 'smallint', default: 0 })
  scheduledMinute: number;

  @Column({ type: 'int', default: 30 })
  retentionDays: number;

  @Column({ type: 'int', default: 14 })
  retentionCount: number;

  @Column({ type: 'smallint', default: 80 })
  capacityWarningPercent: number;

  @Column({ type: 'smallint', default: 90 })
  capacityCriticalPercent: number;

  @Column({ default: false })
  restoreDrillEnabled: boolean;

  @Column({ type: 'smallint', default: 1 })
  restoreDrillDay: number;

  @Column({ type: 'smallint', default: 4 })
  restoreDrillHour: number;

  @Column({ type: 'timestamptz', nullable: true })
  nextBackupAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  nextRestoreDrillAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastStorageCheckedAt: Date | null;

  @Column({ type: 'bigint', nullable: true })
  storageTotalBytes: string | null;

  @Column({ type: 'bigint', nullable: true })
  storageAvailableBytes: string | null;

  @Column({ type: 'bigint', nullable: true })
  storageUsedBytes: string | null;

  @Column({ type: 'varchar', length: 16, default: 'unknown' })
  capacityStatus: BackupCapacityStatus;

  @Column({ type: 'varchar', length: 16, nullable: true })
  capacityNotifiedStatus: Exclude<BackupCapacityStatus, 'unknown' | 'ok'> | null;

  @Column({ type: 'timestamptz', nullable: true })
  capacityAlertedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  workerLastSeenAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('backup_runs')
@Unique('UQ_backup_runs_household_idempotency', [
  'householdId',
  'idempotencyKey',
])
@Index('IDX_backup_runs_queue', ['status', 'createdAt'])
@Index('IDX_backup_runs_household_history', [
  'householdId',
  'createdAt',
])
@Check(
  'CHK_backup_runs_kind',
  `"kind" IN ('backup', 'restore_drill', 'capacity_check')`,
)
@Check(
  'CHK_backup_runs_status',
  `"status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')`,
)
@Check(
  'CHK_backup_runs_trigger',
  `"trigger" IN ('manual', 'scheduled')`,
)
@Check(
  'CHK_backup_runs_source',
  `("kind" = 'restore_drill' AND "sourceBackupRunId" IS NOT NULL) OR ("kind" <> 'restore_drill' AND "sourceBackupRunId" IS NULL)`,
)
@Check(
  'CHK_backup_runs_sizes',
  `("databaseBytes" IS NULL OR "databaseBytes" >= 0) AND ("uploadsBytes" IS NULL OR "uploadsBytes" >= 0) AND ("totalBytes" IS NULL OR "totalBytes" >= 0) AND ("restoredMigrationCount" IS NULL OR "restoredMigrationCount" >= 0) AND "retentionDeletedCount" >= 0`,
)
export class BackupRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_backup_runs_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'varchar', length: 24 })
  kind: BackupRunKind;

  @Column({ type: 'varchar', length: 16, default: 'queued' })
  status: BackupRunStatus;

  @Column({ type: 'varchar', length: 16 })
  trigger: BackupRunTrigger;

  @ManyToOne(() => BackupRun, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'sourceBackupRunId',
    foreignKeyConstraintName: 'FK_backup_runs_source',
  })
  sourceBackupRun: BackupRun | null;

  @Column({ type: 'uuid', nullable: true })
  sourceBackupRunId: string | null;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'requestedById',
    foreignKeyConstraintName: 'FK_backup_runs_requested_by',
  })
  requestedBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  requestedById: string | null;

  @Column({ type: 'varchar', length: 180 })
  idempotencyKey: string;

  @Column({ type: 'timestamptz', nullable: true })
  scheduledFor: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  heartbeatAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  notifiedAt: Date | null;

  @Column({ type: 'varchar', length: 120, nullable: true, select: false })
  backupLabel: string | null;

  @Column({ type: 'bigint', nullable: true })
  databaseBytes: string | null;

  @Column({ type: 'bigint', nullable: true })
  uploadsBytes: string | null;

  @Column({ type: 'bigint', nullable: true })
  totalBytes: string | null;

  @Column({ type: 'boolean', nullable: true })
  checksumVerified: boolean | null;

  @Column({ type: 'int', nullable: true })
  restoredMigrationCount: number | null;

  @Column({ type: 'int', default: 0 })
  retentionDeletedCount: number;

  @Column({ default: true })
  retained: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  purgedAt: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  errorCode: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  errorMessage: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  resultSummary: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('agent_member_channels')
@Check(
  'CHK_agent_member_channels_platform',
  `"platform" ~ '^[a-z0-9][a-z0-9._-]{1,31}$'`,
)
@Check('CHK_agent_member_channels_version', `"version" >= 1`)
@Index('UQ_agent_member_channels_active_external', [
  'householdId',
  'platform',
  'externalAccountRefHash',
], { unique: true, where: '"revokedAt" IS NULL' })
@Index('IDX_agent_member_channels_household_member', [
  'householdId',
  'memberId',
  'revokedAt',
])
export class AgentMemberChannel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_member_channels_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_agent_member_channels_member',
  })
  member: Member;

  @Column('uuid')
  memberId: string;

  @Column({ type: 'varchar', length: 32 })
  platform: AgentChannelPlatform;

  @Column({ type: 'varchar', length: 64 })
  externalAccountRefHash: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  externalAccountLabel: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  externalAccountHint: string | null;

  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  pairedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('agent_channel_pairings')
@Check(
  'CHK_agent_channel_pairings_platform',
  `"platform" ~ '^[a-z0-9][a-z0-9._-]{1,31}$'`,
)
@Check('CHK_agent_channel_pairings_version', `"version" >= 1`)
@Index('UQ_agent_channel_pairings_code', ['codeHash'], { unique: true })
@Index('UQ_agent_channel_pairings_household_idempotency', [
  'householdId',
  'idempotencyKey',
], { unique: true })
@Index('IDX_agent_channel_pairings_household_status', [
  'householdId',
  'memberId',
  'revokedAt',
  'usedAt',
  'expiresAt',
])
export class AgentChannelPairing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_channel_pairings_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_agent_channel_pairings_member',
  })
  member: Member;

  @Column('uuid')
  memberId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdByMemberId',
    foreignKeyConstraintName: 'FK_agent_channel_pairings_created_by',
  })
  createdByMember: Member;

  @Column('uuid')
  createdByMemberId: string;

  @Column({ type: 'varchar', length: 32 })
  platform: AgentChannelPlatform;

  @Column({ type: 'varchar', length: 64, select: false })
  codeHash: string;

  @Column({ type: 'varchar', length: 180 })
  idempotencyKey: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @ManyToOne(() => AgentMemberChannel, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'channelId',
    foreignKeyConstraintName: 'FK_agent_channel_pairings_channel',
  })
  channel: AgentMemberChannel | null;

  @Column({ type: 'uuid', nullable: true })
  channelId: string | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('agent_settings')
@Unique('UQ_agent_settings_household', ['householdId'])
@Check('CHK_agent_settings_runtime_kind', `"runtimeKind" IN ('fake', 'hermes')`)
@Check('CHK_agent_settings_retention_days', `"retentionDays" BETWEEN 1 AND 30`)
@Check(
  'CHK_agent_settings_daily_routine_notification_limit',
  `"dailyRoutineNotificationLimit" BETWEEN 0 AND 50`,
)
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

  @Column({
    type: 'jsonb',
    default: [
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
      'get_finance_summary',
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

@Entity('agent_conversations')
@Check(
  'CHK_agent_conversations_status',
  `"status" IN ('active', 'archived', 'expired')`,
)
@Check('CHK_agent_conversations_source', `"source" IN ('app', 'channel')`)
@Index('IDX_agent_conversations_household_member', [
  'householdId',
  'createdByMemberId',
  'updatedAt',
])
@Index('UQ_agent_conversations_channel_thread', [
  'householdId',
  'channelId',
  'externalThreadRefHash',
], { unique: true })
export class AgentConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_conversations_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdByMemberId',
    foreignKeyConstraintName: 'FK_agent_conversations_created_by',
  })
  createdByMember: Member;

  @Column('uuid')
  createdByMemberId: string;

  @ManyToOne(() => AgentMemberProfile, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'agentProfileId',
    foreignKeyConstraintName: 'FK_agent_conversations_profile',
  })
  agentProfile: AgentMemberProfile;

  @Column('uuid')
  agentProfileId: string;

  @Column({ type: 'varchar', length: 16, default: 'app' })
  source: AgentConversationSource;

  @ManyToOne(() => AgentMemberChannel, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'channelId',
    foreignKeyConstraintName: 'FK_agent_conversations_channel',
  })
  channel: AgentMemberChannel | null;

  @Column({ type: 'uuid', nullable: true })
  channelId: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  externalThreadRefHash: string | null;

  @Column({ type: 'varchar', length: 120, default: '新对话' })
  title: string;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: AgentConversationStatus;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('agent_messages')
@Check('CHK_agent_messages_role', `"role" IN ('user', 'assistant')`)
@Check('CHK_agent_messages_content_version', `"contentVersion" >= 1`)
@Index('IDX_agent_messages_conversation_created', ['conversationId', 'createdAt'])
@Index('IDX_agent_messages_run_created', ['runId', 'createdAt'])
export class AgentMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_messages_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => AgentConversation, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'conversationId',
    foreignKeyConstraintName: 'FK_agent_messages_conversation',
  })
  conversation: AgentConversation;

  @Column('uuid')
  conversationId: string;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'memberId',
    foreignKeyConstraintName: 'FK_agent_messages_member',
  })
  member: Member | null;

  @Column({ type: 'uuid', nullable: true })
  memberId: string | null;

  @ManyToOne(() => AgentRun, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'runId',
    foreignKeyConstraintName: 'FK_agent_messages_run',
  })
  run: AgentRun | null;

  @Column({ type: 'uuid', nullable: true })
  runId: string | null;

  @Column({ type: 'varchar', length: 16 })
  role: AgentMessageRole;

  @Column({ type: 'text' })
  contentCiphertext: string;

  @Column({ type: 'varchar', length: 32 })
  contentNonce: string;

  @Column({ type: 'int', default: 1 })
  contentVersion: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('agent_runs')
@Unique('UQ_agent_runs_household_idempotency', [
  'householdId',
  'clientRequestId',
])
@Check(
  'CHK_agent_runs_status',
  `"status" IN ('queued', 'running', 'completed', 'failed', 'cancelled')`,
)
@Check('CHK_agent_runs_runtime_kind', `"runtimeKind" IN ('fake', 'hermes')`)
@Check(
  'CHK_agent_runs_tokens',
  `("inputTokens" IS NULL OR "inputTokens" >= 0) AND ("outputTokens" IS NULL OR "outputTokens" >= 0)`,
)
@Index('IDX_agent_runs_conversation_created', ['conversationId', 'createdAt'])
@Index('IDX_agent_runs_authorization_expiry', ['authorizationExpiresAt'])
@Index('UQ_agent_runs_retry_of', ['retryOfRunId'], {
  unique: true,
  where: `"retryOfRunId" IS NOT NULL`,
})
export class AgentRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_runs_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => AgentConversation, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'conversationId',
    foreignKeyConstraintName: 'FK_agent_runs_conversation',
  })
  conversation: AgentConversation;

  @Column('uuid')
  conversationId: string;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'requestedByMemberId',
    foreignKeyConstraintName: 'FK_agent_runs_requested_by',
  })
  requestedByMember: Member;

  @Column('uuid')
  requestedByMemberId: string;

  @ManyToOne(() => AgentMemberProfile, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'agentProfileId',
    foreignKeyConstraintName: 'FK_agent_runs_profile',
  })
  agentProfile: AgentMemberProfile;

  @Column('uuid')
  agentProfileId: string;

  @Column({ type: 'varchar', length: 180 })
  clientRequestId: string;

  @ManyToOne(() => AgentRun, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'retryOfRunId',
    foreignKeyConstraintName: 'FK_agent_runs_retry_of',
  })
  retryOfRun: AgentRun | null;

  @Column({ type: 'uuid', nullable: true })
  retryOfRunId: string | null;

  @Column({ type: 'varchar', length: 16 })
  runtimeKind: AgentRuntimeKind;

  @Column({ type: 'varchar', length: 64 })
  runtimeVersion: string;

  @Column({ type: 'varchar', length: 120 })
  modelAlias: string;

  @Column({ type: 'varchar', length: 16, default: 'queued' })
  status: AgentRunStatus;

  @Column({ type: 'jsonb', default: [] })
  allowedTools: string[];

  @Column({ type: 'timestamptz' })
  authorizationExpiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelRequestedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  inputTokens: number | null;

  @Column({ type: 'int', nullable: true })
  outputTokens: number | null;

  @Column({ type: 'numeric', precision: 12, scale: 6, nullable: true })
  estimatedCost: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  errorCode: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('agent_tool_events')
@Check(
  'CHK_agent_tool_events_status',
  `"status" IN ('running', 'completed', 'failed')`,
)
@Check(
  'CHK_agent_tool_events_presentation',
  `("presentationCiphertext" IS NULL AND "presentationNonce" IS NULL AND "presentationVersion" IS NULL) OR ("presentationCiphertext" IS NOT NULL AND "presentationNonce" IS NOT NULL AND "presentationVersion" >= 1)`,
)
@Index('IDX_agent_tool_events_run_started', ['runId', 'startedAt'])
export class AgentToolEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_tool_events_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => AgentRun, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'runId',
    foreignKeyConstraintName: 'FK_agent_tool_events_run',
  })
  run: AgentRun;

  @Column('uuid')
  runId: string;

  @Column({ type: 'varchar', length: 80 })
  toolName: string;

  @Column({ type: 'varchar', length: 40 })
  sourceModule: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  sourceId: string | null;

  @Column({ type: 'varchar', length: 16 })
  status: AgentToolEventStatus;

  @Column({ type: 'jsonb', default: {} })
  inputSummary: Record<string, unknown>;

  @Column({ type: 'jsonb', default: {} })
  outputSummary: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  presentationCiphertext: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  presentationNonce: string | null;

  @Column({ type: 'int', nullable: true })
  presentationVersion: number | null;

  @Column({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}

@Entity('agent_memory_items')
@Check(
  'CHK_agent_memory_items_scope',
  `"scope" IN ('member_private', 'household')`,
)
@Check(
  'CHK_agent_memory_items_kind',
  `"kind" IN ('preference', 'fact', 'episodic_summary', 'routine_context')`,
)
@Check(
  'CHK_agent_memory_items_status',
  `"status" IN ('candidate', 'active', 'revoked', 'forgotten', 'expired')`,
)
@Check(
  'CHK_agent_memory_items_confidence_source',
  `"confidenceSource" IN ('explicit', 'business', 'summary_candidate')`,
)
@Check(
  'CHK_agent_memory_items_content',
  `("status" IN ('forgotten', 'expired') AND "contentCiphertext" IS NULL AND "contentNonce" IS NULL AND "contentVersion" IS NULL) OR ("status" NOT IN ('forgotten', 'expired') AND "contentCiphertext" IS NOT NULL AND "contentNonce" IS NOT NULL AND "contentVersion" IS NOT NULL AND "contentVersion" >= 1)`,
)
@Check('CHK_agent_memory_items_version', `"version" >= 1`)
@Index(
  'UQ_agent_memory_items_active_key',
  ['householdId', 'ownerMemberId', 'scope', 'memoryKey'],
  { unique: true, where: `"status" = 'active'` },
)
@Index('IDX_agent_memory_items_household_owner_status', [
  'householdId',
  'ownerMemberId',
  'scope',
  'status',
  'updatedAt',
])
export class AgentMemoryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_memory_items_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => Member, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'ownerMemberId',
    foreignKeyConstraintName: 'FK_agent_memory_items_owner',
  })
  ownerMember: Member;

  @Column('uuid')
  ownerMemberId: string;

  @Column({ type: 'varchar', length: 16, default: 'member_private' })
  scope: AgentMemoryScope;

  @Column({ type: 'varchar', length: 24, default: 'preference' })
  kind: AgentMemoryKind;

  @Column({ type: 'varchar', length: 32 })
  category: string;

  @Column({ type: 'varchar', length: 32 })
  memoryKey: string;

  @Column({ type: 'text', nullable: true })
  contentCiphertext: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  contentNonce: string | null;

  @Column({ type: 'int', nullable: true })
  contentVersion: number | null;

  @Column({ type: 'varchar', length: 32 })
  sourceType: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  sourceId: string | null;

  @ManyToOne(() => AgentConversation, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'sourceConversationId',
    foreignKeyConstraintName: 'FK_agent_memory_items_source_conversation',
  })
  sourceConversation: AgentConversation | null;

  @Column({ type: 'uuid', nullable: true })
  sourceConversationId: string | null;

  @Column({ type: 'uuid', nullable: true })
  sourceMessageId: string | null;

  @Column({ type: 'varchar', length: 16, default: 'candidate' })
  status: AgentMemoryStatus;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'confirmedByMemberId',
    foreignKeyConstraintName: 'FK_agent_memory_items_confirmed_by',
  })
  confirmedByMember: Member | null;

  @Column({ type: 'uuid', nullable: true })
  confirmedByMemberId: string | null;

  @Column({ type: 'varchar', length: 24, default: 'summary_candidate' })
  confidenceSource: AgentMemoryConfidenceSource;

  @Column({ type: 'timestamptz', nullable: true })
  validFrom: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('agent_memory_events')
@Check(
  'CHK_agent_memory_events_operation',
  `"operation" IN ('created', 'confirmed', 'corrected', 'shared', 'revoked', 'forgotten', 'expired')`,
)
@Index('IDX_agent_memory_events_item_created', ['memoryItemId', 'createdAt'])
export class AgentMemoryEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_memory_events_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => AgentMemoryItem, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'memoryItemId',
    foreignKeyConstraintName: 'FK_agent_memory_events_item',
  })
  memoryItem: AgentMemoryItem;

  @Column('uuid')
  memoryItemId: string;

  @ManyToOne(() => Member, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'actorMemberId',
    foreignKeyConstraintName: 'FK_agent_memory_events_actor',
  })
  actorMember: Member;

  @Column('uuid')
  actorMemberId: string;

  @Column({ type: 'varchar', length: 16 })
  operation: AgentMemoryEventOperation;

  @Column({ type: 'varchar', length: 16, nullable: true })
  fromScope: AgentMemoryScope | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  toScope: AgentMemoryScope | null;

  @Column({ type: 'varchar', length: 32 })
  sourceType: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  sourceId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('agent_proposal_groups')
@Check(
  'CHK_agent_proposal_groups_status',
  `"status" IN ('pending', 'confirmed', 'rejected', 'expired', 'failed')`,
)
@Check('CHK_agent_proposal_groups_version', `"version" >= 1`)
@Index('IDX_agent_proposal_groups_household_status_created', [
  'householdId',
  'status',
  'createdAt',
])
export class AgentProposalGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_proposal_groups_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => AgentConversation, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'conversationId',
    foreignKeyConstraintName: 'FK_agent_proposal_groups_conversation',
  })
  conversation: AgentConversation | null;

  @Column({ type: 'uuid', nullable: true })
  conversationId: string | null;

  @ManyToOne(() => AgentRun, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'runId',
    foreignKeyConstraintName: 'FK_agent_proposal_groups_run',
  })
  run: AgentRun;

  @Column('uuid')
  runId: string;

  @ManyToOne(() => Member, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'requestedByMemberId',
    foreignKeyConstraintName: 'FK_agent_proposal_groups_requested_by',
  })
  requestedByMember: Member;

  @Column('uuid')
  requestedByMemberId: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 400 })
  summary: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: AgentProposalGroupStatus;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'confirmedByMemberId',
    foreignKeyConstraintName: 'FK_agent_proposal_groups_confirmed_by',
  })
  confirmedByMember: Member | null;

  @Column({ type: 'uuid', nullable: true })
  confirmedByMemberId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  rejectedAt: Date | null;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('agent_proposal_group_events')
@Check(
  'CHK_agent_proposal_group_events_operation',
  `"operation" IN ('created', 'confirmed', 'rejected', 'expired', 'failed')`,
)
@Index('IDX_agent_proposal_group_events_group_created', ['groupId', 'createdAt'])
export class AgentProposalGroupEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_proposal_group_events_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => AgentProposalGroup, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'groupId',
    foreignKeyConstraintName: 'FK_agent_proposal_group_events_group',
  })
  group: AgentProposalGroup;

  @Column('uuid')
  groupId: string;

  @ManyToOne(() => Member, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'actorMemberId',
    foreignKeyConstraintName: 'FK_agent_proposal_group_events_actor',
  })
  actorMember: Member;

  @Column('uuid')
  actorMemberId: string;

  @Column({ type: 'varchar', length: 16 })
  operation: AgentProposalGroupEventOperation;

  @Column({ type: 'int' })
  stepCount: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('agent_action_proposals')
@Unique('UQ_agent_action_proposals_creation', ['householdId', 'idempotencyKey'])
@Unique('UQ_agent_action_proposals_confirmation', [
  'householdId',
  'confirmationKey',
])
@Check(
  'CHK_agent_action_proposals_type',
  `"actionType" IN ('task', 'reminder', 'poll', 'menu', 'shopping')`,
)
@Check(
  'CHK_agent_action_proposals_status',
  `"status" IN ('pending', 'confirmed', 'executed', 'rejected', 'expired', 'failed')`,
)
@Check('CHK_agent_action_proposals_version', `"version" >= 1`)
@Index('IDX_agent_action_proposals_member_status', [
  'householdId',
  'createdByMemberId',
  'status',
  'createdAt',
])
@Index('IDX_agent_action_proposals_run_created', ['runId', 'createdAt'])
export class AgentActionProposal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_agent_action_proposals_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => AgentRun, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'runId',
    foreignKeyConstraintName: 'FK_agent_action_proposals_run',
  })
  run: AgentRun;

  @Column('uuid')
  runId: string;

  @ManyToOne(() => Member, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdByMemberId',
    foreignKeyConstraintName: 'FK_agent_action_proposals_created_by',
  })
  createdByMember: Member;

  @Column('uuid')
  createdByMemberId: string;

  @ManyToOne(() => AgentProposalGroup, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'groupId',
    foreignKeyConstraintName: 'FK_agent_action_proposals_group',
  })
  group: AgentProposalGroup | null;

  @Column({ type: 'uuid', nullable: true })
  groupId: string | null;

  @Column({ type: 'int', nullable: true })
  stepOrder: number | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'confirmedByMemberId',
    foreignKeyConstraintName: 'FK_agent_action_proposals_confirmed_by',
  })
  confirmedByMember: Member | null;

  @Column({ type: 'uuid', nullable: true })
  confirmedByMemberId: string | null;

  @Column({ type: 'varchar', length: 24 })
  actionType: AgentActionType;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  preview: Record<string, unknown>;

  @Column({ type: 'varchar', length: 64 })
  requestFingerprint: string;

  @Column({ type: 'varchar', length: 180 })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 180, nullable: true })
  confirmationKey: string | null;

  @Column({ type: 'int', nullable: true })
  expectedSourceVersion: number | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: AgentActionProposalStatus;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  executedAt: Date | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  resultModule: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  resultId: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  failureCode: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  failureMessage: string | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('smart_menu_plans')
@Check(
  'CHK_smart_menu_plans_status',
  `"status" IN ('draft', 'voting', 'adopted')`,
)
@Check('CHK_smart_menu_plans_dates', `"endsOn" >= "startsOn"`)
@Check(
  'CHK_smart_menu_plans_adopted',
  `("status" = 'adopted' AND "adoptedById" IS NOT NULL AND "adoptedAt" IS NOT NULL) OR ("status" <> 'adopted' AND "adoptedById" IS NULL AND "adoptedAt" IS NULL)`,
)
@Index(
  'UQ_smart_menu_plans_household_idempotency',
  ['householdId', 'idempotencyKey'],
  { unique: true },
)
@Index('UQ_smart_menu_plans_poll', ['pollId'], {
  unique: true,
  where: '"pollId" IS NOT NULL',
})
@Index('IDX_smart_menu_plans_household_created', [
  'householdId',
  'createdAt',
])
export class SmartMenuPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_smart_menu_plans_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @Column({ type: 'date' })
  startsOn: string;

  @Column({ type: 'date' })
  endsOn: string;

  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: SmartMenuPlanStatus;

  @ManyToOne(() => Poll, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'pollId',
    foreignKeyConstraintName: 'FK_smart_menu_plans_poll',
  })
  poll: Poll | null;

  @Column({ type: 'uuid', nullable: true })
  pollId: string | null;

  @ManyToOne(() => Member, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'createdById',
    foreignKeyConstraintName: 'FK_smart_menu_plans_created_by',
  })
  createdBy: Member;

  @Column('uuid')
  createdById: string;

  @Column({ type: 'varchar', length: 180 })
  idempotencyKey: string;

  @ManyToOne(() => Member, { eager: true, nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'adoptedById',
    foreignKeyConstraintName: 'FK_smart_menu_plans_adopted_by',
  })
  adoptedBy: Member | null;

  @Column({ type: 'uuid', nullable: true })
  adoptedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  adoptedAt: Date | null;

  @OneToMany(() => SmartMenuCandidate, (candidate) => candidate.plan)
  candidates: SmartMenuCandidate[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('smart_menu_candidates')
@Check(
  'CHK_smart_menu_candidates_meal',
  `"mealType" IN ('breakfast', 'lunch', 'dinner')`,
)
@Check(
  'CHK_smart_menu_candidates_order',
  `"sortOrder" >= 0 AND "sortOrder" < 12`,
)
@Index('UQ_smart_menu_candidates_plan_order', ['planId', 'sortOrder'], {
  unique: true,
})
@Index('UQ_smart_menu_candidates_plan_dish', ['planId', 'dishId'], {
  unique: true,
})
@Index('UQ_smart_menu_candidates_poll_option', ['pollOptionId'], {
  unique: true,
  where: '"pollOptionId" IS NOT NULL',
})
@Index('IDX_smart_menu_candidates_household_plan', [
  'householdId',
  'planId',
  'sortOrder',
])
export class SmartMenuCandidate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Household, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'householdId',
    foreignKeyConstraintName: 'FK_smart_menu_candidates_household',
  })
  household: Household;

  @Column('uuid')
  householdId: string;

  @ManyToOne(() => SmartMenuPlan, (plan) => plan.candidates, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'planId',
    foreignKeyConstraintName: 'FK_smart_menu_candidates_plan',
  })
  plan: SmartMenuPlan;

  @Column('uuid')
  planId: string;

  @ManyToOne(() => Dish, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'dishId',
    foreignKeyConstraintName: 'FK_smart_menu_candidates_dish',
  })
  dish: Dish;

  @Column('uuid')
  dishId: string;

  @ManyToOne(() => DishRecipeVariant, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'recipeVariantId',
    foreignKeyConstraintName: 'FK_smart_menu_candidates_variant',
  })
  recipeVariant: DishRecipeVariant;

  @Column('uuid')
  recipeVariantId: string;

  @Column({ type: 'date' })
  targetDate: string;

  @Column({ type: 'varchar', length: 16, default: 'dinner' })
  mealType: MealType;

  @Column({ type: 'int' })
  score: number;

  @Column({ type: 'jsonb', default: [] })
  reasons: string[];

  @Column({ type: 'jsonb', default: [] })
  expiringIngredients: {
    ingredientId: string;
    name: string;
    expiresOn: string;
    daysRemaining: number;
  }[];

  @ManyToOne(() => PollOption, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'pollOptionId',
    foreignKeyConstraintName: 'FK_smart_menu_candidates_poll_option',
  })
  pollOption: PollOption | null;

  @Column({ type: 'uuid', nullable: true })
  pollOptionId: string | null;

  @ManyToOne(() => Menu, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'adoptedMenuId',
    foreignKeyConstraintName: 'FK_smart_menu_candidates_adopted_menu',
  })
  adoptedMenu: Menu | null;

  @Column({ type: 'uuid', nullable: true })
  adoptedMenuId: string | null;

  @Column({ type: 'int' })
  sortOrder: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

export const ALL_ENTITIES = [
  Account,
  Household,
  Member,
  HouseholdActivityLog,
  AuthSession,
  HouseholdInvitation,
  Ingredient,
  Dish,
  DishIngredient,
  DishRecipeVariant,
  DishRecipeVariantStep,
  DishRecipeVariantLink,
  DishRecipeVariantIngredient,
  MemberDishSkill,
  Menu,
  MenuItem,
  MenuEvent,
  CalendarEvent,
  Guest,
  Visit,
  VisitGuest,
  GuestInvitation,
  GuestWifiProfile,
  HouseholdTask,
  HouseholdTaskInstance,
  Notification,
  NotificationChannel,
  MemberNotificationPreference,
  NotificationDelivery,
  NotificationDeliveryAttempt,
  Poll,
  PollOption,
  PollVote,
  GuestPollVote,
  GuestMealRequest,
  MediaTitle,
  MediaExternalRef,
  HouseholdMediaSourceConfig,
  Integration,
  IntegrationSecret,
  IntegrationEvent,
  MediaUserMapping,
  MediaLibraryItem,
  ViewingSession,
  ViewingParticipant,
  ViewingProgress,
  HouseholdMedia,
  MediaRequest,
  Reminder,
  ReminderRecipient,
  HomeAsset,
  AssetDocument,
  MaintenancePlan,
  MaintenanceRecord,
  ShoppingItem,
  InventoryItem,
  InventoryBatch,
  MaintenanceConsumable,
  InventoryTransaction,
  InventoryBatchMovement,
  PointsAccount,
  PointsLedger,
  FinanceAccount,
  FinanceCategory,
  FinanceTransaction,
  FinancePosting,
  FinanceBudget,
  Reward,
  RewardRedemption,
  TravelPlan,
  TravelChecklistItem,
  TravelPackingTemplate,
  TravelPackingTemplateItem,
  TravelTemplateApplication,
  TravelOperation,
  KnowledgeArticle,
  KnowledgeArticleRevision,
  FamilyMemory,
  FamilyMemoryPhoto,
  FamilyMemoryOperation,
  BackupPolicy,
  BackupRun,
  AgentSetting,
  AgentRoutine,
  AgentRoutineItem,
  AgentMemberProfile,
  AgentMemberChannel,
  AgentChannelPairing,
  AgentConversation,
  AgentMessage,
  AgentRun,
  AgentToolEvent,
  AgentMemoryItem,
  AgentMemoryEvent,
  AgentProposalGroup,
  AgentProposalGroupEvent,
  AgentActionProposal,
  SmartMenuPlan,
  SmartMenuCandidate,
];
