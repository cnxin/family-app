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
  otherShoppingItem: randomUUID(),
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
  const pantryInventory = await createInventory({
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
  await db.query(
    `INSERT INTO shopping_items
       (id, "householdId", date, "customName", "totalQty", unit, checked, source)
     VALUES ($1, $2, $3, '其他家庭购物项', 1, '份', true, 'manual')`,
    [ids.otherShoppingItem, ids.otherHousehold, TEST_DATE],
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

  const receiptPreview = await request(
    `/shopping-items/${deducted.id}/inventory-preview`,
    token,
  );
  assert(
    receiptPreview.status === 200 &&
      receiptPreview.body.data.canConfirm === true &&
      receiptPreview.body.data.quantityBefore === 2 &&
      receiptPreview.body.data.quantityAfter === 5,
    '购物入库预览显示库存从 2 变为 5',
  );
  const concurrentReceipts = await Promise.all([
    request(`/shopping-items/${deducted.id}/confirm-stock`, token, 'POST', {}),
    request(`/shopping-items/${deducted.id}/confirm-stock`, token, 'POST', {}),
  ]);
  const receiptTransactions = concurrentReceipts.flatMap(
    (response) => response.body.data.transactions,
  );
  const receiptTransaction = receiptTransactions[0];
  const afterReceiptInventory = await request('/inventory', token);
  assert(
    concurrentReceipts.every((response) => response.status === 201) &&
      new Set(receiptTransactions.map((transaction) => transaction.id)).size === 1 &&
      Number(
        afterReceiptInventory.body.data.find(
          (item) => item.id === deductedInventory.id,
        )?.quantity,
      ) === 5,
    '并发确认和接口重试只执行一次购物入库',
  );

  await db.query(
    `UPDATE dish_ingredients
     SET quantity = 7
     WHERE "dishId" = $1 AND "ingredientId" = $2`,
    [ids.dish, ids.ingredients.deduct],
  );
  const generatedAfterNewDemand = await request(
    '/shopping-list/generate',
    token,
    'POST',
    { date: TEST_DATE },
  );
  const sameIngredientAfterNewDemand = generatedAfterNewDemand.body.data.filter(
    (item) => item.ingredient?.id === ids.ingredients.deduct,
  );
  assert(
    sameIngredientAfterNewDemand.some(
      (item) =>
        item.id === deducted.id &&
        item.inventoryConfirmation?.transactionId === receiptTransaction.id &&
        Number(item.totalQty) === 3,
    ) &&
      sameIngredientAfterNewDemand.some(
        (item) =>
          item.id !== deducted.id &&
          item.inventoryConfirmation == null &&
          Number(item.totalQty) === 2,
      ),
    '新增采购差额不会覆盖已经确认入库的来源项',
  );
  await db.query(
    `UPDATE dish_ingredients
     SET quantity = 5
     WHERE "dishId" = $1 AND "ingredientId" = $2`,
    [ids.dish, ids.ingredients.deduct],
  );

  const crossHouseholdReceipt = await request(
    `/shopping-items/${ids.otherShoppingItem}/confirm-stock`,
    token,
    'POST',
    { inventoryItemId: deductedInventory.id },
  );
  const manualItem = await request('/shopping-items', token, 'POST', {
    date: TEST_DATE,
    customName: '采购测试自由名称',
    totalQty: 2,
    unit: '箱',
  });
  await request(`/shopping-items/${manualItem.body.data.id}`, token, 'PATCH', {
    checked: true,
  });
  const manualWithoutTarget = await request(
    `/shopping-items/${manualItem.body.data.id}/confirm-stock`,
    token,
    'POST',
    {},
  );
  const manualWrongUnit = await request(
    `/shopping-items/${manualItem.body.data.id}/confirm-stock`,
    token,
    'POST',
    { inventoryItemId: deductedInventory.id },
  );
  const manualForeignTarget = await request(
    `/shopping-items/${manualItem.body.data.id}/confirm-stock`,
    token,
    'POST',
    { inventoryItemId: ids.malformedOtherInventory },
  );
  assert(
    crossHouseholdReceipt.status === 404 &&
      manualWithoutTarget.status === 400 &&
      manualWrongUnit.status === 409 &&
      manualForeignTarget.status === 404,
    '自由名称必须选库存项，并拒绝单位不匹配和跨家庭目标',
  );

  const afterEnough = await request(
    '/shopping-list/generate',
    token,
    'POST',
    { date: TEST_DATE },
  );
  assert(
    afterEnough.status === 201 &&
      afterEnough.body.data.find((item) => item.id === deducted.id)
        ?.inventoryConfirmation?.transactionId === receiptTransaction.id,
    '重建清单会保留已确认入库项及其幂等来源状态',
  );

  await request(`/menu-items/${(
    await db.query('SELECT id FROM menu_items WHERE "menuId" = $1', [ids.menu])
  ).rows[0].id}`, token, 'PATCH', { status: 'cooking' });
  await request(`/menu-items/${(
    await db.query('SELECT id FROM menu_items WHERE "menuId" = $1', [ids.menu])
  ).rows[0].id}`, token, 'PATCH', { status: 'done' });
  const completedMenu = await request(`/menus/${ids.menu}/complete`, token, 'POST');
  const blockedMenuPreview = await request(
    `/menus/${ids.menu}/inventory-preview`,
    token,
  );
  const blockedMenuConfirm = await request(
    `/menus/${ids.menu}/confirm-consumption`,
    token,
    'POST',
  );
  assert(
    completedMenu.status === 201 &&
      blockedMenuPreview.body.data.rows.some(
        (row) => row.status === 'unit_mismatch',
      ) &&
      blockedMenuPreview.body.data.rows.some(
        (row) => row.status === 'insufficient',
      ) &&
      blockedMenuConfirm.status === 409,
    '菜单扣库在单位不匹配或库存不足时展示原因并拒绝执行',
  );

  const unlinkedMismatch = await request(
    `/inventory-items/${mismatchInventory.id}`,
    token,
    'PATCH',
    { ingredientId: null },
  );
  const replenishedPantry = await request(
    `/inventory-items/${pantryInventory.id}`,
    token,
    'PATCH',
    { quantity: 2, idempotencyKey: randomUUID() },
  );
  const readyMenuPreview = await request(
    `/menus/${ids.menu}/inventory-preview`,
    token,
  );
  assert(
    unlinkedMismatch.status === 200 &&
      replenishedPantry.status === 200 &&
      readyMenuPreview.body.data.canConfirm === true &&
      readyMenuPreview.body.data.rows.filter((row) => row.status === 'ready')
        .length === 3,
    '修正库存后菜单预览给出三项明确扣减前后数量',
  );

  const concurrentConsumptions = await Promise.all([
    request(`/menus/${ids.menu}/confirm-consumption`, token, 'POST'),
    request(`/menus/${ids.menu}/confirm-consumption`, token, 'POST'),
  ]);
  const consumptionTransactions = concurrentConsumptions.flatMap(
    (response) => response.body.data.transactions,
  );
  const consumptionIds = new Set(
    consumptionTransactions.map((transaction) => transaction.id),
  );
  const afterConsumptionInventory = await request('/inventory', token);
  assert(
    concurrentConsumptions.every((response) => response.status === 201) &&
      consumptionIds.size === 3 &&
      Number(
        afterConsumptionInventory.body.data.find(
          (item) => item.id === deductedInventory.id,
        )?.quantity,
      ) === 0,
    '并发菜单确认只扣库一次，并以同一操作组保存三条流水',
  );

  const reverseOldReceipt = await request(
    `/inventory-transactions/${receiptTransaction.id}/reverse`,
    token,
    'POST',
  );
  assert(
    reverseOldReceipt.status === 409,
    '后续已有扣库时不能撤销较早的入库流水',
  );

  const consumptionTransaction = concurrentConsumptions[0].body.data.transactions[0];
  const concurrentReversals = await Promise.all([
    request(
      `/inventory-transactions/${consumptionTransaction.id}/reverse`,
      token,
      'POST',
    ),
    request(
      `/inventory-transactions/${consumptionTransaction.id}/reverse`,
      token,
      'POST',
    ),
  ]);
  const afterReversalInventory = await request('/inventory', token);
  assert(
    concurrentReversals.every((response) => response.status === 201) &&
      concurrentReversals.some(
        (response) => response.body.data.alreadyReversed === true,
      ) &&
      Number(
        afterReversalInventory.body.data.find(
          (item) => item.id === deductedInventory.id,
        )?.quantity,
      ) === 5,
    '并发撤销只追加一组反向流水并恢复整餐库存',
  );

  const duplicateMenuConfirmation = await request(
    `/menus/${ids.menu}/confirm-consumption`,
    token,
    'POST',
  );
  assert(
    duplicateMenuConfirmation.status === 201 &&
      duplicateMenuConfirmation.body.data.alreadyConfirmed === true,
    '扣库撤销后重复确认仍不会再次修改库存',
  );

  const adjustmentKey = randomUUID();
  const concurrentAdjustments = await Promise.all([
    request(`/inventory-items/${deductedInventory.id}`, token, 'PATCH', {
      quantity: 4,
      idempotencyKey: adjustmentKey,
    }),
    request(`/inventory-items/${deductedInventory.id}`, token, 'PATCH', {
      quantity: 4,
      idempotencyKey: adjustmentKey,
    }),
  ]);
  const adjustmentCount = await db.query(
    `SELECT COUNT(*)::int AS count FROM inventory_transactions
     WHERE "householdId" = $1 AND "idempotencyKey" = $2`,
    [householdId, `manual-adjustment:${adjustmentKey}`],
  );
  assert(
    concurrentAdjustments.every((response) => response.status === 200) &&
      adjustmentCount.rows[0].count === 1,
    '并发数量调整通过幂等键只写入一条调整流水',
  );

  const ledger = await request('/inventory-transactions?limit=100', token);
  assert(
    ledger.status === 200 &&
      ledger.body.data.some((transaction) => transaction.type === 'receipt') &&
      ledger.body.data.some((transaction) => transaction.type === 'consumption') &&
      ledger.body.data.some((transaction) => transaction.type === 'adjustment') &&
      ledger.body.data.some((transaction) => transaction.type === 'reversal'),
    '库存流水返回入库、消耗、调整和撤销及操作者信息',
  );

  let updateRejected = false;
  let deleteRejected = false;
  try {
    await db.query(
      'UPDATE inventory_transactions SET "actorName" = $1 WHERE id = $2',
      ['不应修改', receiptTransaction.id],
    );
  } catch (error) {
    updateRejected = error.code === '55000';
  }
  try {
    await db.query('DELETE FROM inventory_transactions WHERE id = $1', [
      receiptTransaction.id,
    ]);
  } catch (error) {
    deleteRejected = error.code === '55000';
  }
  assert(updateRejected && deleteRejected, '数据库拒绝更新或删除不可变库存流水');

  console.log('\n库存、采购差额与不可变流水测试全部通过');
} finally {
  // 流水不可删除；完整 API 回归会在用例结束后直接销毁临时数据库。
  await db.query('DELETE FROM inventory_items WHERE id = $1', [
    ids.malformedOtherInventory,
  ]);
  await db.query('DELETE FROM shopping_items WHERE id = $1', [
    ids.otherShoppingItem,
  ]);
  await db.query('DELETE FROM ingredients WHERE id = $1', [ids.otherIngredient]);
  await db.query('DELETE FROM households WHERE id = $1', [ids.otherHousehold]);
  await db.end();
}
