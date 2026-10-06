// J1b.2：资产维护记出库改走库存门面后，事务语义不变——库存那一侧任一步失败，维护记录、计划周期、
// 库存流水、余量、批次扣减、动态全部不落；去掉故障后用同一个幂等键重来能正常完成（说明失败那次没留下半截）。
// 故障用数据库触发器注入：一次卡在写库存流水，一次卡在写批次流水（此时余量已改、流水已写，要一起回滚）。
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
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, data: json?.data, error: json?.error };
}

const db = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});

const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
// 完成日不能晚于家庭今天（上海时区）
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
const nextDue = (() => {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 30);
  return date.toISOString().slice(0, 10);
})();
const failFunction = `j1b_fail_maintenance_${suffix}`;
const triggers = [];

async function injectFailure(table, itemColumn, itemId) {
  const name = `j1b_fail_${table}_${suffix}`;
  await db.query(`
    CREATE OR REPLACE FUNCTION ${failFunction}() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'J1b 黑盒：强制库存出库失败';
    END;
    $$ LANGUAGE plpgsql`);
  await db.query(`
    CREATE TRIGGER ${name} BEFORE INSERT ON ${table}
    FOR EACH ROW WHEN (NEW."sourceType" = 'maintenance_record' AND NEW."${itemColumn}" = '${itemId}')
    EXECUTE FUNCTION ${failFunction}()`);
  triggers.push({ name, table });
  return name;
}

async function removeFailure(name) {
  const index = triggers.findIndex((one) => one.name === name);
  const [{ table }] = triggers.splice(index, 1);
  await db.query(`DROP TRIGGER IF EXISTS ${name} ON ${table}`);
}

async function snapshot(planId, itemId, batchId) {
  const [records, plan, item, batch, transactions, movements, activities] = await Promise.all([
    db.query(`SELECT count(*)::int AS n FROM maintenance_records WHERE "planId" = $1`, [planId]),
    db.query(`SELECT "nextDueDate"::text AS due FROM maintenance_plans WHERE id = $1`, [planId]),
    db.query(`SELECT quantity FROM inventory_items WHERE id = $1`, [itemId]),
    db.query(`SELECT quantity, version FROM inventory_batches WHERE id = $1`, [batchId]),
    db.query(
      `SELECT count(*)::int AS n FROM inventory_transactions WHERE "inventoryItemId" = $1 AND "sourceType" = 'maintenance_record'`,
      [itemId],
    ),
    db.query(
      `SELECT count(*)::int AS n FROM inventory_batch_movements WHERE "batchId" = $1 AND "sourceType" = 'maintenance_record'`,
      [batchId],
    ),
    db.query(
      `SELECT count(*)::int AS n FROM household_activity_logs WHERE action = 'maintenance_completed' AND metadata->>'planId' = $1`,
      [planId],
    ),
  ]);
  return {
    records: records.rows[0].n,
    nextDueDate: plan.rows[0].due,
    itemQuantity: Number(item.rows[0].quantity),
    batchQuantity: Number(batch.rows[0].quantity),
    batchVersion: batch.rows[0].version,
    transactions: transactions.rows[0].n,
    movements: movements.rows[0].n,
    activities: activities.rows[0].n,
  };
}

await db.connect();

try {
  const login = await request('/auth/login', null, 'POST', { loginName: '爸爸', password: PASSWORD });
  assert(login.status === 201, '维护出库回滚测试账号可以登录');
  const token = login.data.accessToken;

  const asset = await request('/assets', token, 'POST', { name: `J1b 回滚净水器 ${suffix}`, category: 'appliance' });
  const item = await request('/inventory-items', token, 'POST', {
    name: `J1b 回滚滤芯 ${suffix}`,
    category: '日用品',
    quantity: 3,
    unit: '个',
    lowStockThreshold: 0,
    restockQuantity: 1,
  });
  const batch = await request('/inventory-batches', token, 'POST', {
    inventoryItemId: item.data?.id,
    quantity: 2,
    idempotencyKey: `j1b-rollback-batch-${suffix}`,
  });
  const plan = await request(`/assets/${asset.data?.id}/maintenance-plans`, token, 'POST', {
    title: '换滤芯',
    frequencyDays: 30,
    nextDueDate: today,
  });
  const consumable = await request(`/maintenance-plans/${plan.data?.id}/consumables`, token, 'POST', {
    inventoryItemId: item.data?.id,
    quantity: 1,
  });
  assert(
    asset.status === 201 && item.status === 201 && batch.status === 201 && plan.status === 201 && consumable.status === 201,
    '准备好资产、带批次的库存、维护计划与耗材',
  );
  const planId = plan.data.id;
  const itemId = item.data.id;
  const batchId = batch.data.id;
  const before = await snapshot(planId, itemId, batchId);
  const key = `j1b-rollback-${suffix}`;
  const complete = () =>
    request(`/maintenance-plans/${planId}/complete`, token, 'POST', {
      performedOn: today,
      note: 'J1b 回滚',
      consumeInventory: true,
      idempotencyKey: key,
    });

  console.log('1. 写库存流水时失败');
  const atTransaction = await injectFailure('inventory_transactions', 'inventoryItemId', itemId);
  const failedAtTransaction = await complete();
  await removeFailure(atTransaction);
  assert(failedAtTransaction.status === 500, '库存流水写失败时完成维护整体报错');
  assert(
    JSON.stringify(await snapshot(planId, itemId, batchId)) === JSON.stringify(before),
    '维护记录、计划周期、库存流水、余量、批次与动态都没有落',
  );

  console.log('2. 写批次流水时失败（余量已改、库存流水已写之后）');
  const atMovement = await injectFailure('inventory_batch_movements', 'batchId', batchId);
  const failedAtMovement = await complete();
  await removeFailure(atMovement);
  assert(failedAtMovement.status === 500, '批次流水写失败时完成维护整体报错');
  assert(
    JSON.stringify(await snapshot(planId, itemId, batchId)) === JSON.stringify(before),
    '已经改过的余量与已写的库存流水随维护记录一起回滚',
  );

  console.log('3. 去掉故障后同一个幂等键重来');
  const succeeded = await complete();
  const after = await snapshot(planId, itemId, batchId);
  assert(
    succeeded.status === 201 &&
      succeeded.data.alreadyCompleted === false &&
      succeeded.data.transactions.length === 1 &&
      Number(succeeded.data.transactions[0].quantityAfter) === 2 &&
      succeeded.data.record.consumablesSnapshot[0].transactionId === succeeded.data.transactions[0].id,
    '失败的两次没有占用幂等键：这次是第一次完成，耗材快照里的流水 id 就是写下的那条',
  );
  assert(
    after.records === 1 &&
      after.nextDueDate === nextDue &&
      after.itemQuantity === 2 &&
      after.batchQuantity === 1 &&
      after.batchVersion === before.batchVersion + 1 &&
      after.transactions === 1 &&
      after.movements === 1 &&
      after.activities === 1,
    '维护记录、周期推进、库存流水、余量、批次扣减与动态各落一份',
  );
} finally {
  for (const { name, table } of triggers) await db.query(`DROP TRIGGER IF EXISTS ${name} ON ${table}`);
  await db.query(`DROP FUNCTION IF EXISTS ${failFunction}()`);
  await db.end();
}
