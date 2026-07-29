import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
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
export type DishSkillLevel = 'learning' | 'can_cook' | 'signature';

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

  @CreateDateColumn()
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

export const ALL_ENTITIES = [
  Account,
  Household,
  Member,
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
  ShoppingItem,
  InventoryItem,
];
