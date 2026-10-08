// 菜谱门面（J4.1）：实现在 apps/api/src/recipes/recipes.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：小管家（search_recipes 在内存里按关键词、食材、分类匹配）。

/** 一道在用的菜：菜本身的食材名，加上每个没归档的做法和它的食材名（顺序同数据库读出的顺序）。 */
export interface RecipeCatalogEntry {
  id: string;
  name: string;
  category: string;
  estMinutes: number | null;
  difficulty: number;
  ingredientNames: string[];
  variants: { id: string; name: string; isDefault: boolean; estMinutes: number | null; ingredientNames: string[] }[];
}

export interface RecipesFacade {
  /** 这个家庭在用的菜，新建的在前。 */
  listCatalog(householdId: string): Promise<RecipeCatalogEntry[]>;
}
