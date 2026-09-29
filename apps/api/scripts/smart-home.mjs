// H3 E1 智能家居黑盒：连接设置（只写不读、服务器默认的令牌文件不存在）、连通性测试、实体目录
// （门锁 / 安防 / 不支持的 domain 不列）、白名单增改删与权限、状态快照只含白名单、HA 挂了或不回时
// 3 秒内给出「连不上」且别的接口照常、家里页 hasData、跨家庭隔离。对面是 fake-ha.mjs。
// 智能家居页重做 R1：白名单按设备（加进来的默认搭配、改主实体 / 主面板项 / 藏掉、HA 断开给上次状态），
// 以及旧的按实体登记的行在连上 HA 后按设备归并（第 9 节）。
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
    request('/smart-home/devices', member, 'POST', { haDeviceId: 'dev_curtain' }),
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
  const box = byDevice['防潮箱'];
  const boxPrimary = primaryOf(box);
  assert(
    box.entities.length === 8 &&
      boxPrimary.length === 4 &&
      boxPrimary.includes('switch.dehumidify_box') &&
      !boxPrimary.includes('switch.dehumidify_box_loop') &&
      box.entities.filter((entity) => entity.primary && entity.domain === 'sensor').length === 3,
    '米家插座类设备（不标 entity_category）：最多展开 4 个，可控的开关优先、剩下 3 个给传感器；「* 」开头的内部实体不展开',
  );
  assert(
    !ids.includes('sensor.dehumidify_box_hidden') &&
      !ids.includes('sensor.dehumidify_box_disabled') &&
      !('Backup' in byDevice) &&
      !('Sun' in byDevice) &&
      !ids.includes('sensor.backup_manager_state'),
    '在 HA 里隐藏 / 停用的实体、HA 自己的服务型设备（Backup、Sun）都不列',
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
      flat.body.data.devices[0].entities.length >= ids.length,
    'WebSocket 读不到时退回一组平铺，并说明原因',
  );

  console.log('3b. 目录里的默认搭配');
  const defaults = Object.fromEntries(
    groups.filter((device) => device.id).map((device) => [
      device.id,
      Object.fromEntries(device.entities.filter((entity) => entity.defaultRole).map((entity) => [entity.entityId, entity.defaultRole])),
    ]),
  );
  assert(
    defaults.dev_roborock['vacuum.roborock_s8'] === 'primary' &&
      defaults.dev_roborock['sensor.roborock_s8_cleaning_area'] === 'featured' &&
      !defaults.dev_roborock['sensor.roborock_s8_filter_left'] &&
      defaults.dev_purifier['sensor.kitchen_purifier_ro_filter_life'] === 'primary' &&
      defaults.dev_box['switch.dehumidify_box'] === 'primary' &&
      !defaults.dev_box['switch.dehumidify_box_loop'] &&
      groups.every((device) => device.whitelistedDeviceId === null),
    '整台加进来的默认搭配：扫地机本体做主、非诊断传感器做主面板项；净水器（家电）主实体选传感器；「* 」内部开关不当主角',
  );

  console.log('4. 白名单（按设备）');
  const blocked = await Promise.all([
    request('/smart-home/devices', owner, 'POST', { entityId: 'lock.front_door' }),
    request('/smart-home/devices', owner, 'POST', { entityId: 'alarm_control_panel.home' }),
    request('/smart-home/devices', owner, 'POST', { entityId: 'person.dad' }),
    request('/smart-home/devices', owner, 'POST', { entityId: 'Not-An-Entity' }),
    request('/smart-home/devices', owner, 'POST', { haDeviceId: 'dev_backup' }),
    request('/smart-home/devices', owner, 'POST', { haDeviceId: 'dev_missing' }),
    request('/smart-home/devices', owner, 'POST', {}),
    request('/smart-home/devices', owner, 'POST', { haDeviceId: 'dev_curtain', entityId: 'scene.movie_night' }),
    request('/smart-home/devices', owner, 'POST', { entityId: 'cover.living_room_curtain' }),
  ]);
  assert(
    blocked.every((one) => one.status === 400),
    '门锁、安防、不支持的 domain、坏 ID、HA 自己的服务型设备、不存在的设备、两样都不给 / 都给、属于设备的单个实体都进不了白名单',
  );
  assert(blocked[8].body.error.message.includes('整台设备'), '属于设备的实体：提示把整台加进来');
  await assertDbRejectsLock();

  assert((await smartHomeHasData(owner)) === false, '连上了但白名单为空：家里页还不显示智能家居');
  const vacuumAdd = await request('/smart-home/devices', owner, 'POST', { haDeviceId: 'dev_roborock' });
  const curtainAdd = await request('/smart-home/devices', owner, 'POST', { haDeviceId: 'dev_curtain' });
  const purifierAdd = await request('/smart-home/devices', owner, 'POST', { haDeviceId: 'dev_purifier' });
  const boxAdd = await request('/smart-home/devices', owner, 'POST', { haDeviceId: 'dev_box' });
  const sceneAdd = await request('/smart-home/devices', owner, 'POST', { entityId: 'scene.movie_night' });
  const vacuumDevice = vacuumAdd.body.data;
  const curtainDevice = curtainAdd.body.data;
  const purifierDevice = purifierAdd.body.data;
  const boxDevice = boxAdd.body.data;
  assert(
    [vacuumAdd, curtainAdd, purifierAdd, boxAdd, sceneAdd].every((one) => one.status === 201) &&
      vacuumDevice.haDeviceId === 'dev_roborock' &&
      vacuumDevice.primaryEntityId === 'vacuum.roborock_s8' &&
      vacuumDevice.icon === 'vacuum' &&
      vacuumDevice.displayName === 'Roborock S8' &&
      vacuumDevice.area === '客厅' &&
      JSON.stringify(vacuumDevice.featuredEntityIds) === JSON.stringify(['sensor.roborock_s8_cleaning_area']) &&
      vacuumDevice.controllable === false &&
      vacuumDevice.legacy === false,
    '整台加进来：主实体、主面板项、图标、名字（HA 里的设备名）、房间（HA 区域）都按默认规则算好，默认不开放控制',
  );
  assert(
    curtainDevice.displayName === '客厅窗帘' &&
      curtainDevice.icon === 'curtain' &&
      curtainDevice.featuredEntityIds.length === 0 &&
      purifierDevice.icon === 'water_purifier' &&
      purifierDevice.primaryEntityId === 'sensor.kitchen_purifier_ro_filter_life' &&
      JSON.stringify(purifierDevice.featuredEntityIds) ===
        JSON.stringify(['binary_sensor.kitchen_purifier_ro_expiring', 'sensor.kitchen_purifier_tds']) &&
      boxDevice.primaryEntityId === 'switch.dehumidify_box' &&
      boxDevice.icon === 'switch' &&
      boxDevice.featuredEntityIds.length === 5 &&
      !boxDevice.featuredEntityIds.includes('sensor.dehumidify_box_hidden') &&
      sceneAdd.body.data.haDeviceId === null &&
      sceneAdd.body.data.icon === 'scene',
    '窗帘只有诊断类传感器：没有主面板项；净水器图标按设备名认出来；HA 里隐藏的实体不当主面板项；场景是单实体设备',
  );
  const duplicate = await request('/smart-home/devices', owner, 'POST', { haDeviceId: 'dev_roborock' });
  assert(duplicate.status === 409, '同一台设备不能加两次');
  const known = await db.query(`SELECT "knownEntityIds" FROM smart_home_devices WHERE id = $1`, [boxDevice.id]);
  assert(
    known.rows[0].knownEntityIds.includes('light.dehumidify_box_indicator') &&
      !known.rows[0].knownEntityIds.includes('sensor.dehumidify_box_disabled'),
    '加进来时记下这台设备当时的全部子实体（以后 HA 新冒出来的才算「新实体」）；HA 里停用的不算',
  );
  assert((await smartHomeHasData(owner)) === true, '配好连接且白名单非空：家里页出现智能家居');

  const renamed = await request(`/smart-home/devices/${curtainDevice.id}`, owner, 'PATCH', { displayName: '客厅大窗帘', area: null });
  assert(renamed.status === 200 && renamed.body.data.area === null && renamed.body.data.displayName === '客厅大窗帘', '改名、清掉房间');
  const badPatches = await Promise.all([
    request(`/smart-home/devices/${purifierDevice.id}`, owner, 'PATCH', { featuredEntityIds: ['sensor.roborock_s8_cleaning_area'] }),
    request(`/smart-home/devices/${purifierDevice.id}`, owner, 'PATCH', {
      featuredEntityIds: Array.from({ length: 7 }, (_, index) => `sensor.kitchen_purifier_x${index}`),
    }),
    request(`/smart-home/devices/${purifierDevice.id}`, owner, 'PATCH', { hiddenEntityIds: ['sensor.kitchen_purifier_ro_filter_life'] }),
    request(`/smart-home/devices/${purifierDevice.id}`, owner, 'PATCH', { controllable: true }),
    request(`/smart-home/devices/${purifierDevice.id}`, owner, 'PATCH', { primaryEntityId: 'vacuum.roborock_s8' }),
    request(`/smart-home/devices/${purifierDevice.id}`, member, 'PATCH', { displayName: '成员改名' }),
  ]);
  assert(
    badPatches.slice(0, 5).every((one) => one.status === 400 || one.status === 409) && badPatches[5].status === 403,
    '主面板项必须是本设备的、最多 6 个；主实体不能藏；传感器做主实体时不能开放控制；不能拿别的设备的实体当主实体；成员改不了',
  );
  const reshaped = await request(`/smart-home/devices/${purifierDevice.id}`, owner, 'PATCH', {
    primaryEntityId: 'sensor.kitchen_purifier_tds',
    featuredEntityIds: ['sensor.kitchen_purifier_tds', 'sensor.kitchen_purifier_ro_filter_life', 'sensor.kitchen_purifier_wifi'],
    hiddenEntityIds: ['sensor.kitchen_purifier_firmware'],
    pinnedToToday: true,
  });
  assert(
    reshaped.status === 200 &&
      reshaped.body.data.primaryEntityId === 'sensor.kitchen_purifier_tds' &&
      JSON.stringify(reshaped.body.data.featuredEntityIds) ===
        JSON.stringify(['sensor.kitchen_purifier_ro_filter_life', 'sensor.kitchen_purifier_wifi']) &&
      JSON.stringify(reshaped.body.data.hiddenEntityIds) === JSON.stringify(['sensor.kitchen_purifier_firmware']) &&
      reshaped.body.data.pinnedToToday === true,
    '换主实体、挑主面板项（诊断类也能挑上来；主实体自动从主面板项里剔掉）、藏掉子实体、在今天页显示',
  );
  await request(`/smart-home/devices/${purifierDevice.id}`, owner, 'PATCH', {
    primaryEntityId: 'sensor.kitchen_purifier_ro_filter_life',
    featuredEntityIds: ['sensor.kitchen_purifier_tds', 'binary_sensor.kitchen_purifier_ro_expiring'],
  });
  const memberList = await request('/smart-home/devices', member);
  assert(memberList.status === 200 && memberList.body.data.length === 5, '全家都能看白名单');

  console.log('5. 状态快照（按设备）');
  const states = await request('/smart-home/states', member);
  const byId = Object.fromEntries(states.body.data.devices.map((device) => [device.id, device]));
  const purifierState = byId[purifierDevice.id];
  assert(
    states.status === 200 &&
      states.body.data.connection.available &&
      states.body.data.stale === false &&
      typeof states.body.data.asOf === 'string' &&
      states.body.data.devices.length === 5 &&
      byId[vacuumDevice.id].primary.state === 'docked' &&
      byId[vacuumDevice.id].primary.battery === 100 &&
      byId[vacuumDevice.id].online === true &&
      byId[curtainDevice.id].primary.position === 80 &&
      purifierState.featured.find((one) => one.entityId === 'sensor.kitchen_purifier_tds').state.unit === 'ppm',
    '成员看得到每台设备主实体的真实状态（状态、电量、开合）和主面板项的值',
  );
  assert(
    purifierState.featured.map((one) => one.name).join('/') === '出水TDS/RO到期预警' &&
      typeof byId[vacuumDevice.id].primary.lastUpdated === 'string',
    '主面板项名字去掉设备名前缀；状态带 lastUpdated',
  );
  assert(!states.text.includes('lock.front_door') && !states.text.includes('sensor.roborock_s8_filter_left'), '状态只含白名单设备的主实体和主面板项');
  ha.states = ha.states.filter((entry) => entry.entity_id !== 'sensor.kitchen_purifier_tds');
  await new Promise((resolve) => setTimeout(resolve, 2_100)); // 状态缓存 2 秒
  const gone = await request('/smart-home/states', owner);
  assert(
    gone.body.data.devices
      .find((device) => device.id === purifierDevice.id)
      .featured.find((one) => one.entityId === 'sensor.kitchen_purifier_tds').state.state === 'unavailable',
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
      down.body.data.devices.length === 5 &&
      down.body.data.stale === true &&
      down.body.data.asOf === gone.body.data.asOf &&
      down.body.data.devices.find((device) => device.id === vacuumDevice.id).primary.state === 'docked',
    `HA 停掉：状态接口仍 200，说「连不上」，设备照列并保留上次读到的状态（stale，asOf 是那一次；${downMs}ms）`,
  );
  assert(others.every((one) => one.status === 200), '成员、今天页留意、家里页模块这些接口不受影响');
  await request('/smart-home/connector-settings', owner, 'PUT', { isEnabled: true });
  const afterSettings = await request('/smart-home/states', member);
  assert(
    afterSettings.body.data.stale === false && afterSettings.body.data.devices.every((device) => device.primary === null),
    '连接设置改过之后，上次的状态不再作数（不拿旧 HA 的状态冒充）',
  );
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
  const otherRemove = await request(`/smart-home/devices/${vacuumDevice.id}`, other.token, 'DELETE');
  const otherPatch = await request(`/smart-home/devices/${vacuumDevice.id}`, other.token, 'PATCH', { displayName: '偷改' });
  assert(
    otherDevices.body.data.length === 0 &&
      otherSettings.body.data.mode === 'server_default' &&
      otherRemove.status === 404 &&
      otherPatch.status === 404,
    '另一个家庭看不到、改不了、也删不掉这家的白名单和连接设置',
  );

  console.log('8. 移出');
  const removed = await request(`/smart-home/devices/${vacuumDevice.id}`, owner, 'DELETE');
  const again = await request(`/smart-home/devices/${vacuumDevice.id}`, owner, 'DELETE');
  assert(removed.status === 200 && removed.body.data.id === vacuumDevice.id && again.status === 404, '移出白名单；再移一次 404');

  console.log('9. 旧的按实体登记的行：连上 HA 后按设备归并');
  await mergeScenario(owner);

  console.log('10. 恢复默认');
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
    [
      'smart_home_connector_updated',
      'smart_home_device_added',
      'smart_home_device_updated',
      'smart_home_device_removed',
      'smart_home_devices_merged',
      'smart_home_connector_reset',
    ].every((action) => actions.has(action)),
    '改连接、加改删设备、归并、恢复默认都记进家庭动态',
  );

  console.log('\n智能家居 E1 / R1 黑盒全部通过');
} finally {
  // 留干净：白名单清空，家庭设置删掉
  await db.query(`DELETE FROM smart_home_devices WHERE "householdId" IN (SELECT "householdId" FROM members WHERE name = '爸爸')`);
  await db.query(`DELETE FROM integrations WHERE kind = 'home_assistant'`);
  for (const fixture of fixtures) await cleanModuleHousehold(db, fixture).catch(() => undefined);
  await ha.stop();
  await db.end();
}

async function householdId() {
  const household = await db.query(`SELECT "householdId" FROM members WHERE name = '爸爸' LIMIT 1`);
  return household.rows[0].householdId;
}

async function assertDbRejectsLock() {
  let rejected = false;
  try {
    await db.query(
      `INSERT INTO smart_home_devices ("householdId", "primaryEntityId", "primaryDomain", "displayName") VALUES ($1, 'lock.front_door', 'lock', '大门')`,
      [await householdId()],
    );
  } catch {
    rejected = true;
  }
  assert(rejected, '绕过接口直接写库也塞不进门锁（CHECK 约束）');
}

/** 直接往库里塞 R1 之前那种按实体登记的行（迁移后就是 legacy）。 */
async function legacy(entityId, displayName, extra = {}) {
  const row = await db.query(
    `INSERT INTO smart_home_devices ("householdId", "primaryEntityId", "primaryDomain", "displayName", area, controllable,
       "minRole", "pinnedToToday", "sortOrder", "mergeState", "knownEntityIds", icon)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'legacy', jsonb_build_array($10::text), 'other') RETURNING id`,
    [
      await householdId(),
      entityId,
      entityId.slice(0, entityId.indexOf('.')),
      displayName,
      extra.area ?? null,
      extra.controllable ?? false,
      extra.minRole ?? 'admin',
      extra.pinnedToToday ?? false,
      extra.sortOrder ?? 0,
      entityId,
    ],
  );
  return row.rows[0].id;
}

async function waitForReport(token, after) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const report = await request('/smart-home/devices/merge-report', token);
    if (report.body.data && (!after || report.body.data.mergedAt > after)) return report.body.data;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('等归并报告超时');
}

async function mergeScenario(owner) {
  const id = await householdId();
  await db.query(`DELETE FROM smart_home_devices WHERE "householdId" = $1 AND "haDeviceId" IS DISTINCT FROM 'dev_purifier'`, [id]);
  const before = await request('/smart-home/devices/merge-report', owner);
  assert(before.status === 200 && before.body.data === null, '没归并过：报告为空');

  // HA 连不上时不归并，旧行照常作为单实体设备出现
  await ha.stop();
  const powerRow = await legacy('sensor.dehumidify_box_power', '防潮箱功率', { sortOrder: 0, pinnedToToday: true, controllable: true });
  const switchRow = await legacy('switch.dehumidify_box', '防潮箱', { sortOrder: 3, area: '卧室', controllable: false });
  const acRow = await legacy('climate.bedroom_ac', '空调', { sortOrder: 1, controllable: true, minRole: 'member' });
  const faultRow = await legacy('binary_sensor.living_room_curtain_fault', '窗帘故障', { sortOrder: 2 });
  const wifiRow = await legacy('sensor.kitchen_purifier_wifi', '净水 WiFi', { sortOrder: 4 });
  const sceneRow = await legacy('scene.movie_night', '电影夜', { sortOrder: 5 });
  const goneRow = await legacy('sensor.gone_away', '早就删了的', { sortOrder: 6 });
  const owner_ = await db.query(`SELECT id FROM members WHERE name = '爸爸' LIMIT 1`);
  const link = await db.query(
    `INSERT INTO smart_home_links ("householdId", name, trigger, keyword, "targetDeviceId", "targetEntityId", action, "createdById")
     VALUES ($1, '旧联动', 'task_done', '除湿', $2, 'sensor.dehumidify_box_power', 'turn_on', $3) RETURNING id`,
    [id, powerRow, owner_.rows[0].id],
  );
  await db.query(
    `INSERT INTO smart_home_commands ("householdId", "memberId", "requestId", "deviceId", "entityId", action, service, status)
     VALUES ($1, $2, gen_random_uuid(), $3, 'sensor.dehumidify_box_power', 'turn_on', 'switch.turn_on', 'succeeded')`,
    [id, owner_.rows[0].id, powerRow],
  );
  await db.query(
    `INSERT INTO smart_home_webhook_settings ("householdId", rules) VALUES ($1, $2)
     ON CONFLICT ("householdId") DO UPDATE SET rules = EXCLUDED.rules`,
    [
      id,
      JSON.stringify({
        laundry: { enabled: true, washer: { deviceId: powerRow, entityId: 'sensor.dehumidify_box_power' }, dryer: null, doneValue: null },
        vacuum: { enabled: true, trigger: null },
        filter: { enabled: true, trigger: null, threshold: 10 },
      }),
    ],
  );
  await new Promise((resolve) => setTimeout(resolve, 2_500)); // 对账每秒一次，连不上就不动
  const waiting = await request('/smart-home/devices', owner);
  assert(
    waiting.body.data.filter((device) => device.legacy).length === 7 && (await request('/smart-home/devices/merge-report', owner)).body.data === null,
    'HA 连不上：旧行不动（legacy），各自照常列出，等下一轮',
  );

  await ha.start();
  const report = await waitForReport(owner);
  const list = (await request('/smart-home/devices', owner)).body.data;
  const byPrimary = Object.fromEntries(list.map((device) => [device.primaryEntityId, device]));
  const box = byPrimary['switch.dehumidify_box'];
  assert(
    list.every((device) => !device.legacy) &&
      box.id === switchRow &&
      box.haDeviceId === 'dev_box' &&
      JSON.stringify(box.featuredEntityIds) === JSON.stringify(['sensor.dehumidify_box_power']) &&
      !byPrimary['sensor.dehumidify_box_power'],
    '同一台设备的两行并成一台：可控的开关做主实体（哪怕排序靠后），功率传感器做主面板项，传感器那行删掉',
  );
  assert(
    box.controllable === false && box.pinnedToToday === true && box.sortOrder === 0 && box.area === '卧室' && box.icon === 'switch',
    '允许控制只取主实体那行（传感器行勾了也不放宽）；在今天页显示任一行勾了就勾；排序取最小；房间取主实体行的',
  );
  const ac = byPrimary['climate.bedroom_ac'];
  assert(
    ac.id === acRow && ac.haDeviceId === 'dev_ac' && ac.controllable === true && ac.minRole === 'member' && ac.icon === 'air_conditioner',
    '单独一行的设备：原地改成按设备，控制权限原样保留，只重排不新增（没有自动补主面板项）',
  );
  assert(ac.featuredEntityIds.length === 0, '归并不自动添主面板项');
  const fault = byPrimary['binary_sensor.living_room_curtain_fault'];
  const flagged = report.devices.find((device) => device.primaryEntityId === 'binary_sensor.living_room_curtain_fault');
  assert(
    fault.id === faultRow &&
      flagged.sensorPrimaryWithControllable === true &&
      flagged.controllableEntityIds.includes('cover.living_room_curtain') &&
      !flagged.controllableEntityIds.includes('switch.living_room_curtain_child_lock'),
    '主实体是传感器、但设备有可控实体：报告里标出来（列出可控实体），不自动换，等 King 定',
  );
  const purifier = list.find((device) => device.haDeviceId === 'dev_purifier');
  assert(
    purifier.featuredEntityIds.includes('sensor.kitchen_purifier_wifi') && !list.some((device) => device.id === wifiRow),
    '已经按设备加过的净水器：旧行并进它的主面板项，不再另建一台',
  );
  assert(
    byPrimary['scene.movie_night'].id === sceneRow &&
      byPrimary['scene.movie_night'].haDeviceId === null &&
      byPrimary['sensor.gone_away'].id === goneRow &&
      report.rows.find((row) => row.entityId === 'sensor.gone_away').role === 'single',
    '没有归属设备的（场景）和 HA 里查不到的：保持单实体设备',
  );
  const moved = await db.query(
    `SELECT (SELECT "targetDeviceId" FROM smart_home_links WHERE id = $1) AS link,
            (SELECT count(*)::int FROM smart_home_commands WHERE "deviceId" = $2) AS commands,
            (SELECT rules->'laundry'->'washer'->>'deviceId' FROM smart_home_webhook_settings WHERE "householdId" = $3) AS washer`,
    [link.rows[0].id, switchRow, id],
  );
  assert(
    moved.rows[0].link === switchRow && moved.rows[0].commands === 1 && moved.rows[0].washer === switchRow,
    '引用跟着改：联动目标、审计、E3 规则都指向并成的那台设备',
  );
  assert(
    report.dryRun === false &&
      report.rows.find((row) => row.entityId === 'sensor.dehumidify_box_power').role === 'featured' &&
      report.rows.find((row) => row.entityId === 'switch.dehumidify_box').role === 'primary' &&
      report.references.some((line) => line.includes('旧联动')),
    '归并报告：每一行归到哪、当什么，引用改到了哪里',
  );
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const again = await request('/smart-home/devices/merge-report', owner);
  assert(again.body.data.mergedAt === report.mergedAt, '幂等：没有旧行就不再归并，报告不变');
  const blockedRemove = await request(`/smart-home/devices/${switchRow}`, owner, 'DELETE');
  assert(
    blockedRemove.status === 409 && blockedRemove.body.error.message.includes('旧联动') && blockedRemove.body.error.message.includes('洗衣机'),
    '还有联动、规则在用的设备移不出去，说清是哪几条',
  );
  await db.query(`DELETE FROM smart_home_links WHERE id = $1`, [link.rows[0].id]);
  await db.query(`DELETE FROM smart_home_webhook_settings WHERE "householdId" = $1`, [id]);
}
