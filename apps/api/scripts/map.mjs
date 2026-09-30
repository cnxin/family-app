// I2 黑盒：家庭地图与形状（docs/item-location-plan.md §2.2、§2.4、§3 I2）。
// 地图建 / 改只有管理员 → 形状校验（polygon ≥ 3 点、坐标在 viewBox 内、柜子是矩形且在房间内、层格不上图）→
// 底图上传（只收真图片、≤ 2 MB、要登录才能取）→ 换比例要显式清形状 → 按物品名找「上次放在」→ 跨家庭看不到。
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
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

async function upload(token, bytes, type, name = 'map.png') {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  const response = await fetch(`${BASE}/map/background`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', { loginName, password: PASSWORD });
  if (response.status !== 201) throw new Error(`${loginName} 登录失败 ${response.status}`);
  return response.body.data.accessToken;
}

/** 最小的合法 PNG（width × height，全白），不引图像库 */
function png(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 3 + 1) * height, 0xff);
  for (let y = 0; y < height; y += 1) rows[y * (width * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
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
  const owner = await login('爸爸');
  const member = await login('妈妈');
  const tag = randomUUID().slice(0, 6);
  const shape = (id, mapShape, token = owner) => request(`/locations/${id}/shape`, token, 'PATCH', { mapShape });
  const locationOf = async (id) => (await request('/locations', owner)).body.data.find((one) => one.id === id);

  console.log('1. 地图：没导入过是 null；建 / 改只有管理员');
  const fresh = await createModuleHousehold(db);
  const none = await request('/map', fresh.token);
  const room = (await request('/locations', owner, 'POST', { name: `客厅${tag}` })).body.data;
  const early = await shape(room.id, { type: 'polygon', points: [[0, 0], [100, 0], [100, 100]] });
  const memberPut = await request('/map', member, 'PUT', { viewBox: { w: 1000, h: 1083 } });
  const put = await request('/map', owner, 'PUT', { viewBox: { w: 1000, h: 1083 } });
  const badBox = await request('/map', owner, 'PUT', { viewBox: { w: 800, h: 1083 } });
  const seen = await request('/map', member);
  assert(none.status === 200 && none.body.data === null, '没导入过地图：GET /map 是 null');
  assert(early.status === 400, '还没有地图时不能画形状（400）');
  assert(
    memberPut.status === 403 && put.status === 200 && put.body.data.title === '家' && put.body.data.viewBox.h === 1083 &&
      put.body.data.hasBackground === false && badBox.status === 400 && seen.body.data.id === put.body.data.id,
    '家人建地图 403；管理员建成（标题默认「家」、宽固定 1000）；宽不是 1000 被拒；家人能看',
  );

  console.log('2. 形状校验');
  const roomShape = { type: 'polygon', points: [[100, 100], [500, 100], [500, 300], [300, 300], [300, 500], [100, 500]] };
  const cabinet = (await request('/locations', owner, 'POST', { parentId: room.id, name: '电视柜', kind: 'container' })).body.data;
  const slot = (await request('/locations', owner, 'POST', { parentId: cabinet.id, name: '第二层' })).body.data;
  const beforeRoom = await shape(cabinet.id, { type: 'rect', x: 120, y: 120, w: 80, h: 40 });
  const okRoom = await shape(room.id, roomShape);
  const twoPoints = await shape(room.id, { type: 'polygon', points: [[0, 0], [10, 10]] });
  const outside = await shape(room.id, { type: 'polygon', points: [[0, 0], [1001, 0], [0, 50]] });
  const tooTall = await shape(room.id, { type: 'rect', x: 0, y: 1000, w: 10, h: 100 });
  const flat = await shape(room.id, { type: 'polygon', points: [[0, 0], [50, 50], [100, 100]] });
  const fraction = await shape(room.id, { type: 'polygon', points: [[0.5, 0], [10, 0], [10, 10]] });
  assert(beforeRoom.status === 400, '房间还没上图时，柜子不能画（400）');
  assert(
    okRoom.status === 200 && okRoom.body.data.mapShape.points.length === 6 &&
      [twoPoints, outside, tooTall, flat, fraction].every((one) => one.status === 400),
    '房间画成 L 形多边形；不足 3 点、出了 viewBox（x > 1000 / y + h > 高）、三点共线、小数坐标都被拒',
  );
  const polygonCabinet = await shape(cabinet.id, roomShape);
  const outsideRoom = await shape(cabinet.id, { type: 'rect', x: 520, y: 120, w: 40, h: 40 });
  const inNotch = await shape(cabinet.id, { type: 'rect', x: 380, y: 380, w: 60, h: 60 });
  const slotShape = await shape(slot.id, { type: 'rect', x: 120, y: 120, w: 10, h: 10 });
  const memberShape = await shape(cabinet.id, { type: 'rect', x: 120, y: 120, w: 80, h: 40 }, member);
  const okCabinet = await shape(cabinet.id, { type: 'rect', x: 120, y: 120, w: 80, h: 40 });
  assert(
    polygonCabinet.status === 400 && outsideRoom.status === 400 && inNotch.status === 400 && slotShape.status === 400 &&
      memberShape.status === 403 && okCabinet.status === 200 && okCabinet.body.data.mapShape.w === 80,
    '柜子只能是矩形、要在房间里（外接框外、L 形缺口里都拒）；层格不上图；家人改不了形状（403）',
  );
  const listed = await locationOf(cabinet.id);
  const slotListed = await locationOf(slot.id);
  assert(listed.mapShape?.type === 'rect' && slotListed.mapShape === null, '位置树里带 mapShape（层格永远 null）');
  const cleared = await shape(cabinet.id, null);
  await shape(cabinet.id, { type: 'rect', x: 120, y: 120, w: 80, h: 40 });
  assert(cleared.status === 200 && cleared.body.data.mapShape === null, 'null = 从地图上拿掉（位置本身不动）');
  const archived = (await request('/locations', owner, 'POST', { parentId: room.id, name: `旧柜${tag}`, kind: 'container' })).body.data;
  await request(`/locations/${archived.id}/archive`, owner, 'POST');
  const archivedShape = await shape(archived.id, { type: 'rect', x: 120, y: 200, w: 20, h: 20 });
  assert(archivedShape.status === 400, '归档的位置不能再画');

  console.log('3. 底图：只收真图片，≤ 2 MB，要登录才能取');
  const image = png(40, 43);
  const memberUpload = await upload(member, image, 'image/png');
  const fake = await upload(owner, Buffer.from('not really a png'), 'image/png');
  const pdf = await upload(owner, Buffer.from('%PDF-1.4'), 'application/pdf', 'x.pdf');
  const huge = await upload(owner, Buffer.concat([image, Buffer.alloc(2 * 1024 * 1024)]), 'image/png');
  const uploaded = await upload(owner, image, 'image/png');
  assert(
    memberUpload.status === 403 && fake.status === 400 && pdf.status === 400 && huge.status === 413 &&
      uploaded.status === 201 && uploaded.body.data.hasBackground === true,
    '家人传 403；冒充 PNG 的文本、PDF 400；超 2 MB 413；管理员传成',
  );
  const fetched = await fetch(`${BASE}/map/background`, { headers: { Authorization: `Bearer ${member}` } });
  const bytes = Buffer.from(await fetched.arrayBuffer());
  const anonymous = await fetch(`${BASE}/map/background`);
  const [{ backgroundFile, householdId }] = (
    await db.query(`SELECT "backgroundFile", "householdId" FROM household_maps WHERE id = $1`, [put.body.data.id])
  ).rows;
  const leaked = await fetch(`${BASE}/uploads/.private/maps/${householdId}/${backgroundFile}`);
  assert(
    fetched.status === 200 && fetched.headers.get('content-type') === 'image/png' && bytes.equals(image) &&
      anonymous.status === 401 && leaked.status === 404,
    '家人能取底图（原样字节）；没登录 401；公开 /uploads 取不到私有目录',
  );
  const replaced = await upload(owner, png(20, 22), 'image/png');
  const [{ backgroundFile: next }] = (await db.query(`SELECT "backgroundFile" FROM household_maps WHERE id = $1`, [put.body.data.id])).rows;
  assert(replaced.status === 201 && next !== backgroundFile, '再传一张就换掉（旧文件删掉）');

  console.log('4. 换比例要显式清形状');
  const reshaped = await request('/map', owner, 'PUT', { viewBox: { w: 1000, h: 900 } });
  const sameRatio = await request('/map', owner, 'PUT', { title: '我家', viewBox: { w: 1000, h: 1083 } });
  assert(
    reshaped.status === 409 && sameRatio.status === 200 && sameRatio.body.data.title === '我家' &&
      (await locationOf(room.id)).mapShape !== null,
    '比例变了不带 clearShapes：409；比例不变改标题：形状都在',
  );
  const reset = await request('/map', owner, 'PUT', { viewBox: { w: 1000, h: 900 }, clearShapes: true });
  assert(
    reset.status === 200 && reset.body.data.viewBox.h === 900 && (await locationOf(room.id)).mapShape === null &&
      (await locationOf(cabinet.id)).mapShape === null && reset.body.data.hasBackground,
    '带 clearShapes：比例换了，房间和柜子的形状清空（位置本身、底图都在）',
  );

  console.log('5. 按物品名找「上次放在」');
  const item = (
    await request('/inventory-items', owner, 'POST', {
      name: `遥控器电池${tag}`, category: '其他', quantity: 4, unit: '节', lowStockThreshold: 0, restockQuantity: 4,
      defaultLocationId: cabinet.id,
    })
  ).body.data;
  const batch = (
    await request('/inventory-batches', owner, 'POST', {
      inventoryItemId: item.id, quantity: 2, idempotencyKey: `map-${tag}`, locationId: slot.id,
    })
  ).body.data;
  const asset = (await request('/assets', owner, 'POST', { name: `投影仪${tag}`, category: 'electronics' })).body.data;
  await request(`/assets/${asset.id}/location`, owner, 'PATCH', { locationId: cabinet.id });
  const hits = (await request(`/locations/find?q=${encodeURIComponent(`电池${tag}`)}`, member)).body.data;
  const batchHit = hits.find((one) => one.type === 'batch');
  const itemHit = hits.find((one) => one.type === 'item');
  assert(
    batchHit?.id === batch.id && batchHit.pathLabel === `客厅${tag} / 电视柜 / 第二层` && batchHit.roomId === room.id &&
      batchHit.detail?.startsWith('2 节') && batchHit.placedOn === batch.receivedOn &&
      itemHit?.locationId === cabinet.id && itemHit.inventoryItemId === item.id,
    '家人搜物品：批次带路径、所在房间、数量和入库日；物品默认位置（在别处）另成一条',
  );
  const assetHits = (await request(`/locations/find?q=${encodeURIComponent(`投影仪${tag}`)}`, member)).body.data;
  const wildcard = (await request(`/locations/find?q=${encodeURIComponent('%')}`, member)).body.data;
  const empty = await request('/locations/find?q=', member);
  assert(
    assetHits.length === 1 && assetHits[0].type === 'asset' && assetHits[0].inventoryItemId === null &&
      wildcard.every((one) => one.name.includes('%')) && empty.status === 400,
    '资产也能找；% 按字面匹配、不当通配；空关键词 400',
  );

  console.log('6. 导出（I2c）');
  const finalImage = png(20, 22);
  await upload(owner, finalImage, 'image/png');
  await shape(room.id, roomShape);
  await shape(cabinet.id, { type: 'rect', x: 120, y: 120, w: 80, h: 40 });
  const memberExport = await request('/map/export', member);
  const exported = await request('/map/export', owner);
  const noMap = await request('/map/export', fresh.token);
  const data = exported.body.data;
  const roomRow = data.locations.find((one) => one.id === room.id);
  const slotRow = data.locations.find((one) => one.id === slot.id);
  const archivedRow = data.locations.find((one) => one.id === archived.id);
  assert(
    memberExport.status === 403 && exported.status === 200 && noMap.status === 404 &&
      data.map.id === put.body.data.id && data.map.viewBox.h === 900,
    '导出只给管理员（家人 403）；没地图 404；带上地图本身',
  );
  assert(
    roomRow?.mapShape?.points.length === 6 && roomRow.pathLabel === `客厅${tag}` && slotRow?.mapShape === null &&
      slotRow.pathLabel === `客厅${tag} / 电视柜 / 第二层` && Boolean(archivedRow?.archivedAt),
    '所有位置都在（含归档的），带路径和形状，层格形状为 null',
  );
  assert(
    data.background?.contentType === 'image/png' && Buffer.from(data.background.base64, 'base64').equals(finalImage),
    '底图原样导出（base64，字节一致）',
  );

  console.log('6b. 家具库（地图编辑器 v2 §3）：收纳类是带图标的柜子，装饰类整列存在地图上');
  const wardrobe = await request('/locations', owner, 'POST', { parentId: room.id, name: `衣柜${tag}`, kind: 'container', icon: 'wardrobe' });
  const badIcon = await request('/locations', owner, 'POST', { parentId: room.id, name: `怪柜${tag}`, kind: 'container', icon: 'sofa' });
  assert(
    wardrobe.status === 201 && wardrobe.body.data.icon === 'wardrobe' && badIcon.status === 400,
    '收纳类家具 = 带 icon 的柜子；装饰类的键（sofa）不能当柜子图标（400）',
  );
  const turnedShape = await shape(wardrobe.body.data.id, { type: 'rect', x: 120, y: 300, w: 40, h: 60, rotation: 90 });
  const badTurn = await shape(wardrobe.body.data.id, { type: 'rect', x: 120, y: 300, w: 40, h: 60, rotation: 45 });
  assert(turnedShape.status === 200 && turnedShape.body.data.mapShape.rotation === 90 && badTurn.status === 400, '家具朝向只收 0 / 90 / 180 / 270');
  const current = (await request('/map', owner)).body.data;
  assert(Array.isArray(current.decorations) && typeof current.decorationsVersion === 'number' && current.backgroundKey, '地图带装饰列表、版本号和底图键');
  const sofa = { id: randomUUID(), kind: 'sofa', roomId: room.id, x: 200, y: 400, w: 90, h: 200, rotation: 90 };
  const bed = { id: randomUUID(), kind: 'bed', roomId: null, x: 600, y: 600, w: 150, h: 200 };
  const memberDecor = await request('/map/decorations', member, 'PUT', { version: current.decorationsVersion, items: [sofa] });
  const savedDecor = await request('/map/decorations', owner, 'PUT', { version: current.decorationsVersion, items: [sofa, bed] });
  const stale = await request('/map/decorations', owner, 'PUT', { version: current.decorationsVersion, items: [] });
  const offMap = await request('/map/decorations', owner, 'PUT', {
    version: current.decorationsVersion + 1, items: [{ ...bed, y: 850, h: 100 }],
  });
  const dupe = await request('/map/decorations', owner, 'PUT', { version: current.decorationsVersion + 1, items: [bed, bed] });
  const foreignRoom = await request('/map/decorations', owner, 'PUT', {
    version: current.decorationsVersion + 1, items: [{ ...sofa, roomId: randomUUID() }],
  });
  const storageKind = await request('/map/decorations', owner, 'PUT', {
    version: current.decorationsVersion + 1, items: [{ ...bed, kind: 'wardrobe' }],
  });
  const afterDecor = (await request('/map', member)).body.data;
  assert(memberDecor.status === 403, '家人摆不了装饰（403）');
  assert(
    savedDecor.status === 200 && savedDecor.body.data.decorationsVersion === current.decorationsVersion + 1 &&
      afterDecor.decorations.length === 2 && afterDecor.decorations[0].rotation === 90 &&
      afterDecor.backgroundKey === current.backgroundKey,
    '管理员整列保存装饰：版本 +1、家人能看到、底图键不变（不用重下图片）',
  );
  assert(stale.status === 409, '版本对不上 409（别的设备刚改过，不静默覆盖）');
  assert(
    [offMap, dupe, foreignRoom, storageKind].every((one) => one.status === 400),
    '出了图、id 重复、房间不是本家的、收纳类键当装饰：都 400',
  );

  const reimport = await request('/map', owner, 'PUT', { viewBox: { w: 1000, h: 1083 }, clearShapes: true });
  assert(
    reimport.status === 200 && reimport.body.data.decorations.length === 0 &&
      reimport.body.data.decorationsVersion === savedDecor.body.data.decorationsVersion + 1,
    '重新导入（clearShapes）连装饰一起清，版本 +1',
  );

  console.log('7. 跨家庭');
  const otherMap = await request('/map', fresh.token);
  const otherBackground = await fetch(`${BASE}/map/background`, { headers: { Authorization: `Bearer ${fresh.token}` } });
  const otherShape = await shape(room.id, roomShape, fresh.token);
  const otherDecor = await request('/map/decorations', fresh.token, 'PUT', { version: 0, items: [] });
  const otherFind = (await request(`/locations/find?q=${encodeURIComponent(`电池${tag}`)}`, fresh.token)).body.data;
  assert(
    otherMap.body.data === null && otherBackground.status === 404 && otherDecor.status === 404 && [403, 404].includes(otherShape.status) && otherFind.length === 0,
    '另一个家庭：看不到这张地图和底图、改不了这边的形状和装饰、搜不到这边的东西',
  );
  console.log('\n家庭地图黑盒全部通过');
} finally {
  await db.end();
}
