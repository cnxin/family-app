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
import { Household, Member } from './household';
import { Poll, PollOption } from './polls';
import {
  IngredientCategory,
  DishRecipeStep,
  DishReferenceLink,
  Dish,
  DishRecipeVariant,
} from './recipes';

export type MealType = 'breakfast' | 'lunch' | 'dinner';

export type MenuItemStatus = 'pending' | 'accepted' | 'cooking' | 'done' | 'rejected';

export type MenuEventType =
  | 'item_ordered'
  | 'item_status_changed'
  | 'item_assigned'
  | 'item_note_changed'
  | 'meal_chef_assigned'
  | 'menu_completed';

export type SmartMenuPlanStatus = 'draft' | 'voting' | 'adopted';

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
