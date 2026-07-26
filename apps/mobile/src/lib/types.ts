export type MemberRole = 'chef' | 'member';
export type MealType = 'lunch' | 'dinner';
export type MenuItemStatus = 'pending' | 'accepted' | 'cooking' | 'done' | 'rejected';
export type DishCategory = '荤菜' | '素菜' | '汤' | '主食' | '甜品';

export interface Member {
  id: string;
  name: string;
  avatarEmoji: string;
  role: MemberRole;
  hasPin?: boolean;
}

export interface Ingredient {
  id: string;
  name: string;
  category: string;
  defaultUnit: string;
  isPantryStaple: boolean;
}

export interface DishIngredient {
  id: string;
  ingredientId: string;
  ingredient: Ingredient;
  quantity: string;
  unit: string;
}

export interface Dish {
  id: string;
  name: string;
  photoUrl: string | null;
  category: DishCategory;
  difficulty: number;
  estMinutes: number | null;
  note: string | null;
  ingredients: DishIngredient[];
}

export interface MenuItem {
  id: string;
  dishId: string;
  dish: Dish;
  requestedBy: Member;
  note: string | null;
  status: MenuItemStatus;
}

export interface Menu {
  id: string;
  date: string;
  mealType: MealType;
  status: 'open' | 'done';
  items: MenuItem[];
}

export interface ShoppingItem {
  id: string;
  date: string;
  ingredient: Ingredient | null;
  customName: string | null;
  totalQty: string | null;
  unit: string | null;
  checked: boolean;
  source: 'auto' | 'manual';
}
