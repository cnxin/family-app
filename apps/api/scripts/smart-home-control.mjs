// H3 E2 智能家居控制黑盒：允许控制 / 谁能控的设置与校验、按角色的 canControl、逐次权限校验、
// 动作 → HA service、幂等键（同一次点击只执行一次）、审计（成功 / 失败 / 超时都记）、车库门只读、
// HA 状态变化经 /events 推送（WebSocket 订阅；断了退回轮询、再自动接回推送）。对面是 fake-ha.mjs。
// run-api-tests 把命令超时设成 1.5 秒、轮询 0.3 秒、重连退避 0.2～1 秒。
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { changedDomains, openEventStream } from './events-client.mjs';
import { startFakeHomeAssistant } from './fake-ha.mjs';

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
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', { loginName, password: PASSWORD });
  if (response.status !== 201) throw new Error(`${loginName} 登录失败 ${response.status}`);
  memberIds.set(response.body.data.accessToken, response.body.data.member.id);
  return response.body.data.accessToken;
}

const memberIds = new Map();
const memberIdOf = (token) => memberIds.get(token);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, timeoutMs, stepMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await wait(stepMs);
  }
  return false;
}
const command = (token, entityId, action, requestId = randomUUID()) =>
  request(`/smart-home/devices/${entityId}/command`, token, 'POST', { action, requestId });
const isSmartHome = (frame) => changedDomains(frame).includes('smart-home');

const db = new pg.Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});
await db.connect();
const ha = await startFakeHomeAssistant({ token: TOKEN });
const streams = [];

try {
  const owner = await login('爸爸');
  const member = await login('妈妈');
  await request('/smart-home/connector-settings', owner, 'PUT', { baseUrl: ha.url, credential: TOKEN });

  console.log('1. 允许控制 / 谁能控');
  const put = (entityId, body) => request(`/smart-home/devices/${entityId}`, owner, 'PUT', body);
  const sensorControl = await put('sensor.kitchen_purifier_tds', { displayName: '出水TDS', controllable: true });
  const badRole = await put('vacuum.roborock_s8', { displayName: '扫地机', minRole: 'owner' });
  assert(sensorControl.status === 400 && badRole.status === 400, '传感器不能开控制；谁能控只有管理员 / 全家两档');
  await put('sensor.kitchen_purifier_tds', { displayName: '出水TDS' });
  const vacuum = await put('vacuum.roborock_s8', { displayName: '扫地机', area: '客厅', controllable: true, minRole: 'member' });
  const curtain = await put('cover.living_room_curtain', { displayName: '客厅窗帘', controllable: true });
  await put('scene.movie_night', { displayName: '电影之夜', controllable: true, minRole: 'member' });
  await put('switch.living_room_curtain_child_lock', { displayName: '窗帘童锁' });
  assert(
    vacuum.body.data.controllable && vacuum.body.data.minRole === 'member' && curtain.body.data.minRole === 'admin',
    '扫地机、场景全家能控；窗帘默认只有管理员能控；童锁开关只看',
  );

  const canControl = async (token) =>
    Object.fromEntries((await request('/smart-home/states', token)).body.data.devices.map((d) => [d.entityId, d.canControl]));
  const [ownerCan, memberCan] = await Promise.all([canControl(owner), canControl(member)]);
  assert(
    ownerCan['vacuum.roborock_s8'] && ownerCan['cover.living_room_curtain'] && !ownerCan['sensor.kitchen_purifier_tds'] &&
      !ownerCan['switch.living_room_curtain_child_lock'] &&
      memberCan['vacuum.roborock_s8'] && memberCan['scene.movie_night'] && !memberCan['cover.living_room_curtain'],
    '状态里按当前这个人算 canControl（管理员：扫地机、窗帘；成员：扫地机、场景）',
  );

  console.log('2. 逐次校验权限');
  const rejected = await Promise.all([
    command(member, 'cover.living_room_curtain', 'open'),
    command(owner, 'switch.living_room_curtain_child_lock', 'turn_on'),
    command(owner, 'sensor.kitchen_purifier_tds', 'turn_on'),
    command(owner, 'vacuum.roborock_s8', 'open'),
    command(owner, 'sensor.roborock_s8_filter_left', 'start'),
    request('/smart-home/devices/vacuum.roborock_s8/command', owner, 'POST', { action: 'start' }),
  ]);
  assert(
    rejected.map((one) => one.status).join(',') === '403,403,400,400,404,400',
    '成员控不了只给管理员的窗帘、没开放控制的开关、传感器没有动作、动作和设备对不上、不在白名单、缺请求编号，都拒（403/403/400/400/404/400）',
  );
  assert(ha.serviceCalls.length === 0, '被拒的一条都没发到 HA');

  console.log('3. 执行、审计、幂等');
  const requestId = randomUUID();
  const started = await command(member, 'vacuum.roborock_s8', 'start', requestId);
  assert(
    started.status === 201 && started.body.data.status === 'succeeded' && started.body.data.replayed === false,
    `成员按「开始清扫」：${started.body.data.message}`,
  );
  assert(
    ha.serviceCalls.length === 1 &&
      ha.serviceCalls[0].domain === 'vacuum' &&
      ha.serviceCalls[0].service === 'start' &&
      ha.serviceCalls[0].data.entity_id === 'vacuum.roborock_s8',
    'HA 收到 vacuum.start，entity_id 对',
  );
  const again = await command(member, 'vacuum.roborock_s8', 'start', requestId);
  const clash = await command(member, 'vacuum.roborock_s8', 'pause', requestId);
  assert(
    again.status === 201 && again.body.data.replayed === true && again.body.data.id === started.body.data.id && ha.serviceCalls.length === 1,
    '同一个请求编号再发一次：取回第一次的结果，HA 没收到第二次',
  );
  assert(clash.status === 409, '同一个请求编号换了动作：409');
  const concurrentId = randomUUID();
  const concurrent = await Promise.all([1, 2, 3].map(() => command(owner, 'cover.living_room_curtain', 'close', concurrentId)));
  assert(
    ha.serviceCalls.filter((call) => call.service === 'close_cover').length === 1 &&
      concurrent.filter((one) => one.status === 201).length >= 1,
    `连点三下（同一个请求编号并发）：HA 只执行一次（${concurrent.map((one) => one.status).join('/')}）`,
  );
  const audit = await db.query(
    `SELECT status, service, message, "memberId" FROM smart_home_commands WHERE "requestId" = $1`,
    [requestId],
  );
  assert(
    audit.rows.length === 1 && audit.rows[0].status === 'succeeded' && audit.rows[0].service === 'vacuum.start' &&
      audit.rows[0].memberId === memberIdOf(member),
    '审计：谁（妈妈）、按了什么（vacuum.start）、HA 回了什么',
  );

  console.log('4. HA 失败 / 不回');
  ha.serviceMode = 'fail';
  const failedId = randomUUID();
  const failed = await command(owner, 'vacuum.roborock_s8', 'return_to_base', failedId);
  const failedAgain = await command(owner, 'vacuum.roborock_s8', 'return_to_base', failedId);
  const failedRow = await db.query(`SELECT status, message FROM smart_home_commands WHERE "requestId" = $1`, [failedId]);
  assert(
    failed.status === 502 && failed.body.error.message.startsWith('没执行成功') && failedAgain.status === 502 &&
      failedRow.rows[0].status === 'failed' && failedRow.rows[0].message.includes('HTTP 500') &&
      ha.serviceCalls.filter((call) => call.service === 'return_to_base').length === 1,
    'HA 报错：502 说清原因，审计记失败；同一请求编号重发不再打 HA',
  );
  ha.serviceMode = 'hang';
  const startedAt = Date.now();
  const hung = await command(owner, 'vacuum.roborock_s8', 'pause');
  const hungMs = Date.now() - startedAt;
  ha.serviceMode = 'ok';
  assert(hung.status === 502 && hung.body.error.message.includes('连接超时') && hungMs < 3_000, `HA 不回：${hungMs}ms 超时，审计记失败`);

  console.log('5. 车库门只读');
  ha.setState('cover.living_room_curtain', 'closed', { device_class: 'garage' });
  await wait(2_100);
  const garage = await command(owner, 'cover.living_room_curtain', 'open');
  const garageControl = await put('cover.living_room_curtain', { displayName: '车库门', controllable: true });
  ha.setState('cover.living_room_curtain', 'closed', { device_class: 'curtain' });
  assert(garage.status === 403 && garageControl.status === 400, 'device_class 是 garage 的 cover：控制 403，开放控制 400');

  console.log('5b. 空调（试探性纳入：红外空调伴侣，状态按上次操作显示）');
  const ac = await put('climate.bedroom_ac', { displayName: '空调插座', area: '卧室', controllable: true, minRole: 'member' });
  const acState = async () =>
    (await request('/smart-home/states', member)).body.data.devices.find((d) => d.entityId === 'climate.bedroom_ac');
  const before = await acState();
  assert(
    ac.status === 200 && before.canControl && before.state.assumed === true && before.state.targetTemperature === 26 &&
      JSON.stringify(before.state.hvacModes) === JSON.stringify(['off', 'cool', 'heat', 'fan_only', 'auto']),
    '空调能开放控制；状态标明「不一定是真的」（assumed），带设定温度和可选模式',
  );
  const acCalls = () => ha.serviceCalls.filter((call) => call.domain === 'climate');
  const acOn = await command(member, 'climate.bedroom_ac', 'turn_on');
  const acHeat = await command(member, 'climate.bedroom_ac', 'mode_heat');
  const acUp = await command(member, 'climate.bedroom_ac', 'temperature_up');
  const upRow = await db.query(`SELECT service FROM smart_home_commands WHERE id = $1`, [acUp.body.data.id]);
  assert(
    acOn.status === 201 && acHeat.status === 201 && acUp.status === 201 &&
      acCalls().map((call) => call.service).join(',') === 'turn_on,set_hvac_mode,set_temperature' &&
      acCalls()[1].data.hvac_mode === 'heat' && acCalls()[2].data.temperature === 27 &&
      upRow.rows[0].service === 'climate.set_temperature(27)',
    '开 → climate.turn_on；制热 → set_hvac_mode(heat)；调高 1° → set_temperature(27)，审计记下参数',
  );
  ha.setState('climate.bedroom_ac', 'heat', { temperature: 30 });
  await wait(2_100);
  const atMax = await command(member, 'climate.bedroom_ac', 'temperature_up');
  const unknownMode = await request('/smart-home/devices/climate.bedroom_ac/command', member, 'POST', {
    action: 'mode_dry',
    requestId: randomUUID(),
  });
  assert(
    atMax.status === 409 && atMax.body.error.message.includes('最高') && acCalls().length === 3 && unknownMode.status === 400,
    '已经 30° 再调高：409 说清楚、不打 HA；没开放的模式（除湿）400',
  );
  const acOff = await command(member, 'climate.bedroom_ac', 'turn_off');
  assert(acOff.status === 201 && (await acState()).state.state === 'off', '关 → climate.turn_off');

  console.log('6. 审计列表');
  const recent = await request('/smart-home/commands', owner);
  const memberRecent = await request('/smart-home/commands', member);
  assert(
    recent.status === 200 && recent.body.data.length >= 4 && new Set(recent.body.data.map((one) => one.memberName)).size === 2 &&
      recent.body.data[0].createdAt >= recent.body.data[recent.body.data.length - 1].createdAt &&
      memberRecent.status === 403,
    '管理员能看最近的控制记录（新的在前），成员不能',
  );

  console.log('7. HA 状态变化经 /events 推送');
  assert(await until(() => ha.subscriberCount() === 1, 5_000), '服务端对这个家庭常驻一条 HA WebSocket 订阅');
  const stream = await openEventStream(BASE, member);
  streams.push(stream);
  await stream.waitFor((frame) => frame.event === 'hello', 2_000);
  let since = stream.frames.length;
  let at = Date.now();
  ha.setState('vacuum.roborock_s8', 'returning');
  const pushed = await stream.waitFor(isSmartHome, 1_500, since);
  assert(pushed !== null, `有人在 HA / App 里让扫地机回充：家里人 ${pushed ? pushed.at - at : '-'}ms 收到 smart-home`);
  const fresh = await request('/smart-home/states', member);
  assert(
    fresh.body.data.devices.find((d) => d.entityId === 'vacuum.roborock_s8').state.state === 'returning',
    '推送后立刻重读就是新状态（缓存已丢）',
  );
  since = stream.frames.length;
  ha.setState('sensor.roborock_s8_filter_left', '79');
  assert((await stream.waitFor(isSmartHome, 800, since)) === null, '白名单外的实体变了不推');

  console.log('8. 断了退回轮询，再接回推送');
  ha.websocket = false;
  ha.dropWebSockets();
  await wait(500);
  since = stream.frames.length;
  at = Date.now();
  ha.setState('vacuum.roborock_s8', 'docked');
  const polled = await stream.waitFor(isSmartHome, 2_000, since);
  assert(polled !== null, `WebSocket 断了：退回轮询，${polled ? polled.at - at : '-'}ms 收到 smart-home`);
  ha.websocket = true;
  assert(await until(() => ha.subscriberCount() === 1, 5_000), 'HA 的 WebSocket 恢复后自动接回推送');
  since = stream.frames.length;
  at = Date.now();
  ha.setState('vacuum.roborock_s8', 'cleaning');
  const back = await stream.waitFor(isSmartHome, 1_500, since);
  assert(back !== null, `接回推送后变化 ${back ? back.at - at : '-'}ms 到`);

  console.log('9. 白名单清空后停止订阅');
  for (const entityId of ['vacuum.roborock_s8', 'cover.living_room_curtain', 'scene.movie_night', 'sensor.kitchen_purifier_tds', 'switch.living_room_curtain_child_lock', 'climate.bedroom_ac']) {
    await request(`/smart-home/devices/${entityId}`, owner, 'DELETE');
  }
  assert(await until(() => ha.subscriberCount() === 0, 3_000), '白名单空了，服务端不再连着 HA');

  console.log('\n智能家居 E2 控制黑盒全部通过');
} finally {
  for (const stream of streams) stream.close();
  await db.query(`DELETE FROM smart_home_commands`);
  await db.query(`DELETE FROM smart_home_devices WHERE "householdId" IN (SELECT "householdId" FROM members WHERE name = '爸爸')`);
  await db.query(`DELETE FROM integrations WHERE kind = 'home_assistant'`);
  await ha.stop();
  await db.end();
}
