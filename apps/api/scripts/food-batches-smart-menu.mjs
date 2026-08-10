import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';

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

function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const currentDate = today();
const suffix = randomUUID().slice(0, 8);
const ids = {
  otherHousehold: randomUUID(),
  otherInventory: randomUUID(),
};
const db = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});

await db.connect();

try {
  const login = await request('/auth/login', null, 'POST', {
    loginName: '爸爸',
    password: PASSWORD,
  });
  assert(login.status === 201, '食品批次测试账号可以登录');
  const token = login.body.data.accessToken;
  const householdId = login.body.data.member.householdId;

  await db.query(
    `INSERT INTO households (id, name, slug)
     VALUES ($1, '食品批次隔离家庭', $2)`,
    [ids.otherHousehold, `food-batch-test-${suffix}`],
  );
  await db.query(
    `INSERT INTO inventory_items
       (id, "householdId", name, category, quantity, unit)
     VALUES ($1, $2, '其他家庭批次库存', '其他', 2, '份')`,
    [ids.otherInventory, ids.otherHousehold],
  );

  console.log('1. 创建独立菜品和可追踪库存');
  const mainDish = await request('/dishes', token, 'POST', {
    name: `批次测试炖菜-${suffix}`,
    category: '素菜',
    difficulty: 1,
    estMinutes: 20,
    ingredients: [
      {
        name: `批次测试蔬菜-${suffix}`,
        category: '蔬菜',
        quantity: 5,
        unit: '份',
      },
    ],
    recipeSteps: [{ text: '按家庭口味完成' }],
  });
  const secondDish = await request('/dishes', token, 'POST', {
    name: `批次测试汤-${suffix}`,
    category: '汤',
    difficulty: 2,
    estMinutes: 15,
    ingredients: [
      {
        name: `批次测试豆腐-${suffix}`,
        category: '其他',
        quantity: 1,
        unit: '份',
      },
    ],
    recipeSteps: [{ text: '煮至入味' }],
  });
  assert(
    mainDish.status === 201 && secondDish.status === 201,
    '可以创建用于批次和智能菜单的独立菜品',
  );
  const recipes = await request('/recipes', token);
  const mainRecipe = recipes.body.data.find(
    (dish) => dish.id === mainDish.body.data.id,
  );
  const secondRecipe = recipes.body.data.find(
    (dish) => dish.id === secondDish.body.data.id,
  );
  const mainIngredient = mainRecipe?.recipeVariants
    .find((variant) => variant.isDefault)
    ?.ingredients[0];
  const secondIngredient = secondRecipe?.recipeVariants
    .find((variant) => variant.isDefault)
    ?.ingredients[0];
  assert(mainIngredient && secondIngredient, '新菜品已经生成包含食材的家庭默认做法');

  const inventory = await request('/inventory-items', token, 'POST', {
    ingredientId: mainIngredient.ingredientId,
    name: `批次测试库存-${suffix}`,
    category: '其他',
    quantity: 10,
    unit: '份',
    lowStockThreshold: 2,
    restockQuantity: 5,
  });
  const secondInventory = await request('/inventory-items', token, 'POST', {
    ingredientId: secondIngredient.ingredientId,
    name: `批次测试辅助库存-${suffix}`,
    category: '其他',
    quantity: 3,
    unit: '份',
    lowStockThreshold: 1,
    restockQuantity: 2,
  });
  assert(
    inventory.status === 201 && secondInventory.status === 201,
    '可以创建两项关联食材库存',
  );

  console.log('2. 批次登记幂等、日期、家庭隔离和临期状态');
  const firstKey = randomUUID();
  const firstBody = {
    inventoryItemId: inventory.body.data.id,
    quantity: 3,
    receivedOn: addDays(currentDate, -10),
    productionDate: addDays(currentDate, -12),
    expiresOn: addDays(currentDate, -1),
    idempotencyKey: firstKey,
  };
  const concurrentFirst = await Promise.all([
    request('/inventory-batches', token, 'POST', firstBody),
    request('/inventory-batches', token, 'POST', firstBody),
  ]);
  const firstBatch = concurrentFirst[0].body.data;
  assert(
    concurrentFirst.every((response) => response.status === 201) &&
      new Set(concurrentFirst.map((response) => response.body.data.id)).size === 1,
    '重复点击和并发请求只登记一个食品批次',
  );

  const conflictingKey = await request('/inventory-batches', token, 'POST', {
    ...firstBody,
    inventoryItemId: secondInventory.body.data.id,
  });
  assert(conflictingKey.status === 409, '幂等键复用于不同批次会被拒绝');

  const expiring = await request('/inventory-batches', token, 'POST', {
    inventoryItemId: inventory.body.data.id,
    quantity: 4,
    receivedOn: addDays(currentDate, -2),
    productionDate: addDays(currentDate, -3),
    expiresOn: addDays(currentDate, 2),
    openedOn: currentDate,
    idempotencyKey: randomUUID(),
  });
  const fresh = await request('/inventory-batches', token, 'POST', {
    inventoryItemId: inventory.body.data.id,
    quantity: 3,
    receivedOn: currentDate,
    expiresOn: addDays(currentDate, 30),
    idempotencyKey: randomUUID(),
  });
  const invalidDates = await request('/inventory-batches', token, 'POST', {
    inventoryItemId: inventory.body.data.id,
    quantity: 1,
    productionDate: currentDate,
    expiresOn: addDays(currentDate, -1),
    idempotencyKey: randomUUID(),
  });
  const overAllocation = await request('/inventory-batches', token, 'POST', {
    inventoryItemId: inventory.body.data.id,
    quantity: 0.01,
    expiresOn: addDays(currentDate, 60),
    idempotencyKey: randomUUID(),
  });
  assert(
    expiring.status === 201 &&
      fresh.status === 201 &&
      invalidDates.status === 400 &&
      overAllocation.status === 409,
    '登记校验拒绝倒置日期和超过未分批余量的数量',
  );

  const partialUpdate = await request(
    `/inventory-batches/${firstBatch.id}`,
    token,
    'PATCH',
    { expectedVersion: firstBatch.version, openedOn: currentDate },
  );
  const staleUpdate = await request(
    `/inventory-batches/${firstBatch.id}`,
    token,
    'PATCH',
    { expectedVersion: firstBatch.version, openedOn: addDays(currentDate, -1) },
  );
  assert(
    partialUpdate.status === 200 &&
      partialUpdate.body.data.receivedOn === firstBatch.receivedOn &&
      partialUpdate.body.data.expiresOn === firstBatch.expiresOn &&
      partialUpdate.body.data.openedOn === currentDate &&
      staleUpdate.status === 409,
    '局部更新保留未提交日期并使用版本号阻止覆盖',
  );

  const expiredList = await request(
    `/inventory-batches?inventoryItemId=${inventory.body.data.id}&status=expired&days=7`,
    token,
  );
  const expiringList = await request(
    `/inventory-batches?inventoryItemId=${inventory.body.data.id}&status=expiring&days=7`,
    token,
  );
  const foreignList = await request(
    `/inventory-batches?inventoryItemId=${ids.otherInventory}`,
    token,
  );
  const foreignCreate = await request('/inventory-batches', token, 'POST', {
    inventoryItemId: ids.otherInventory,
    quantity: 1,
    idempotencyKey: randomUUID(),
  });
  assert(
    expiredList.status === 200 &&
      expiredList.body.data.some((batch) => batch.id === firstBatch.id) &&
      expiringList.body.data.some((batch) => batch.id === expiring.body.data.id) &&
      foreignList.status === 404 &&
      foreignCreate.status === 404,
    '临期和过期筛选准确且跨家庭批次访问被拒绝',
  );

  console.log('3. 购物确认入库建立采购批次并保持并发幂等');
  const shopping = await request('/shopping-items', token, 'POST', {
    date: addDays(currentDate, 10),
    customName: `批次测试补货-${suffix}`,
    totalQty: 2,
    unit: '份',
  });
  await request(`/shopping-items/${shopping.body.data.id}`, token, 'PATCH', {
    checked: true,
  });
  const receiptBody = {
    inventoryItemId: inventory.body.data.id,
    batch: {
      receivedOn: currentDate,
      productionDate: addDays(currentDate, -1),
      expiresOn: addDays(currentDate, 15),
    },
  };
  const receipts = await Promise.all([
    request(
      `/shopping-items/${shopping.body.data.id}/confirm-stock`,
      token,
      'POST',
      receiptBody,
    ),
    request(
      `/shopping-items/${shopping.body.data.id}/confirm-stock`,
      token,
      'POST',
      receiptBody,
    ),
  ]);
  const receiptIds = receipts.flatMap((response) =>
    response.body.data.transactions.map((transaction) => transaction.id),
  );
  const afterReceiptBatches = await request(
    `/inventory-batches?inventoryItemId=${inventory.body.data.id}&status=active`,
    token,
  );
  const receiptBatch = afterReceiptBatches.body.data.find(
    (batch) => batch.sourceType === 'shopping_item' && batch.sourceId === shopping.body.data.id,
  );
  const inventoryAfterReceipt = await request('/inventory', token);
  const trackedAfterReceipt = inventoryAfterReceipt.body.data.find(
    (item) => item.id === inventory.body.data.id,
  );
  assert(
    receipts.every((response) => response.status === 201) &&
      new Set(receiptIds).size === 1 &&
      receiptBatch &&
      Number(receiptBatch.quantity) === 2 &&
      Number(trackedAfterReceipt.quantity) === 12 &&
      Number(trackedAfterReceipt.batchSummary.untrackedQuantity) === 0,
    '购物入库只增加一次总库存并建立对应采购批次',
  );

  console.log('4. 菜单按到期日先进先出扣库并可用反向流水撤销');
  const menuDate = addDays(currentDate, 20);
  const menu = await request(
    `/menus?date=${menuDate}&mealType=dinner`,
    token,
  );
  const ordered = await request(`/menus/${menu.body.data.id}/items`, token, 'POST', {
    items: [{ dishId: mainDish.body.data.id }],
  });
  const menuItem = ordered.body.data.items.find(
    (item) => item.dishId === mainDish.body.data.id,
  );
  await request(`/menu-items/${menuItem.id}`, token, 'PATCH', {
    status: 'accepted',
  });
  await request(`/menu-items/${menuItem.id}`, token, 'PATCH', {
    status: 'cooking',
  });
  await request(`/menu-items/${menuItem.id}`, token, 'PATCH', {
    status: 'done',
  });
  await request(`/menus/${menu.body.data.id}/complete`, token, 'POST');

  const fifoPreview = await request(
    `/menus/${menu.body.data.id}/inventory-preview`,
    token,
  );
  const fifoRow = fifoPreview.body.data.rows.find(
    (row) => row.inventoryItemId === inventory.body.data.id,
  );
  assert(
    fifoPreview.status === 200 &&
      fifoPreview.body.data.canConfirm === true &&
      fifoRow.batchAllocations.length === 2 &&
      fifoRow.batchAllocations[0].batchId === firstBatch.id &&
      fifoRow.batchAllocations[0].quantity === 3 &&
      fifoRow.batchAllocations[1].batchId === expiring.body.data.id &&
      fifoRow.batchAllocations[1].quantity === 2,
    '扣库预览先使用已过期批次，再使用临期批次并显示预计余量',
  );

  const consumptions = await Promise.all([
    request(`/menus/${menu.body.data.id}/confirm-consumption`, token, 'POST'),
    request(`/menus/${menu.body.data.id}/confirm-consumption`, token, 'POST'),
  ]);
  const consumptionIds = consumptions.flatMap((response) =>
    response.body.data.transactions.map((transaction) => transaction.id),
  );
  const afterConsumption = await request(
    `/inventory-batches?inventoryItemId=${inventory.body.data.id}`, token,
  );
  assert(
    consumptions.every((response) => response.status === 201) &&
      new Set(consumptionIds).size === 1 &&
      Number(afterConsumption.body.data.find((batch) => batch.id === firstBatch.id).quantity) === 0 &&
      Number(afterConsumption.body.data.find((batch) => batch.id === expiring.body.data.id).quantity) === 2,
    '并发确认只扣库一次且批次余量与 FIFO 预览一致',
  );

  const reversals = await Promise.all([
    request(`/inventory-transactions/${consumptionIds[0]}/reverse`, token, 'POST'),
    request(`/inventory-transactions/${consumptionIds[0]}/reverse`, token, 'POST'),
  ]);
  const afterReversal = await request(
    `/inventory-batches?inventoryItemId=${inventory.body.data.id}`, token,
  );
  assert(
    reversals.every((response) => response.status === 201) &&
      reversals.some((response) => response.body.data.alreadyReversed === true) &&
      Number(afterReversal.body.data.find((batch) => batch.id === firstBatch.id).quantity) === 3 &&
      Number(afterReversal.body.data.find((batch) => batch.id === expiring.body.data.id).quantity) === 4,
    '撤销菜单扣库通过反向批次流水恢复原批次余量',
  );

  const movement = await db.query(
    `SELECT id FROM inventory_batch_movements
     WHERE "householdId" = $1 ORDER BY "createdAt" ASC LIMIT 1`,
    [householdId],
  );
  let updateRejected = false;
  let deleteRejected = false;
  try {
    await db.query(
      `UPDATE inventory_batch_movements SET "actorName" = '不应修改' WHERE id = $1`,
      [movement.rows[0].id],
    );
  } catch (error) {
    updateRejected = error.code === '55000';
  }
  try {
    await db.query('DELETE FROM inventory_batch_movements WHERE id = $1', [
      movement.rows[0].id,
    ]);
  } catch (error) {
    deleteRejected = error.code === '55000';
  }
  assert(updateRejected && deleteRejected, '数据库拒绝修改或删除不可变批次流水');

  console.log('5. 智能菜单生成、家庭投票和明确采纳');
  const planStartsOn = addDays(currentDate, 30);
  const planKey = randomUUID();
  const planRequests = await Promise.all([
    request('/smart-menu-plans', token, 'POST', {
      startsOn: planStartsOn,
      idempotencyKey: planKey,
    }),
    request('/smart-menu-plans', token, 'POST', {
      startsOn: planStartsOn,
      idempotencyKey: planKey,
    }),
  ]);
  const plan = planRequests[0].body.data;
  const mainCandidate = plan.candidates.find(
    (candidate) => candidate.dishId === mainDish.body.data.id,
  );
  const keyConflict = await request('/smart-menu-plans', token, 'POST', {
    startsOn: addDays(planStartsOn, 7),
    idempotencyKey: planKey,
  });
  assert(
    planRequests.every((response) => response.status === 201) &&
      new Set(planRequests.map((response) => response.body.data.id)).size === 1 &&
      mainCandidate?.reasons.some((reason) => reason.includes('临期食材')) &&
      mainCandidate.expiringIngredients.some(
        (ingredient) => ingredient.ingredientId === mainIngredient.ingredientId,
      ) &&
      keyConflict.status === 409,
    '智能菜单幂等生成并保存可解释评分与临期食材快照',
  );

  const pollRequests = await Promise.all([
    request(`/smart-menu-plans/${plan.id}/poll`, token, 'POST', {}),
    request(`/smart-menu-plans/${plan.id}/poll`, token, 'POST', {}),
  ]);
  const votingPlan = pollRequests[0].body.data;
  assert(
    pollRequests.every((response) => response.status === 201) &&
      new Set(pollRequests.map((response) => response.body.data.pollId)).size === 1 &&
      votingPlan.status === 'voting',
    '菜单候选只能转成一个家庭投票',
  );

  const earlyAdopt = await request(
    `/smart-menu-plans/${plan.id}/adopt`,
    token,
    'POST',
    { idempotencyKey: randomUUID() },
  );
  const selectedCandidate = votingPlan.candidates.find(
    (candidate) => candidate.dishId === mainDish.body.data.id,
  );
  const vote = await request(
    `/polls/${votingPlan.pollId}/votes`,
    token,
    'POST',
    { optionIds: [selectedCandidate.pollOptionId] },
  );
  assert(
    earlyAdopt.status === 409 && vote.status === 201,
    '投票结束前拒绝采纳，家庭成员可以明确选择候选菜',
  );

  const targetMenu = await request(
    `/menus?date=${planStartsOn}&mealType=dinner`,
    token,
  );
  await request(`/menus/${targetMenu.body.data.id}/items`, token, 'POST', {
    items: [{ dishId: mainDish.body.data.id }],
  });
  await request(`/polls/${votingPlan.pollId}/close`, token, 'POST');

  const adopts = await Promise.all([
    request(`/smart-menu-plans/${plan.id}/adopt`, token, 'POST', {
      idempotencyKey: randomUUID(),
    }),
    request(`/smart-menu-plans/${plan.id}/adopt`, token, 'POST', {
      idempotencyKey: randomUUID(),
    }),
  ]);
  const adopted = adopts[0].body.data;
  const adoptedMenuItems = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM menu_items item
     JOIN menus menu ON menu.id = item."menuId"
     WHERE menu."householdId" = $1 AND menu.date = $2
       AND menu."mealType" = 'dinner' AND item."dishId" = $3
       AND item.status <> 'rejected'`,
    [householdId, planStartsOn, mainDish.body.data.id],
  );
  const repeatedAdopt = await request(
    `/smart-menu-plans/${plan.id}/adopt`,
    token,
    'POST',
    { idempotencyKey: randomUUID() },
  );
  assert(
    adopts.every((response) => response.status === 201) &&
      adopted.status === 'adopted' &&
      adopted.adoptedCount === 1 &&
      adoptedMenuItems.rows[0].count === 1 &&
      repeatedAdopt.status === 201 &&
      repeatedAdopt.body.data.adoptedCount === 1,
    '投票关闭后明确采纳写入菜单，并发与重复采纳不会重复点菜',
  );

  console.log('\n食品批次与智能菜单测试全部通过');
} finally {
  await db.query('DELETE FROM inventory_items WHERE id = $1', [ids.otherInventory]);
  await db.query('DELETE FROM households WHERE id = $1', [ids.otherHousehold]);
  await db.end();
}
