// 地图编辑器 v2 第 4 笔黑盒：拆分 / 合并房间（docs/ui-prototypes/map-editor-v2.md §2.3、§2.4，拍板 2、3）。
// 拆：原房间留一块（原名原 id），另一块建成新房间，画在图上的柜子按中心点、装饰按中心点跟过去，直接记在原房间上的东西不动。
// 合：子位置挪到目标（重名加「 2」）、物品 / 批次 / 资产改记到目标、装饰跟着走、被并房间归档、目标换形状。只管理员；跨家庭 404。
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createModuleHousehold } from './system-modules-fixtures.mjs';

const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', { loginName, password: PASSWORD });
  if (response.status !== 201) throw new Error(`${loginName} 登录失败 ${response.status}`);
  return response.body.data.accessToken;
}

const box = (x1, y1, x2, y2) => ({ type: 'polygon', points: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]] });

const db = new pg.Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});
await db.connect();

try {
  const owner = await login('爸爸');
  const member = await login('妈妈');
  const tag = randomUUID().slice(0, 6);
  const all = async () => (await request('/locations?includeArchived=true', owner)).body.data;
  const find = async (id) => (await all()).find((one) => one.id === id);
  const post = (path, body, token = owner) => request(path, token, 'POST', body);

  console.log('0. 准备：一间客厅（400 × 300），左右各一个柜子、一个没上图的柜子、一件记在客厅上的东西、右边一张沙发');
  if ((await request('/map', owner)).body.data === null) await request('/map', owner, 'PUT', { viewBox: { w: 1000, h: 1000 } });
  const living = (await post('/locations', { name: `客厅${tag}` })).body.data;
  await request(`/locations/${living.id}/shape`, owner, 'PATCH', { mapShape: box(100, 100, 500, 400) });
  const left = (await post('/locations', { parentId: living.id, name: '柜子', kind: 'container' })).body.data;
  const right = (await post('/locations', { parentId: living.id, name: '电视柜', kind: 'container' })).body.data;
  const loose = (await post('/locations', { parentId: living.id, name: '杂物', kind: 'container' })).body.data;
  await request(`/locations/${left.id}/shape`, owner, 'PATCH', { mapShape: { type: 'rect', x: 120, y: 120, w: 60, h: 40 } });
  await request(`/locations/${right.id}/shape`, owner, 'PATCH', { mapShape: { type: 'rect', x: 400, y: 300, w: 60, h: 40 } });
  const item = (
    await post('/inventory-items', {
      name: `纸巾${tag}`, category: '其他', quantity: 3, unit: '包', lowStockThreshold: 0, restockQuantity: 3, defaultLocationId: living.id,
    })
  ).body.data;
  const map = (await request('/map', owner)).body.data;
  const sofa = { id: randomUUID(), kind: 'sofa', roomId: living.id, x: 420, y: 150, w: 60, h: 40 };
  const others = map.decorations.filter((one) => one.roomId !== living.id);
  await request('/map/decorations', owner, 'PUT', { version: map.decorationsVersion, items: [...others, sofa] });

  console.log('1. 拆分：x = 300 竖着切，左边留给客厅，右边建成餐厅');
  const splitBody = { shape: box(100, 100, 300, 400), newRoom: { name: `餐厅${tag}`, shape: box(300, 100, 500, 400) } };
  const memberSplit = await post(`/locations/${living.id}/split`, splitBody, member);
  const containerSplit = await post(`/locations/${left.id}/split`, splitBody);
  const flat = await post(`/locations/${living.id}/split`, { ...splitBody, shape: { type: 'polygon', points: [[0, 0], [50, 50], [100, 100]] } });
  const taken = await post(`/locations/${living.id}/split`, { ...splitBody, newRoom: { ...splitBody.newRoom, name: `客厅${tag}` } });
  assert(memberSplit.status === 403 && containerSplit.status === 400 && flat.status === 400 && taken.status === 409, '家人 403；柜子不能拆 400；形状压成一条线 400；新房间重名 409');
  const split = await post(`/locations/${living.id}/split`, splitBody);
  const dining = split.body.data?.created;
  assert(
    split.status === 201 && split.body.data.room.id === living.id && split.body.data.room.name === `客厅${tag}` &&
      dining?.name === `餐厅${tag}` && dining.kind === 'room' && split.body.data.movedLocations === 1,
    '原房间留原名原 id，新房间建成；跟过去的柜子有 1 个',
  );
  const [leftAfter, rightAfter, looseAfter, livingAfter] = await Promise.all([left, right, loose, living].map((one) => find(one.id)));
  assert(
    leftAfter.parentId === living.id && rightAfter.parentId === dining.id && rightAfter.pathLabel === `餐厅${tag} / 电视柜` &&
      looseAfter.parentId === living.id && livingAfter.mapShape.points.every(([x]) => x <= 300),
    '中心点在右边的电视柜挪到餐厅；左边的柜子、没上图的柜子留在客厅；客厅形状换成左半边',
  );
  const itemAfter = (await db.query('SELECT "defaultLocationId" FROM inventory_items WHERE id = $1', [item.id])).rows[0];
  const decorAfter = (await request('/map', owner)).body.data.decorations.find((one) => one.id === sofa.id);
  assert(itemAfter.defaultLocationId === living.id && decorAfter.roomId === dining.id, '直接记在客厅上的纸巾不动；右边的沙发跟到餐厅');

  console.log('2. 合并：餐厅并回客厅（餐厅里也有一个「柜子」→ 并过去叫「柜子 2」）');
  const clash = (await post('/locations', { parentId: dining.id, name: '柜子', kind: 'container' })).body.data;
  const batch = (await post('/inventory-batches', { inventoryItemId: item.id, quantity: 1, idempotencyKey: `rooms-${tag}`, locationId: dining.id })).body.data;
  const asset = (await post('/assets', { name: `音箱${tag}`, category: 'electronics' })).body.data;
  await request(`/assets/${asset.id}/location`, owner, 'PATCH', { locationId: dining.id });
  const mergeBody = { intoId: living.id, shape: box(100, 100, 500, 400) };
  const memberMerge = await post(`/locations/${dining.id}/merge`, mergeBody, member);
  const self = await post(`/locations/${living.id}/merge`, mergeBody);
  const intoContainer = await post(`/locations/${dining.id}/merge`, { ...mergeBody, intoId: left.id });
  assert(memberMerge.status === 403 && self.status === 400 && intoContainer.status === 400, '家人 403；并进自己 400；并进柜子 400');
  const merged = await post(`/locations/${dining.id}/merge`, mergeBody);
  assert(
    merged.status === 201 && merged.body.data.room.id === living.id && merged.body.data.room.mapShape.points.length === 4 &&
      merged.body.data.moved.locations === 2 && merged.body.data.moved.batches === 1 && merged.body.data.moved.assets === 1,
    '并成功：目标换成合并后的形状；挪了 2 个柜子、1 个批次、1 件资产',
  );
  const [diningAfter, clashAfter, rightFinal] = await Promise.all([dining, clash, right].map((one) => find(one.id)));
  const batchAfter = (await db.query('SELECT "locationId" FROM inventory_batches WHERE id = $1', [batch.id])).rows[0];
  const assetAfter = (await db.query('SELECT "locationId" FROM home_assets WHERE id = $1', [asset.id])).rows[0];
  const sofaFinal = (await request('/map', owner)).body.data.decorations.find((one) => one.id === sofa.id);
  assert(
    Boolean(diningAfter.archivedAt) && diningAfter.mapShape === null && clashAfter.parentId === living.id && clashAfter.name === '柜子 2' &&
      rightFinal.parentId === living.id && batchAfter.locationId === living.id && assetAfter.locationId === living.id && sofaFinal.roomId === living.id,
    '餐厅归档、从图上消失；重名的柜子改叫「柜子 2」；批次、资产、沙发都改记到客厅',
  );
  const again = await post(`/locations/${dining.id}/merge`, mergeBody);
  assert(again.status === 400, '归档的房间不能再并');

  console.log('3. 跨家庭');
  const fresh = await createModuleHousehold(db);
  const otherSplit = await post(`/locations/${living.id}/split`, splitBody, fresh.token);
  const otherMerge = await post(`/locations/${left.id}/merge`, mergeBody, fresh.token);
  assert(otherSplit.status === 404 && otherMerge.status === 404, '另一个家庭：拆 / 合这边的房间都是 404');
  console.log('\n拆分 / 合并房间黑盒全部通过');
} finally {
  await db.end();
}
