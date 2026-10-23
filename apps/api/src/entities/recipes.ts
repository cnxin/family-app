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

export type DishCategory = '荤菜' | '素菜' | '汤' | '主食' | '甜品';

export type IngredientCategory = '蔬菜' | '肉类' | '海鲜' | '蛋奶' | '调料' | '主食' | '其他';

export type DishSkillLevel = 'learning' | 'can_cook' | 'signature';

export interface DishRecipeStep {
  text: string;
  imageUrl?: string | null;
}

export interface DishReferenceLink {
  title?: string;
  url: string;
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
