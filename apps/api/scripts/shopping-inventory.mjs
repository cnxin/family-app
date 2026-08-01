import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const TEST_DATE = '2199-12-25';

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
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const ids = {
  otherHousehold: randomUUID(),
  otherIngredient: randomUUID(),
  ingredients: {
    deduct: randomUUID(),
    enough: randomUUID(),
    mismatch: randomUUID(),
    pantryLinked: randomUUID(),
    pantryUnlinked: randomUUID(),
  },
  dish: randomUUID(),
  menu: randomUUID(),
  malformedOtherInventory: randomUUID(),
};

const db = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});

await db.connect();
let householdId = null;
let inventoryIds = [];

try {
  const login = await request('/auth/login', null, 'POST', {
    loginName: '爸爸',
    password: PASSWORD,
  });
  assert(login.status === 201, '库存采购测试账号可以登录');
  const token = login.body.data.accessToken;
  const member = login.body.data.member;
  householdId = member.householdId;

  await db.query(
    `INSERT INTO households (id, name, slug)
     VALUES ($1, '采购隔离测试家庭', $2)`,
    [ids.otherHousehold, `shopping-test-${ids.otherHousehold}`],
  );
  await db.query(
    `INSERT INTO ingredients
       (id, "householdId", name, category, "defaultUnit", "isPantryStaple")
     VALUES
       ($1, $6, '采购测试待抵扣', '其他', '份', false),
       ($2, $6, '采购测试库存足够', '其他', '份', false),
       ($3, $6, '采购测试单位不同', '其他', '瓶', false),
       ($4, $6, '采购测试已关联常备', '调料', '勺', true),
       ($5, $6, '采购测试未关联常备', '调料', '勺', true)`,
    [
      ids.ingredients.deduct,
      ids.ingredients.enough,
      ids.ingredients.mismatch,
      ids.ingredients.pantryLinked,
      ids.ingredients.pantryUnlinked,
      householdId,
    ],
  );
  await db.query(
    `INSERT INTO ingredients
       (id, "householdId", name, category, "defaultUnit", "isPantryStaple")
     VALUES ($1, $2, '其他家庭食材', '其他', '份', false)`,
    [ids.otherIngredient, ids.otherHousehold],
  );
  await db.query(
    `INSERT INTO dishes (id, "householdId", name, category)
     VALUES ($1, $2, '采购差额测试菜', '素菜')`,
    [ids.dish, householdId],
  );
  await db.query(
    `INSERT INTO dish_ingredients ("dishId", "ingredientId", quantity, unit)
     VALUES
       ($1, $2, 5, '份'),
       ($1, $3, 1, '份'),
       ($1, $4, 4, '瓶'),
       ($1, $5, 2, '勺'),
       ($1, $6, 2, '勺')`,
    [
      ids.dish,
      ids.ingredients.deduct,
      ids.ingredients.enough,
      ids.ingredients.mismatch,
      ids.ingredients.pantryLinked,
      ids.ingredients.pantryUnlinked,
    ],
  );
  await db.query(
    `INSERT INTO menus (id, "householdId", date, "mealType")
     VALUES ($1, $2, $3, 'dinner')`,
    [ids.menu, householdId, TEST_DATE],
  );
  await db.query(
    `INSERT INTO menu_items ("menuId", "dishId", "requestedById", status)
     VALUES ($1, $2, $3, 'accepted')`,
    [ids.menu, ids.dish, member.id],
  );

  const createInventory = async (body) => {
    const response = await request('/inventory-items', token, 'POST', body);
    assert(response.status === 201, `可以创建关联库存：${body.name}`);
    inventoryIds.push(response.body.data.id);
    return response.body.data;
  };
  const common = { category: '其他', lowStockThreshold: 1, restockQuantity: 1 };
  const deductedInventory = await createInventory({
    ...common,
    ingredientId: ids.ingredients.deduct,
    name: '采购测试待抵扣库存',
    quantity: 2,
    unit: '份',
  });
  await createInventory({
    ...common,
    ingredientId: ids.ingredients.enough,
    name: '采购测试充足库存',
    quantity: 3,
    unit: '份',
  });
  const mismatchInventory = await createInventory({
    ...common,
    ingredientId: ids.ingredients.mismatch,
    name: '采购测试箱装库存',
    quantity: 100,
    unit: '箱',
  });
  await createInventory({
    ...common,
    category: '调料',
    ingredientId: ids.ingredients.pantryLinked,
    name: '采购测试常备库存',
    quantity: 1,
    unit: '勺',
  });

  const duplicateLink = await request('/inventory-items', token, 'POST', {
    ...common,
    ingredientId: ids.ingredients.deduct,
    name: '采购测试重复关联',
    quantity: 1,
    unit: '份',
  });
  const foreignLink = await request('/inventory-items', token, 'POST', {
    ...common,
    ingredientId: ids.otherIngredient,
    name: '采购测试跨家庭关联',
    quantity: 1,
    unit: '份',
  });
  assert(
    duplicateLink.status === 409 && foreignLink.status === 404,
    '库存拒绝重复食材单位与跨家庭食材关联',
  );

  const unlinked = await request(
    `/inventory-items/${mismatchInventory.id}`,
    token,
    'PATCH',
    { ingredientId: null },
  );
  const relinked = await request(
    `/inventory-items/${mismatchInventory.id}`,
    token,
    'PATCH',
    { ingredientId: ids.ingredients.mismatch },
  );
  assert(
    unlinked.status === 200 &&
      unlinked.body.data.ingredientId === null &&
      unlinked.body.data.ingredient === null &&
      relinked.status === 200 &&
      relinked.body.data.ingredient?.id === ids.ingredients.mismatch,
    '库存取消和恢复食材关联后响应立即反映最新关系',
  );

  await db.query(
    `INSERT INTO inventory_items
       (id, "householdId", "ingredientId", name, category, quantity, unit)
     VALUES ($1, $2, $3, '其他家庭异常关联库存', '其他', 90, '份')`,
    [ids.malformedOtherInventory, ids.otherHousehold, ids.ingredients.deduct],
  );

  const inventory = await request('/inventory', token);
  assert(
    inventory.status === 200 &&
      inventory.body.data.some(
        (item) =>
          item.id === deductedInventory.id &&
          item.ingredient?.id === ids.ingredients.deduct,
      ),
    '库存列表返回已关联的家庭食材',
  );

  const generated = await request('/shopping-list/generate', token, 'POST', {
    date: TEST_DATE,
  });
  const items = generated.body.data;
  const deducted = items.find(
    (item) => item.ingredient?.id === ids.ingredients.deduct,
  );
  const mismatch = items.find(
    (item) => item.ingredient?.id === ids.ingredients.mismatch,
  );
  const pantryLinked = items.find(
    (item) => item.ingredient?.id === ids.ingredients.pantryLinked,
  );
  assert(
    generated.status === 201 &&
      Number(deducted?.requiredQty) === 5 &&
      Number(deducted?.availableQty) === 2 &&
      Number(deducted?.totalQty) === 3,
    '菜单需求会减去同家庭、同食材和同单位的库存',
  );
  assert(
    !items.some((item) => item.ingredient?.id === ids.ingredients.enough),
    '库存足够的食材不会生成采购项',
  );
  assert(
    Number(mismatch?.requiredQty) === 4 &&
      Number(mismatch?.availableQty) === 0 &&
      Number(mismatch?.totalQty) === 4,
    '单位不同的库存不会错误抵扣菜单需求',
  );
  assert(
    Number(pantryLinked?.totalQty) === 1 &&
      !items.some(
        (item) => item.ingredient?.id === ids.ingredients.pantryUnlinked,
      ),
    '已关联常备食材按库存计算，未关联常备食材保持兼容跳过',
  );

  const checked = await request(
    `/shopping-items/${deducted.id}`,
    token,
    'PATCH',
    { checked: true },
  );
  const regenerated = await request(
    '/shopping-list/generate',
    token,
    'POST',
    { date: TEST_DATE },
  );
  assert(
    checked.status === 200 &&
      regenerated.body.data.find(
        (item) => item.ingredient?.id === ids.ingredients.deduct,
      )?.checked === true,
    '重新计算采购差额时保留同食材和单位的勾选状态',
  );

  const enoughAfterUpdate = await request(
    `/inventory-items/${deductedInventory.id}`,
    token,
    'PATCH',
    { quantity: 5 },
  );
  const afterEnough = await request(
    '/shopping-list/generate',
    token,
    'POST',
    { date: TEST_DATE },
  );
  assert(
    enoughAfterUpdate.status === 200 &&
      !afterEnough.body.data.some(
        (item) => item.ingredient?.id === ids.ingredients.deduct,
      ),
    '库存变化后重建清单会使用最新数量',
  );

  console.log('\n库存与采购差额测试全部通过');
} finally {
  if (householdId) {
    await db.query(
      'DELETE FROM shopping_items WHERE "householdId" = $1 AND date = $2',
      [householdId, TEST_DATE],
    );
    await db.query('DELETE FROM inventory_items WHERE id = ANY($1::uuid[])', [
      inventoryIds,
    ]);
    await db.query('DELETE FROM menus WHERE id = $1', [ids.menu]);
    await db.query('DELETE FROM dishes WHERE id = $1', [ids.dish]);
    await db.query(
      'DELETE FROM ingredients WHERE id = ANY($1::uuid[])',
      [Object.values(ids.ingredients)],
    );
  }
  await db.query('DELETE FROM inventory_items WHERE id = $1', [
    ids.malformedOtherInventory,
  ]);
  await db.query('DELETE FROM ingredients WHERE id = $1', [ids.otherIngredient]);
  await db.query('DELETE FROM households WHERE id = $1', [ids.otherHousehold]);
  await db.end();
}
