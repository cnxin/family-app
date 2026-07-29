import { DishRecipeSnapshot, DishRecipeVariant } from '../entities';

export function buildRecipeSnapshot(
  variant: DishRecipeVariant,
): DishRecipeSnapshot {
  return {
    variantId: variant.id,
    name: variant.name,
    authorMemberId: variant.authorMemberId,
    authorName: variant.author?.name ?? null,
    note: variant.note,
    estMinutes: variant.estMinutes,
    ingredients: [...(variant.ingredients ?? [])]
      .sort((left, right) =>
        left.ingredient.name.localeCompare(right.ingredient.name, 'zh'),
      )
      .map((item) => ({
        ingredientId: item.ingredientId,
        name: item.ingredient.name,
        category: item.ingredient.category,
        isPantryStaple: item.ingredient.isPantryStaple,
        quantity: Number(item.quantity),
        unit: item.unit,
      })),
    steps: [...(variant.steps ?? [])]
      .sort((left, right) => left.position - right.position)
      .map((step) => ({ text: step.text, imageUrl: step.imageUrl })),
    referenceLinks: [...(variant.referenceLinks ?? [])]
      .sort((left, right) => left.position - right.position)
      .map((link) => ({
        title: link.title ?? undefined,
        url: link.url,
      })),
  };
}
