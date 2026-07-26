import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import {
  ALL_ENTITIES,
  Dish,
  DishCategory,
  DishIngredient,
  Ingredient,
  IngredientCategory,
  Member,
} from './entities';

const ds = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5433),
  username: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
  entities: ALL_ENTITIES,
  synchronize: true,
});

// [名称, 分类, 单位, 是否常备]
const INGREDIENTS: [string, IngredientCategory, string, boolean?][] = [
  ['土豆', '蔬菜', '个'], ['番茄', '蔬菜', '个'], ['黄瓜', '蔬菜', '根'],
  ['青椒', '蔬菜', '个'], ['茄子', '蔬菜', '根'], ['西兰花', '蔬菜', '颗'],
  ['大白菜', '蔬菜', '颗'], ['蒜苔', '蔬菜', '把'], ['韭菜', '蔬菜', '把'],
  ['豆角', '蔬菜', '斤'], ['冬瓜', '蔬菜', '块'], ['香菇', '蔬菜', '朵'],
  ['金针菇', '蔬菜', '把'], ['莲藕', '蔬菜', '节'], ['山药', '蔬菜', '根'],
  ['五花肉', '肉类', '斤'], ['猪里脊', '肉类', '斤'], ['排骨', '肉类', '斤'],
  ['鸡翅', '肉类', '个'], ['鸡腿', '肉类', '个'], ['牛肉', '肉类', '斤'],
  ['基围虾', '海鲜', '斤'], ['鲈鱼', '海鲜', '条'],
  ['鸡蛋', '蛋奶', '个'], ['豆腐', '蛋奶', '块'],
  ['大米', '主食', '杯'], ['面条', '主食', '份'], ['饺子皮', '主食', '份'],
  ['葱', '调料', '根', true], ['姜', '调料', '块', true], ['蒜', '调料', '瓣', true],
  ['生抽', '调料', '勺', true], ['老抽', '调料', '勺', true], ['料酒', '调料', '勺', true],
  ['盐', '调料', '勺', true], ['糖', '调料', '勺', true], ['醋', '调料', '勺', true],
  ['豆瓣酱', '调料', '勺', true], ['干辣椒', '调料', '个', true], ['花椒', '调料', '勺', true],
];

// [菜名, 分类, 难度, 分钟, 备注, [食材, 数量, 单位?][]]
const DISHES: [string, DishCategory, number, number, string, [string, number, string?][]][] = [
  ['番茄炒蛋', '素菜', 1, 10, '国民下饭菜', [['番茄', 2], ['鸡蛋', 3], ['葱', 1], ['糖', 1]]],
  ['红烧肉', '荤菜', 3, 60, '肥而不腻，得小火慢炖', [['五花肉', 1.5], ['姜', 1], ['老抽', 2], ['糖', 2], ['料酒', 2]]],
  ['可乐鸡翅', '荤菜', 1, 25, '孩子最爱（以后）', [['鸡翅', 8], ['姜', 1], ['生抽', 2]]],
  ['糖醋排骨', '荤菜', 2, 40, '', [['排骨', 1], ['糖', 3], ['醋', 3], ['料酒', 2]]],
  ['鱼香肉丝', '荤菜', 2, 20, '', [['猪里脊', 0.5], ['青椒', 1], ['莲藕', 1], ['豆瓣酱', 1], ['糖', 1], ['醋', 1]]],
  ['麻婆豆腐', '素菜', 2, 15, '下饭神器', [['豆腐', 2], ['豆瓣酱', 1], ['花椒', 1], ['蒜', 3]]],
  ['清蒸鲈鱼', '荤菜', 2, 20, '', [['鲈鱼', 1], ['葱', 2], ['姜', 1], ['生抽', 2]]],
  ['白灼虾', '荤菜', 1, 10, '', [['基围虾', 1], ['姜', 1], ['葱', 1]]],
  ['干煸豆角', '素菜', 2, 15, '', [['豆角', 1], ['蒜', 3], ['干辣椒', 4]]],
  ['蒜蓉西兰花', '素菜', 1, 8, '', [['西兰花', 1], ['蒜', 4]]],
  ['地三鲜', '素菜', 2, 20, '', [['土豆', 2], ['茄子', 1], ['青椒', 1]]],
  ['酸辣土豆丝', '素菜', 1, 10, '', [['土豆', 2], ['干辣椒', 3], ['醋', 2]]],
  ['冬瓜排骨汤', '汤', 2, 50, '先焯水再炖', [['冬瓜', 1], ['排骨', 1], ['姜', 1]]],
  ['番茄鸡蛋面', '主食', 1, 15, '快手晚餐', [['面条', 2], ['番茄', 2], ['鸡蛋', 2]]],
  ['韭菜鸡蛋饺子', '主食', 3, 90, '周末全家一起包', [['饺子皮', 2], ['韭菜', 2], ['鸡蛋', 4]]],
  ['拍黄瓜', '素菜', 1, 5, '夏天必备凉菜', [['黄瓜', 2], ['蒜', 3], ['醋', 1]]],
];

async function main() {
  await ds.initialize();

  const members = ds.getRepository(Member);
  if ((await members.count()) === 0) {
    await members.save([
      members.create({ name: '爸爸', avatarEmoji: '👨‍🍳', role: 'chef' }),
      members.create({ name: '妈妈', avatarEmoji: '👩', role: 'member' }),
    ]);
    console.log('成员 ✓ 爸爸(掌勺) / 妈妈');
  }

  const ingredients = ds.getRepository(Ingredient);
  const ingredientMap = new Map<string, Ingredient>();
  for (const [name, category, defaultUnit, isPantryStaple] of INGREDIENTS) {
    let ing = await ingredients.findOneBy({ name });
    if (!ing) {
      ing = await ingredients.save(
        ingredients.create({ name, category, defaultUnit, isPantryStaple: !!isPantryStaple }),
      );
    }
    ingredientMap.set(name, ing);
  }
  console.log(`食材 ✓ ${ingredientMap.size} 种`);

  const dishes = ds.getRepository(Dish);
  const dishIngredients = ds.getRepository(DishIngredient);
  let created = 0;
  for (const [name, category, difficulty, estMinutes, note, list] of DISHES) {
    if (await dishes.findOneBy({ name })) continue;
    const dish = await dishes.save(
      dishes.create({
        name,
        category,
        difficulty,
        estMinutes,
        note: note || null,
      }),
    );
    for (const [ingName, quantity, unit] of list) {
      const ing = ingredientMap.get(ingName);
      if (!ing) continue;
      await dishIngredients.save(
        dishIngredients.create({
          dishId: dish.id,
          ingredientId: ing.id,
          quantity: String(quantity),
          unit: unit || ing.defaultUnit,
        }),
      );
    }
    created++;
  }
  console.log(`菜品 ✓ 新增 ${created} 道`);
  await ds.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
