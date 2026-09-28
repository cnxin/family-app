// H3 E1 智能家居黑盒：连接设置（只写不读、服务器默认的令牌文件不存在）、连通性测试、实体目录
// （门锁 / 安防 / 不支持的 domain 不列）、白名单增改删与权限、状态快照只含白名单、HA 挂了或不回时
// 3 秒内给出「连不上」且别的接口照常、家里页 hasData、跨家庭隔离。对面是 fake-ha.mjs。
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { startFakeHomeAssistant } from './fake-ha.mjs';
import { cleanModuleHousehold, createModuleHousehold } from './system-modules-fixtures.mjs';

const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const TOKEN = `ha-long-lived-${randomUUID()}`;

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
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', { loginName, password: PASSWORD });
  if (response.status !== 201) throw new Error(`${loginName} 登录失败 ${response.status}`);
  return response.body.data.accessToken;
}

async function smartHomeHasData(token) {
  const result = await request('/system/modules', token);
  return result.body.data.modules.find((row) => row.key === 'smart-home').hasData;
}

const db = new pg.Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});
await db.connect();
const ha = await startFakeHomeAssistant({ token: TOKEN });
const fixtures = [];

try {
  const owner = await login('爸爸');
  const member = await login('妈妈');

  console.log('1. 连接设置：服务器默认、权限、只写不读');
  const initial = await request('/smart-home/connector-settings', owner);
  assert(
    initial.status === 200 &&
      initial.body.data.mode === 'server_default' &&
      initial.body.data.credentialConfigured === false &&
      initial.body.data.configured === false,
    '服务器默认的令牌文件还不存在：显示「没配」，不报错',
  );
  const forbidden = await Promise.all([
    request('/smart-home/connector-settings', member),
    request('/smart-home/connector-settings', member, 'PUT', { baseUrl: ha.url }),
    request('/smart-home/entity-directory', member),
    request('/smart-home/devices/cover.living_room_curtain', member, 'PUT', { displayName: '窗帘' }),
  ]);
  assert(forbidden.every((one) => one.status === 403), '普通成员读不了设置、改不了连接、看不了目录、动不了白名单');
  const unconfiguredStates = await request('/smart-home/states', member);
  assert(
    unconfiguredStates.status === 200 &&
      unconfiguredStates.body.data.connection.configured === false &&
      unconfiguredStates.body.data.devices.length === 0,
    '没配时状态接口照常返回「没连上」',
  );

  const badUrls = await Promise.all(
    ['ftp://127.0.0.1', 'http://user:pass@127.0.0.1:8123', 'not a url'].map((baseUrl) =>
      request('/smart-home/connector-settings', owner, 'PUT', { baseUrl }),
    ),
  );
  assert(badUrls.every((one) => one.status === 400), '地址必须是完整的 http(s) 且不带用户名密码');
  const shortToken = await request('/smart-home/connector-settings', owner, 'PUT', { baseUrl: ha.url, credential: 'short' });
  const both = await request('/smart-home/connector-settings', owner, 'PUT', { credential: TOKEN, clearCredential: true });
  assert(shortToken.status === 400 && both.status === 400, '令牌太短、同时填写和清除都被拒');

  const saved = await request('/smart-home/connector-settings', owner, 'PUT', {
    baseUrl: `${ha.url}/some/path?x=1`,
    credential: TOKEN,
  });
  const row = await db.query(
    `SELECT s."credentialEncrypted" FROM integrations i JOIN integration_secrets s ON s."integrationId" = i.id
     WHERE i.kind = 'home_assistant' AND i."householdId" = (SELECT "householdId" FROM members WHERE name = '爸爸' LIMIT 1)`,
  );
  assert(
    saved.status === 200 &&
      saved.body.data.mode === 'household' &&
      saved.body.data.configured === true &&
      saved.body.data.baseUrl === ha.url &&
      saved.body.data.credentialHint === `****${TOKEN.slice(-4)}` &&
      !saved.text.includes(TOKEN),
    '保存后是家庭设置：地址去掉路径，令牌只回提示',
  );
  assert(row.rows.length === 1 && !row.rows[0].credentialEncrypted.includes(TOKEN), '令牌加密存库');

  console.log('2. 连通性测试');
  const tested = await request('/smart-home/connector-settings/test', owner, 'POST');
  assert(
    tested.status === 201 && tested.body.data.available === true && tested.body.data.version === '2026.9.4',
    `测通：${tested.body.data.message}`,
  );
  assert(
    ha.requests.every((one) => one.authorization === `Bearer ${TOKEN}`),
    '对 HA 的每个请求都带长期令牌（Authorization 请求头）',
  );
  await request('/smart-home/connector-settings', owner, 'PUT', { credential: `wrong-${TOKEN}` });
  const wrong = await request('/smart-home/connector-settings/test', owner, 'POST');
  assert(wrong.body.data.available === false && wrong.body.data.message === '令牌无效或权限不足', '令牌不对时说清楚');
  await request('/smart-home/connector-settings', owner, 'PUT', { credential: TOKEN });

  console.log('3. 实体目录（按设备分组）');
  const directory = await request('/smart-home/entity-directory', owner);
  const groups = directory.body.data.devices;
  const ids = groups.flatMap((device) => device.entities.map((entity) => entity.entityId));
  const byDevice = Object.fromEntries(groups.map((device) => [device.name, device]));
  assert(
    directory.status === 200 &&
      directory.body.data.connection.available &&
      directory.body.data.grouped === true &&
      ['Roborock S8', '客厅窗帘', '厨下净水', '没有归属设备的'].every((name) => name in byDevice),
    `经 WebSocket 读三张注册表，按设备分组：${groups.map((device) => device.name).join(' / ')}`,
  );
  assert(
    byDevice['客厅窗帘'].area === '客厅' && byDevice['厨下净水'].area === '厨房' && byDevice['客厅窗帘'].manufacturer === 'Xiaomi',
    '设备带 HA 里的区域名（设备改过名的用改后的名字）',
  );
  assert(
    groups[groups.length - 1].id === null && groups[0].area === '厨房' && groups[1].area === '客厅',
    '按区域名排（厨房、客厅），没有归属设备的放最后',
  );
  const purifier = byDevice['厨下净水'].entities;
  const primaryOf = (device) => device.entities.filter((entity) => entity.primary).map((entity) => entity.entityId);
  assert(
    JSON.stringify(primaryOf(byDevice['Roborock S8']).sort()) ===
      JSON.stringify(['sensor.roborock_s8_cleaning_area', 'vacuum.roborock_s8']) &&
      JSON.stringify(primaryOf(byDevice['客厅窗帘'])) === JSON.stringify(['cover.living_room_curtain']) &&
      primaryOf(byDevice['厨下净水']).length === 3 &&
      purifier.filter((entity) => !entity.primary).every((entity) => entity.category === 'diagnostic'),
    '主实体：本体 + 非诊断 / 配置的传感器；diagnostic、config（含配置类的开关）一律不算主实体',
  );
  assert(
    purifier[0].primary &&
      !purifier[purifier.length - 1].primary &&
      byDevice['Roborock S8'].entities[0].entityId === 'vacuum.roborock_s8',
    '设备内主实体排在前面，本体排在它的传感器前面',
  );
  const expiring = purifier.find((entity) => entity.entityId === 'binary_sensor.kitchen_purifier_ro_expiring');
  const vacuumEntry = byDevice['Roborock S8'].entities.find((entity) => entity.entityId === 'vacuum.roborock_s8');
  assert(
    expiring.name === 'RO到期预警' && expiring.fullName === '厨下净水 RO到期预警' && vacuumEntry.name === 'Roborock S8',
    '实体名去掉设备名前缀（「厨下净水 RO到期预警」→「RO到期预警」），本体实体保留设备名',
  );
  assert(
    !ids.some((id) => /^(lock|alarm_control_panel|person|sun)\./.test(id)),
    '门锁、安防、人员位置、不支持的 domain 都不列',
  );
  assert(!directory.text.includes('latitude'), '不透传整份 attributes（位置之类）');
  assert(
    ha.requests.some((one) => one.method === 'WS' && one.path === '/api/websocket'),
    '注册表走 HA 的 WebSocket（/api/websocket，同一个长期令牌鉴权）',
  );

  ha.websocket = false;
  const flat = await request('/smart-home/entity-directory', owner);
  ha.websocket = true;
  assert(
    flat.status === 200 &&
      flat.body.data.grouped === false &&
      flat.body.data.groupingMessage.startsWith('没读到设备信息') &&
      flat.body.data.devices.length === 1 &&
      flat.body.data.devices[0].entities.length === ids.length,
    'WebSocket 读不到时退回一组平铺，并说明原因',
  );

  console.log('4. 白名单');
  const blocked = await Promise.all([
    request('/smart-home/devices/lock.front_door', owner, 'PUT', { displayName: '大门' }),
    request('/smart-home/devices/alarm_control_panel.home', owner, 'PUT', { displayName: '安防' }),
    request('/smart-home/devices/person.dad', owner, 'PUT', { displayName: '爸爸' }),
    request('/smart-home/devices/Not-An-Entity', owner, 'PUT', { displayName: '坏 ID' }),
    request('/smart-home/devices/cover.living_room_curtain', owner, 'PUT', { displayName: '' }),
  ]);
  assert(blocked.every((one) => one.status === 400), '门锁、安防、不支持的 domain、坏 ID、空名字都进不了白名单');
  await assertDbRejectsLock();

  assert((await smartHomeHasData(owner)) === false, '连上了但白名单为空：家里页还不显示智能家居');
  const added = [];
  for (const [entityId, displayName, area] of [
    ['vacuum.roborock_s8', '扫地机', '客厅'],
    ['cover.living_room_curtain', '客厅窗帘', '客厅'],
    ['sensor.kitchen_purifier_tds', '出水TDS', '厨房'],
    ['sensor.kitchen_purifier_ro_filter_life', 'RO滤芯寿命', '厨房'],
  ]) {
    added.push(await request(`/smart-home/devices/${entityId}`, owner, 'PUT', { displayName, area }));
  }
  assert(
    added.every((one) => one.status === 200) && added[1].body.data.displayName === '客厅窗帘' && added[1].body.data.controllable === false,
    '挑出扫地机、窗帘、净水器的两个传感器并起中文名（第一期都不可控）',
  );
  assert((await smartHomeHasData(owner)) === true, '配好连接且白名单非空：家里页出现智能家居');
  const renamed = await request('/smart-home/devices/cover.living_room_curtain', owner, 'PUT', {
    displayName: '客厅大窗帘',
    area: null,
  });
  assert(renamed.status === 200 && renamed.body.data.area === null, '改名、清掉分组');
  const memberList = await request('/smart-home/devices', member);
  assert(memberList.status === 200 && memberList.body.data.length === 4, '全家都能看白名单');

  console.log('5. 状态快照');
  const states = await request('/smart-home/states', member);
  const byId = Object.fromEntries(states.body.data.devices.map((device) => [device.entityId, device]));
  assert(
    states.status === 200 &&
      states.body.data.connection.available &&
      states.body.data.devices.length === 4 &&
      byId['vacuum.roborock_s8'].state.state === 'docked' &&
      byId['vacuum.roborock_s8'].state.battery === 100 &&
      byId['cover.living_room_curtain'].state.position === 80 &&
      byId['sensor.kitchen_purifier_tds'].state.unit === 'ppm',
    '成员看得到白名单设备的真实状态（状态、电量、开合、单位）',
  );
  assert(!states.text.includes('lock.front_door') && !states.text.includes('sensor.roborock_s8_filter_left'), '状态只含白名单');
  ha.states = ha.states.filter((entry) => entry.entity_id !== 'sensor.kitchen_purifier_tds');
  await new Promise((resolve) => setTimeout(resolve, 2_100)); // 状态缓存 2 秒
  const gone = await request('/smart-home/states', owner);
  assert(
    gone.body.data.devices.find((device) => device.entityId === 'sensor.kitchen_purifier_tds').state.state === 'unavailable',
    'HA 上已经没了的实体显示 unavailable',
  );

  console.log('6. HA 挂了 / 不回');
  await ha.stop();
  await new Promise((resolve) => setTimeout(resolve, 2_100));
  let startedAt = Date.now();
  const down = await request('/smart-home/states', member);
  const downMs = Date.now() - startedAt;
  const others = await Promise.all(['/members', '/today/attention', '/system/modules'].map((path) => request(path, member)));
  assert(
    down.status === 200 &&
      down.body.data.connection.available === false &&
      down.body.data.connection.message === '网络不通，Home Assistant 可能没开' &&
      down.body.data.devices.length === 4 &&
      down.body.data.devices.every((device) => device.state === null),
    `HA 停掉：状态接口仍 200，说「连不上」，设备照列、状态为空（${downMs}ms）`,
  );
  assert(others.every((one) => one.status === 200), '成员、今天页留意、家里页模块这些接口不受影响');
  await ha.start();
  ha.mode = 'hang';
  await new Promise((resolve) => setTimeout(resolve, 2_100));
  startedAt = Date.now();
  const hung = await request('/smart-home/states', owner);
  const hungMs = Date.now() - startedAt;
  assert(
    hung.body.data.connection.available === false && hung.body.data.connection.message.startsWith('连接超时') && hungMs < 4_500,
    `HA 不回：${hungMs}ms 内给出「连接超时」`,
  );
  ha.mode = 'ok';

  console.log('7. 跨家庭');
  const other = await createModuleHousehold(db, 'owner');
  fixtures.push(other);
  const otherDevices = await request('/smart-home/devices', other.token);
  const otherSettings = await request('/smart-home/connector-settings', other.token);
  const otherRemove = await request('/smart-home/devices/vacuum.roborock_s8', other.token, 'DELETE');
  assert(
    otherDevices.body.data.length === 0 && otherSettings.body.data.mode === 'server_default' && otherRemove.status === 404,
    '另一个家庭看不到、也删不掉这家的白名单和连接设置',
  );

  console.log('8. 移出与恢复默认');
  const removed = await request('/smart-home/devices/vacuum.roborock_s8', owner, 'DELETE');
  const again = await request('/smart-home/devices/vacuum.roborock_s8', owner, 'DELETE');
  assert(removed.status === 200 && again.status === 404, '移出白名单；再移一次 404');
  const reset = await request('/smart-home/connector-settings', owner, 'DELETE');
  assert(
    reset.status === 200 && reset.body.data.mode === 'server_default' && (await smartHomeHasData(owner)) === false,
    '恢复服务器默认后连接没配，家里页不再显示智能家居',
  );
  const activity = await db.query(
    `SELECT action FROM household_activity_logs WHERE action LIKE 'smart_home_%' ORDER BY "createdAt"`,
  );
  const actions = new Set(activity.rows.map((one) => one.action));
  assert(
    ['smart_home_connector_updated', 'smart_home_device_added', 'smart_home_device_updated', 'smart_home_device_removed', 'smart_home_connector_reset'].every((action) =>
      actions.has(action),
    ),
    '改连接、加改删设备、恢复默认都记进家庭动态',
  );

  console.log('\n智能家居 E1 黑盒全部通过');
} finally {
  // 留干净：白名单清空，家庭设置删掉
  await db.query(`DELETE FROM smart_home_devices WHERE "householdId" IN (SELECT "householdId" FROM members WHERE name = '爸爸')`);
  await db.query(`DELETE FROM integrations WHERE kind = 'home_assistant'`);
  for (const fixture of fixtures) await cleanModuleHousehold(db, fixture).catch(() => undefined);
  await ha.stop();
  await db.end();
}

async function assertDbRejectsLock() {
  const household = await db.query(`SELECT "householdId" FROM members WHERE name = '爸爸' LIMIT 1`);
  let rejected = false;
  try {
    await db.query(
      `INSERT INTO smart_home_devices ("householdId", "entityId", domain, "displayName") VALUES ($1, 'lock.front_door', 'lock', '大门')`,
      [household.rows[0].householdId],
    );
  } catch {
    rejected = true;
  }
  assert(rejected, '绕过接口直接写库也塞不进门锁（CHECK 约束）');
}
