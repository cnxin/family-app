import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import {
  Dish,
  DishIngredient,
  DishRecipeVariant,
  Ingredient,
  Member,
  MemberDishSkill,
} from '../entities';
import { VariantIngredientDto } from './recipes.dto';

export function isHouseholdAdmin(user: JwtUser) {
  return user.role === 'owner' || user.role === 'admin';
}

export function presentVariant(variant: DishRecipeVariant, user: JwtUser) {
  variant.steps?.sort((left, right) => left.position - right.position);
  variant.referenceLinks?.sort(
    (left, right) => left.position - right.position,
  );
  variant.ingredients?.sort((left, right) =>
    left.ingredient.name.localeCompare(right.ingredient.name, 'zh'),
  );
  return {
    ...variant,
    canManage:
      isHouseholdAdmin(user) ||
      (!variant.isDefault && variant.authorMemberId === user.memberId),
  };
}

export function assertVariantManageable(variant: DishRecipeVariant, user: JwtUser) {
  if (isHouseholdAdmin(user)) return;
  if (variant.isDefault) {
    throw new ForbiddenException('只有家庭管理员可以维护默认做法');
  }
  if (variant.authorMemberId !== user.memberId) {
    throw new ForbiddenException('只能维护自己的做法');
  }
}

export async function assertMember(
  memberId: string,
  user: JwtUser,
  manager: EntityManager,
) {
  const member = await manager.getRepository(Member).findOneBy({
    id: memberId,
    householdId: user.householdId,
  });
  if (!member) throw new NotFoundException('家庭成员不存在');
}

export async function resolveIngredient(
  dto: VariantIngredientDto,
  householdId: string,
  manager: EntityManager,
) {
  const ingredients = manager.getRepository(Ingredient);
  if (dto.ingredientId) {
    const ingredient = await ingredients.findOneBy({
      id: dto.ingredientId,
      householdId,
    });
    if (!ingredient) throw new NotFoundException('食材不存在');
    return ingredient;
  }
  const name = dto.name?.trim();
  if (!name) throw new BadRequestException('食材名称不能为空');
  const existing = await ingredients.findOneBy({ householdId, name });
  if (existing) return existing;
  return ingredients.save(
    ingredients.create({
      householdId,
      name,
      category: (dto.category as Ingredient['category']) || '其他',
      defaultUnit: dto.unit.trim() || '份',
    }),
  );
}

export async function ensureAuthorSkill(
  variant: DishRecipeVariant,
  manager: EntityManager,
) {
  if (!variant.authorMemberId) return;
  const skills = manager.getRepository(MemberDishSkill);
  let skill = await skills.findOneBy({
    householdId: variant.householdId,
    memberId: variant.authorMemberId,
    dishId: variant.dishId,
  });
  if (!skill) {
    skill = skills.create({
      householdId: variant.householdId,
      memberId: variant.authorMemberId,
      dishId: variant.dishId,
      level: 'can_cook',
    });
  }
  if (!skill.preferredRecipeId) skill.preferredRecipeId = variant.id;
  await skills.save(skill);
}

export async function syncLegacyDefault(
  variant: DishRecipeVariant,
  manager: EntityManager,
) {
  const loaded = await manager.getRepository(DishRecipeVariant).findOne({
    where: { id: variant.id },
  });
  if (!loaded) throw new NotFoundException('做法不存在');
  const dishes = manager.getRepository(Dish);
  const dishIngredients = manager.getRepository(DishIngredient);
  const dish = await dishes.findOneBy({
    id: loaded.dishId,
    householdId: loaded.householdId,
  });
  if (!dish) throw new NotFoundException('菜品不存在');
  dish.note = loaded.note;
  dish.estMinutes = loaded.estMinutes;
  dish.recipeSteps = [...(loaded.steps ?? [])]
    .sort((left, right) => left.position - right.position)
    .map((step) => ({ text: step.text, imageUrl: step.imageUrl }));
  dish.referenceLinks = [...(loaded.referenceLinks ?? [])]
    .sort((left, right) => left.position - right.position)
    .map((link) => ({ title: link.title ?? undefined, url: link.url }));
  await dishes.save(dish);
  await dishIngredients.delete({ dishId: dish.id });
  await dishIngredients.save(
    (loaded.ingredients ?? []).map((item) =>
      dishIngredients.create({
        dishId: dish.id,
        ingredientId: item.ingredientId,
        quantity: item.quantity,
        unit: item.unit,
      }),
    ),
  );
}
