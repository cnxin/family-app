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
export type InventoryCategory = '调料' | '主食' | '饮料' | '零食' | '日用品' | '其他';
export type InventoryTransactionType =
  | 'receipt'
  | 'consumption'
  | 'adjustment'
  | 'reversal';
export type InventoryTransactionSourceType =
  | 'shopping_item'
  | 'menu'
  | 'inventory_item'
  | 'manual_adjustment'
  | 'inventory_transaction';
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
  | 'maintenance';
export type ReminderStatus = 'scheduled' | 'sent' | 'cancelled';
export type AssetCategory =
  | 'appliance'
  | 'furniture'
  | 'electronics'
  | 'tool'
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
  | 'system';
export type NotificationModule =
  | 'menu'
  | 'task'
  | 'poll'
  | 'calendar'
  | 'reminder'
  | 'media'
  | 'guest'
  | 'system';

export interface DishRecipeStep {
  text: string;
  imageUrl?: string | null;
}

export interface DishReferenceLink {
  title?: string;
  url: string;
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
  `"module" IN ('member', 'invitation', 'menu', 'calendar', 'task', 'poll', 'reminder', 'shopping', 'inventory', 'recipe', 'media', 'guest', 'asset', 'system')`,
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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('notifications')
@Check(
  'CHK_notifications_module',
  `"module" IN ('menu', 'task', 'poll', 'calendar', 'reminder', 'media', 'system')`,
)
@Index('IDX_notifications_recipient_read', ['recipientId', 'readAt', 'createdAt'])
@Index('IDX_notifications_household_source', ['householdId', 'module', 'sourceId'])
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
  `"sourceModule" IN ('menu', 'task', 'calendar', 'poll', 'maintenance')`,
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
  `"category" IN ('appliance', 'furniture', 'electronics', 'tool', 'other')`,
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

  @CreateDateColumn({ type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt: Date;
}

@Entity('shopping_items')
@Index('IDX_shopping_household_date', ['householdId', 'date'])
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
  source: 'auto' | 'manual';
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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('inventory_transactions')
@Check(
  'CHK_inventory_transactions_type',
  `"type" IN ('receipt', 'consumption', 'adjustment', 'reversal')`,
)
@Check(
  'CHK_inventory_transactions_source_type',
  `"sourceType" IN ('shopping_item', 'menu', 'inventory_item', 'manual_adjustment', 'inventory_transaction')`,
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

  @CreateDateColumn({ type: 'timestamptz', default: () => 'clock_timestamp()' })
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
  InventoryTransaction,
];
