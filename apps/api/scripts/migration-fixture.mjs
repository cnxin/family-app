/**
 * 迁移演练夹具：演练 up → down → up 之前给隔离库灌一套真实业务数据。
 * 空库上的迁移演练不算数（教训 29）：维护记录「不可修改」触发器这类约束，只有表里有行才会撞上。
 *
 * 由 run-api-tests.mjs 全量模式在 seed.ts 之后、迁移演练之前调用，API 需已启动。
 * 至少造：菜单（含菜品）、来访、资产 + 维护计划、维护记录（上海 00:30 完成，UTC 仍是前一天）。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';

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
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status} ${JSON.stringify(json?.error ?? json)}`);
  }
  return json?.data;
}

const session = await request('/auth/login', null, 'POST', { loginName: '爸爸', password: PASSWORD });
const token = session.accessToken;

// 菜单：一顿晚饭点两道菜
const dishes = await request('/dishes', token);
assert(dishes.length >= 2, '种子里要有菜品');
const menu = await request('/menus?date=2199-12-20&mealType=dinner', token);
if (!menu.items.length) {
  await request(`/menus/${menu.id}/items`, token, 'POST', {
    items: dishes.slice(0, 2).map((dish) => ({ dishId: dish.id })),
  });
}

// 来访
const guest = await request('/guests', token, 'POST', { name: '迁移演练客人' });
await request('/visits', token, 'POST', {
  title: '迁移演练来访',
  startsAt: '2199-12-20T11:00:00.000Z',
  endsAt: '2199-12-20T13:00:00.000Z',
  guestIds: [guest.id],
});

// 资产 + 维护计划 + 一条维护记录。上海 2026-01-16 00:30 = UTC 2026-01-15 16:30，
// 回填若按 UTC 截日会得到 15 日，按家庭时区应为 16 日。
const asset = await request('/assets', token, 'POST', {
  name: '迁移演练净水器',
  category: 'appliance',
  location: '厨房',
});
const plan = await request(`/assets/${asset.id}/maintenance-plans`, token, 'POST', {
  title: '迁移演练换滤芯',
  frequencyDays: 90,
  nextDueDate: '2026-01-20',
});
await request(`/maintenance-plans/${plan.id}/complete`, token, 'POST', {
  performedAt: '2026-01-15T16:30:00.000Z',
  note: '迁移演练',
  consumeInventory: false,
  idempotencyKey: `migration-fixture-${randomUUID()}`,
});

const details = await request(`/assets/${asset.id}`, token);
assert(details.maintenanceRecords.some((record) => record.performedOn === '2026-01-16'), '夹具维护记录按家庭日期落库');
console.log('  ✓ 迁移演练夹具：菜单、来访、资产与维护计划、维护记录已就绪');
