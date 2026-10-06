// J1b：从 apps/api/src/recipes/recipe.snapshot.ts 搬来的纯函数（原样），点菜给菜单项拍做法快照时用，
// 不再跨插件 import 菜谱目录。入参只要求结构对得上（DishRecipeVariant 实体带上关系即可）。

export interface RecipeVariantSource<Category extends string = string> {
  id: string;
  name: string;
  authorMemberId: string | null;
  author?: { name: string } | null;
  note: string | null;
  estMinutes: number | null;
  ingredients?: readonly {
    ingredientId: string;
    quantity: string | number;
    unit: string;
    ingredient: { name: string; category: Category; isPantryStaple: boolean };
  }[] | null;
  steps?: readonly { position: number; text: string; imageUrl?: string | null }[] | null;
  referenceLinks?: readonly { position: number; title?: string | null; url: string }[] | null;
}

export interface RecipeSnapshot<Category extends string = string> {
  variantId: string;
  name: string;
  authorMemberId: string | null;
  authorName: string | null;
  note: string | null;
  estMinutes: number | null;
  ingredients: {
    ingredientId: string;
    name: string;
    category: Category;
    isPantryStaple: boolean;
    quantity: number;
    unit: string;
  }[];
  steps: { text: string; imageUrl?: string | null }[];
  referenceLinks: { title?: string; url: string }[];
}

export function buildRecipeSnapshot<Category extends string>(
  variant: RecipeVariantSource<Category>,
): RecipeSnapshot<Category> {
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
