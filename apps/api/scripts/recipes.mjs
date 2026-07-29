const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const TEST_DATE = '2199-12-24';

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  return { status: response.status, data: json.data, error: json.error };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', {
    loginName,
    password: 'family1234',
  });
  assert(response.status === 201, `${loginName}登录成功`);
  return response.data;
}

console.log('1. 新菜谱结构与权限');
const momLogin = await login('妈妈');
const momToken = momLogin.token;
const recipes = await request('/recipes', momToken);
assert(recipes.status === 200 && recipes.data.length >= 15, '可读取独立家庭菜谱');
assert(
  recipes.data.every((dish) =>
    dish.recipeVariants.some((variant) => variant.isDefault),
  ),
  '每道种子菜品都有家庭默认做法',
);

const dish = recipes.data.find((item) => item.name === '番茄炒蛋');
const defaultRecipe = dish?.recipeVariants.find((variant) => variant.isDefault);
const testIngredient = defaultRecipe?.ingredients.find(
  (item) => !item.ingredient.isPantryStaple,
);
assert(dish && defaultRecipe && testIngredient, '找到用于测试的默认做法和非必备食材');

const forbiddenDefaultEdit = await request(
  `/recipe-variants/${defaultRecipe.id}`,
  momToken,
  'PATCH',
  { name: '不应写入' },
);
assert(forbiddenDefaultEdit.status === 403, '普通成员不能修改家庭默认做法');

const created = await request(
  `/dishes/${dish.id}/recipe-variants`,
  momToken,
  'POST',
  {
    name: '妈妈的测试做法',
    note: '回归测试版本',
    estMinutes: 12,
    ingredients: [
      {
        ingredientId: testIngredient.ingredientId,
        quantity: 7,
        unit: testIngredient.unit,
      },
    ],
    steps: [{ text: '先准备食材' }, { text: '按自己的火候完成' }],
    referenceLinks: [{ title: '测试参考', url: 'https://example.com/recipe' }],
  },
);
assert(
  created.status === 201 && created.data.authorMemberId === momLogin.member.id,
  '成员可创建并拥有自己的做法',
);

const skill = await request('/member-dish-skills', momToken, 'POST', {
  dishId: dish.id,
  preferredRecipeId: created.data.id,
  level: 'signature',
});
assert(
  skill.status === 201 && skill.data.preferredRecipeId === created.data.id,
  '可将个人版本设为自己的常用做法',
);

const dadLogin = await login('爸爸');
const visibleToDad = await request(`/recipes/${dish.id}`, dadLogin.token);
assert(
  visibleToDad.status === 200 &&
    visibleToDad.data.recipeVariants.some(
      (variant) =>
        variant.id === created.data.id &&
        variant.authorMemberId === momLogin.member.id,
    ),
  '其他家庭成员可以查看个人做法',
);

console.log('2. 菜单采用常用做法并保存快照');
const menu = await request(
  `/menus?date=${TEST_DATE}&mealType=dinner`,
  momToken,
);
const ordered = await request(`/menus/${menu.data.id}/items`, momToken, 'POST', {
  items: [{ dishId: dish.id }],
});
const orderedItem = ordered.data.items.find(
  (item) =>
    item.dishId === dish.id &&
    item.requestedBy.id === momLogin.member.id &&
    item.status === 'pending',
);
assert(
  ordered.status === 201 &&
    orderedItem.recipeVariantId === defaultRecipe.id &&
    orderedItem.recipeSnapshot.variantId === defaultRecipe.id,
  '点菜默认采用家庭做法并保存快照',
);

const accepted = await request(
  `/menu-items/${orderedItem.id}`,
  momToken,
  'PATCH',
  { status: 'accepted' },
);
assert(
  accepted.status === 200 &&
    accepted.data.assignedToId === momLogin.member.id &&
    accepted.data.recipeVariantId === created.data.id &&
    accepted.data.recipeSnapshot.ingredients[0].quantity === 7,
  '认领后自动采用认领人的常用做法',
);

await request(`/recipe-variants/${created.data.id}`, momToken, 'PATCH', {
  ingredients: [
    {
      ingredientId: testIngredient.ingredientId,
      quantity: 99,
      unit: testIngredient.unit,
    },
  ],
});
const shopping = await request('/shopping-list/generate', momToken, 'POST', {
  date: TEST_DATE,
});
const generatedIngredient = shopping.data.find(
  (item) => item.ingredient?.id === testIngredient.ingredientId,
);
assert(
  shopping.status === 201 && Number(generatedIngredient?.totalQty) === 7,
  '采购按菜单快照计算，不受菜谱后续修改影响',
);

const switched = await request(
  `/menu-items/${orderedItem.id}`,
  momToken,
  'PATCH',
  { recipeVariantId: defaultRecipe.id },
);
assert(
  switched.status === 200 &&
    switched.data.recipeVariantId === defaultRecipe.id &&
    switched.data.recipeSnapshot.variantId === defaultRecipe.id,
  '菜单可以手动切换到任意家庭可见做法',
);

const archived = await request(
  `/recipe-variants/${created.data.id}`,
  momToken,
  'DELETE',
);
assert(archived.status === 200 && archived.data.archived, '个人做法可以归档');

console.log('\n菜谱与做法联动测试全部通过');
