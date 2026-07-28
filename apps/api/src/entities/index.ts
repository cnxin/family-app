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

export type MemberRole = 'chef' | 'member';
export type DishCategory = '荤菜' | '素菜' | '汤' | '主食' | '甜品';
export type IngredientCategory = '蔬菜' | '肉类' | '海鲜' | '蛋奶' | '调料' | '主食' | '其他';
export type MealType = 'breakfast' | 'lunch' | 'dinner';
export type MenuItemStatus = 'pending' | 'accepted' | 'cooking' | 'done' | 'rejected';
export type InventoryCategory = '调料' | '主食' | '饮料' | '零食' | '日用品' | '其他';

export interface DishRecipeStep {
  text: string;
  imageUrl?: string | null;
}

export interface DishReferenceLink {
  title?: string;
  url: string;
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
@Index('IDX_members_household', ['householdId'])
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

  @Column()
  name: string;

  @Column({ default: '🙂' })
  avatarEmoji: string;

  @Column({ type: 'varchar', default: 'member' })
  role: MemberRole;

  @Column({ type: 'varchar', nullable: true })
  pinHash: string | null;

  @CreateDateColumn()
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

@Entity('menus')
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

  @OneToMany(() => MenuItem, (mi) => mi.menu)
  items: MenuItem[];
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

  @CreateDateColumn()
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
  Household,
  Member,
  Ingredient,
  Dish,
  DishIngredient,
  Menu,
  MenuItem,
  ShoppingItem,
  InventoryItem,
];
