// I1 黑盒：位置字典与三处引用（docs/item-location-plan.md §3 I1 的清单）。
// 建树 → 第 4 层被拒 → 同层同名被拒 → 家人新建挂在「未整理」下、改不了别的 → 入库带位置 → 批次继承默认位置 →
// 改批次位置 → contents 聚合 → 资产「整理到位置」清掉旧文本 → 有引用的只能归档不能删 → 归档后不能再选 →
// 家里页 hasData（「未整理」不算）→ 跨家庭看不到、用不了。
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
  return response.body.data;
}

const db = new pg.Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});
await db.connect();

try {
  const ownerSession = await login('爸爸');
  const owner = ownerSession.accessToken;
  const member = (await login('妈妈')).accessToken;
  const tag = randomUUID().slice(0, 6);
  const create = (body, token = owner) => request('/locations', token, 'POST', body);
  const tree = async (token = owner, archived = false) =>
    (await request(`/locations${archived ? '?includeArchived=true' : ''}`, token)).body.data;
  const hasData = async (token = owner) =>
    (await request('/system/modules', token)).body.data.modules.find((one) => one.key === 'locations').hasData;

  console.log('1. 建树：房间 → 柜子 → 层格，三级到顶');
  const beforeAny = await hasData();
  const kitchen = (await create({ name: `厨房${tag}` })).body.data;
  const cabinet = (await create({ parentId: kitchen.id, name: '吊柜', kind: 'container' })).body.data;
  const shelf = (await create({ parentId: cabinet.id, name: '左' })).body.data;
  const storeroom = (await create({ name: `储物间${tag}` })).body.data;
  assert(
    kitchen.kind === 'room' && kitchen.depth === 1 && cabinet.kind === 'container' && cabinet.depth === 2 &&
      shelf.kind === 'slot' && shelf.depth === 3 && shelf.pathLabel === `厨房${tag} / 吊柜 / 左`,
    '房间 / 柜子 / 层格各一层，柜子下默认是层格；路径由服务端拼好',
  );
  const fourth = await create({ parentId: shelf.id, name: '最里面' });
  const slotUnderRoom = await create({ parentId: kitchen.id, name: '层', kind: 'slot' });
  const zone = (await create({ parentId: kitchen.id, name: '台面' })).body.data;
  const underZone = await create({ parentId: zone.id, name: '角落' });
  assert(
    fourth.status === 400 && slotUnderRoom.status === 400 && zone.kind === 'zone' && underZone.status === 400,
    '第 4 层被拒；层格不能直接放在房间下；区域（zone）下面不能再分',
  );
  const sameName = await create({ parentId: kitchen.id, name: '吊柜' });
  const sameRoot = await create({ name: `厨房${tag}` });
  const otherParent = await create({ parentId: storeroom.id, name: '吊柜', kind: 'container' });
  assert(
    sameName.status === 409 && sameRoot.status === 409 && otherParent.status === 201,
    '同一层同名被拒（房间和柜子都是）；不同上级下可以重名',
  );
  assert(!beforeAny && (await hasData()), '家里页 hasData：建了第一个位置才亮');

  console.log('2. 家人：在选择器里新建只能建叶子，挂在「未整理」下');
  const byMember = await create({ parentId: kitchen.id, name: `门后挂钩${tag}`, kind: 'container' }, member);
  const unsorted = (await tree(member)).find((one) => one.systemKey === 'unsorted');
  assert(
    byMember.status === 201 && byMember.body.data.kind === 'zone' && byMember.body.data.parentId === unsorted.id &&
      byMember.body.data.pathLabel === `未整理 / 门后挂钩${tag}`,
    '家人建的位置忽略上级和类型，一律是「未整理」下的区域',
  );
  const memberEdits = await Promise.all([
    request(`/locations/${kitchen.id}`, member, 'PATCH', { name: '改名' }),
    request(`/locations/${kitchen.id}/archive`, member, 'POST'),
    request(`/locations/${shelf.id}`, member, 'DELETE'),
  ]);
  assert(memberEdits.every((one) => one.status === 403), '家人改名、归档、删除都是 403');
  const moved = await request(`/locations/${byMember.body.data.id}`, owner, 'PATCH', { parentId: kitchen.id });
  const unsortedEdit = await request(`/locations/${unsorted.id}`, owner, 'PATCH', { name: '别的' });
  assert(
    moved.status === 200 && moved.body.data.pathLabel === `厨房${tag} / 门后挂钩${tag}` && unsortedEdit.status === 400,
    '管理员事后归位（挪到厨房下）；「未整理」本身不能改名',
  );
  const deepMove = await request(`/locations/${cabinet.id}`, owner, 'PATCH', { parentId: otherParent.body.data.id });
  const selfMove = await request(`/locations/${kitchen.id}`, owner, 'PATCH', { parentId: cabinet.id });
  assert(deepMove.status === 400 && selfMove.status === 400, '把带层格的柜子挪进另一个柜子会超过 3 层、把房间挪到自己下面：都被拒');

  console.log('3. 入库带位置、批次继承默认位置、改批次位置');
  const item = (
    await request('/inventory-items', owner, 'POST', {
      name: `酱油${tag}`, category: '调料', quantity: 3, unit: '瓶', lowStockThreshold: 1, restockQuantity: 2,
      defaultLocationId: shelf.id,
    })
  ).body.data;
  assert(item.defaultLocationId === shelf.id, '新建库存物品带默认位置');
  const inherited = (
    await request('/inventory-batches', owner, 'POST', { inventoryItemId: item.id, quantity: 1, idempotencyKey: `loc-${tag}-1` })
  ).body.data;
  const elsewhere = (
    await request('/inventory-batches', member, 'POST', {
      inventoryItemId: item.id, quantity: 1, idempotencyKey: `loc-${tag}-2`, locationId: storeroom.id,
    })
  ).body.data;
  const afterBatches = (await request('/inventory', owner)).body.data.find((one) => one.id === item.id);
  assert(
    inherited.locationId === shelf.id && inherited.locationUpdatedAt && elsewhere.locationId === storeroom.id &&
      afterBatches.defaultLocationId === shelf.id,
    '没指定的批次继承物品默认位置；第二批放储物间，物品默认位置不变',
  );
  const movedBatch = await request(`/inventory-batches/${inherited.id}/location`, member, 'PATCH', { locationId: cabinet.id });
  const clearedBatch = await request(`/inventory-batches/${elsewhere.id}/location`, member, 'PATCH', { locationId: null });
  assert(
    movedBatch.status === 200 && movedBatch.body.data.locationId === cabinet.id && movedBatch.body.data.version === inherited.version &&
      clearedBatch.body.data.locationId === null,
    '家人一跳改批次位置（不动乐观锁版本号），也能清掉',
  );
  await request(`/inventory-batches/${elsewhere.id}/location`, owner, 'PATCH', { locationId: storeroom.id });
  const bought = (await request('/shopping-items', owner, 'POST', { date: '2026-09-29', customName: `醋${tag}`, totalQty: 1, unit: '瓶' })).body.data;
  const vinegar = (
    await request('/inventory-items', owner, 'POST', {
      name: `醋${tag}`, category: '调料', quantity: 0, unit: '瓶', lowStockThreshold: 1, restockQuantity: 1,
    })
  ).body.data;
  await request(`/shopping-items/${bought.id}`, owner, 'PATCH', { checked: true });
  const received = await request(`/shopping-items/${bought.id}/confirm-stock`, member, 'POST', {
    inventoryItemId: vinegar.id, locationId: cabinet.id,
  });
  const vinegarAfter = (await request('/inventory', owner)).body.data.find((one) => one.id === vinegar.id);
  assert(
    received.status === 201 && vinegarAfter.defaultLocationId === cabinet.id,
    '购物清单入库选了位置（不分批）：记成物品的默认位置',
  );

  console.log('4. contents 聚合、资产「整理到位置」');
  const asset = (await request('/assets', owner, 'POST', { name: `微波炉${tag}`, category: 'appliance', location: '厨房台面上' })).body.data;
  const tidied = await request(`/assets/${asset.id}/location`, member, 'PATCH', { locationId: zone.id });
  assert(
    asset.location === '厨房台面上' && asset.locationId === null && tidied.status === 200 &&
      tidied.body.data.locationId === zone.id && tidied.body.data.location === null,
    '资产旧文本「整理到位置」：记上位置、旧文本清空',
  );
  const contents = (await request(`/locations/${kitchen.id}/contents`, member)).body.data;
  assert(
    contents.items.map((one) => one.id).sort().join() === [item.id, vinegar.id].sort().join() &&
      contents.batches.length === 1 && contents.batches[0].id === inherited.id && contents.batches[0].itemName === `酱油${tag}` &&
      contents.assets.length === 1 && contents.assets[0].id === asset.id,
    '厨房（含子位置）下：两样物品（默认位置）、一个批次（储物间那批不算）、一件资产',
  );
  const counts = new Map((await tree()).map((one) => [one.id, one.itemCount]));
  assert(counts.get(shelf.id) === 1 && counts.get(cabinet.id) === 2 && counts.get(storeroom.id) === 1, '每个位置直接放着几样（物品 + 批次 + 资产，不含子位置）');
  const found = (await request(`/locations/search?q=${encodeURIComponent('吊')}`, member)).body.data;
  assert(found.some((one) => one.id === cabinet.id && one.pathLabel === `厨房${tag} / 吊柜`), '按名字搜位置，带路径（⌘K 用）');

  console.log('5. 有引用的只能归档；归档后不能再选');
  const blocked = await request(`/locations/${shelf.id}`, owner, 'DELETE');
  const withChildren = await request(`/locations/${storeroom.id}`, owner, 'DELETE');
  const spare = (await create({ parentId: storeroom.id, name: `空格子${tag}`, kind: 'zone' })).body.data;
  const deleted = await request(`/locations/${spare.id}`, owner, 'DELETE');
  assert(
    blocked.status === 409 && withChildren.status === 409 && deleted.status === 200,
    '有东西记着的位置、下面还有位置的都删不了（409）；空的能删',
  );
  const archived = await request(`/locations/${cabinet.id}/archive`, owner, 'POST');
  const visible = await tree();
  const all = await tree(owner, true);
  const reuse = await request('/inventory-batches', owner, 'POST', {
    inventoryItemId: item.id, quantity: 0.5, idempotencyKey: `loc-${tag}-3`, locationId: shelf.id,
  });
  assert(
    archived.status === 201 && !visible.some((one) => one.id === cabinet.id || one.id === shelf.id) &&
      all.find((one) => one.id === shelf.id)?.archivedAt && reuse.status === 400,
    '归档柜子连同层格一起归档：选择器里不出现、管理页看得到；归档的位置不能再选（400）',
  );
  const itemStill = (await request('/inventory', owner)).body.data.find((one) => one.id === item.id);
  assert(itemStill.defaultLocationId === shelf.id, '归档不动东西的记录（「上次放在」照样在）');
  const reborn = await create({ parentId: kitchen.id, name: '吊柜', kind: 'container' });
  assert(reborn.status === 201, '归档的名字可以再用（同名只看没归档的）');

  console.log('6. 跨家庭');
  const other = await createModuleHousehold(db);
  const otherTree = (await request('/locations', other.token)).body.data;
  const otherUse = await request('/inventory-items', other.token, 'POST', {
    name: `别家${tag}`, category: '其他', quantity: 1, unit: '个', lowStockThreshold: 0, restockQuantity: 1, defaultLocationId: kitchen.id,
  });
  const otherPeek = await request(`/locations/${kitchen.id}/contents`, other.token);
  const otherBatch = await request(`/inventory-batches/${inherited.id}/location`, other.token, 'PATCH', { locationId: null });
  const otherAsset = await request(`/assets/${asset.id}/location`, other.token, 'PATCH', { locationId: null });
  assert(
    otherTree.length === 0 && otherUse.status === 404 && otherPeek.status === 404 && otherBatch.status === 404 && otherAsset.status === 404,
    '另一个家庭：位置树是空的；引用、查看内容、改别家批次 / 资产的位置都是 404',
  );
  const onlyUnsorted = await createModuleHousehold(db, 'member');
  await request('/locations', onlyUnsorted.token, 'POST', { name: '随手放' });
  assert(!(await hasData(onlyUnsorted.token)), '只有家人建在「未整理」下的位置：家里页 hasData 仍是 false');
} finally {
  await db.end();
}

console.log('\n位置字典黑盒全部通过');
