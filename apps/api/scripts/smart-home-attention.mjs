// H3 E5 黑盒：智能家居的三条「需要留意」规则（pre-trial-plan H3、smart-home-redesign §2.5）。
// 滤芯低于阈值（严格小于、跟 E3 规则里选的实体走）；洗烘完成超过 2 小时「晾衣服」还没打勾；HA 连不上超过 1 小时只给管理员。
// 三条合成一张卡（一个域一张卡）；家庭把智能家居分段收起时一条都不出。时间用 x-test-clock 推，不真等。
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { startFakeHomeAssistant } from './fake-ha.mjs';

const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const TOKEN = `ha-long-lived-${randomUUID()}`;
const FILTER_ENTITY = 'sensor.kitchen_purifier_ro_filter_life';

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function request(path, token, method = 'GET', body, headers = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', { loginName, password: PASSWORD });
  if (response.status !== 201) throw new Error(`${loginName} 登录失败 ${response.status}`);
  return response.body.data;
}

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const sign = (secret, timestamp, raw) => sha256(secret + sha256(`${secret}${timestamp}.${raw}`));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await wait(100);
  }
  return check();
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

try {
  const ownerSession = await login('爸爸');
  const owner = ownerSession.accessToken;
  const member = (await login('妈妈')).accessToken;
  const householdId = ownerSession.member.householdId;
  const [{ timezone }] = (await db.query('SELECT timezone FROM households WHERE id = $1', [householdId])).rows;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'Asia/Shanghai' }).format(new Date());
  /** 智能家居那一张留意卡（没有为 undefined）；clock 为空就用真实时间 */
  const card = async (token, clock) => {
    const response = await request('/today/attention', token, 'GET', undefined, clock ? { 'x-test-clock': clock } : {});
    if (response.status !== 200) throw new Error(`留意端点 ${response.status}`);
    return response.body.data.items.find((item) => item.domain === 'smart-home');
  };
  const at = (date) => date.toISOString();

  await request('/smart-home/connector-settings', owner, 'PUT', { baseUrl: ha.url, credential: TOKEN });
  const listed = (await request('/smart-home/devices', owner)).body.data;
  const purifier =
    listed.find((device) => device.haDeviceId === 'dev_purifier') ??
    (await request('/smart-home/devices', owner, 'POST', { haDeviceId: 'dev_purifier' })).body.data;
  const purifierId = purifier.id;
  // 前面的脚本留下的洗衣完成事件和家务不算数
  await db.query(`DELETE FROM smart_home_events WHERE "householdId" = $1 AND event = 'laundry_done'`, [householdId]);
  await db.query(`DELETE FROM household_tasks WHERE "householdId" = $1 AND title = '晾衣服'`, [householdId]);
  const secret = (await request('/smart-home/webhook-settings/secret', owner, 'POST')).body.data.secret;
  const rules = (filter) => ({
    laundry: { enabled: true, washer: null, dryer: null, doneValue: null },
    vacuum: { enabled: true, trigger: null },
    filter: { enabled: true, trigger: { deviceId: purifierId, entityId: FILTER_ENTITY }, threshold: 10, ...filter },
  });
  const setRules = (filter = {}) => request('/smart-home/webhook-settings/rules', owner, 'PUT', rules(filter));

  console.log('1. 滤芯低（跟 E3 规则里选的实体和阈值走）');
  assert((await setRules()).status === 200, '「滤芯低」选了厨下净水的 RO 滤芯寿命，阈值 10%');
  assert((await card(member)) === undefined, '滤芯还剩 12%：没有智能家居留意卡');
  ha.setState(FILTER_ENTITY, '8', { unit_of_measurement: '%' });
  assert(
    await until(async () => (await card(member))?.kind === 'filter', 3_000),
    'HA 推来 8%：成员也看到留意卡（不用刷新，推送让缓存失效）',
  );
  const filterCard = await card(member);
  assert(
    filterCard.count === 1 && filterCard.entity.id === purifierId && filterCard.entity.name === purifier.displayName &&
      filterCard.overdue === false && filterCard.key === 'smart-home:attention',
    '卡片指向这台设备（设备 id + 中文名），前端按它打开详情',
  );
  await setRules({ threshold: 8 });
  assert((await card(member)) === undefined, '阈值改成 8%：8 不算低于 8（与 HA 的 numeric_state below 一致）');
  await setRules({ enabled: false });
  assert((await card(member)) === undefined, '「滤芯低」这条联动关掉：留意也不出');
  await setRules({ trigger: null });
  assert((await card(member)) === undefined, '没选触发实体：不出');
  await setRules();

  console.log('2. 洗烘完成超过 2 小时，「晾衣服」还没打勾');
  const raw = JSON.stringify({ eventId: `ctx-${randomUUID()}`, event: 'laundry_done', appliance: 'washer' });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sent = await request(`/smart-home/webhook/${householdId}`, null, 'POST', raw, {
    'X-Family-Timestamp': timestamp,
    'X-Family-Signature': sign(secret, timestamp, raw),
  });
  const tasks = (await request(`/tasks?start=${today}&end=${today}`, owner)).body.data;
  const hanging = tasks.find((one) => one.task.title === '晾衣服' && one.status === 'pending');
  assert(sent.status === 200 && hanging, 'HA 报洗衣机完成：E3 建了今天的「晾衣服」');
  assert((await card(member))?.kind === 'filter', '刚洗完：还没有「晾衣服」这条（滤芯那条照旧）');
  // 把「完成」挪到两小时多以前；过了午夜就挪到今天刚开始，再把「现在」往后推，保证都在同一个家庭日里
  const [{ receivedAt }] = (
    await db.query(
      `UPDATE smart_home_events
          SET "receivedAt" = GREATEST((($2::date)::timestamp AT TIME ZONE $3) + interval '1 minute', now() - interval '121 minutes')
        WHERE "householdId" = $1 AND event = 'laundry_done'
      RETURNING "receivedAt"`,
      [householdId, today, timezone || 'Asia/Shanghai'],
    )
  ).rows;
  const doneAt = new Date(receivedAt).getTime();
  const early = await card(member, at(new Date(doneAt + 119 * 60_000)));
  assert(early?.kind === 'filter' && early.count === 1, '完成后 1 小时 59 分：还不提醒');
  const both = await card(member, at(new Date(doneAt + 121 * 60_000)));
  assert(
    both.count === 2 && both.entity === undefined && JSON.stringify(both.kinds) === JSON.stringify(['laundry', 'filter']) &&
      both.kind === 'laundry' && both.dueOn === today,
    '完成后 2 小时 1 分：和滤芯合成一张卡（一个域一张卡），「晾衣服」排前面',
  );
  await setRules({ threshold: 5 });
  const laundry = await card(owner, at(new Date(doneAt + 121 * 60_000)));
  assert(
    laundry.count === 1 && laundry.kind === 'laundry' && laundry.entity.id === hanging.taskId && laundry.entity.name === '晾衣服',
    '只剩这一条时卡片指向那件家务（家务 id），一步就能打勾',
  );
  const ticked = await request(`/tasks/${hanging.taskId}/instances/${today}`, member, 'PATCH', { status: 'done' });
  assert(
    ticked.status === 200 && (await card(owner, at(new Date(doneAt + 121 * 60_000)))) === undefined,
    '妈妈把「晾衣服」打勾：这条就没了',
  );

  console.log('3. HA 连不上超过 1 小时（只给管理员）');
  await ha.stop();
  const downAt = Date.now();
  await wait(1_500); // 实时订阅掉线后每 0.3 秒拉一次，记下「从什么时候起连不上」
  assert((await card(owner, at(new Date(downAt + 30 * 60_000)))) === undefined, '断了半小时：不提醒（重启、断网常有）');
  const offline = await card(owner, at(new Date(downAt + 61 * 60_000)));
  assert(
    offline?.kind === 'offline' && offline.count === 1 && offline.entity.name === 'Home Assistant',
    '断了 1 小时 1 分：管理员看到「Home Assistant 连不上」',
  );
  assert((await card(member, at(new Date(downAt + 61 * 60_000)))) === undefined, '成员看不到这一条（他们也处理不了）');
  await ha.start();
  assert(
    await until(async () => (await card(owner, at(new Date(downAt + 61 * 60_000)))) === undefined, 5_000),
    'HA 回来了：实时订阅重连上，这条自动消失',
  );

  console.log('4. 家庭把智能家居分段收起');
  ha.setState(FILTER_ENTITY, '3', { unit_of_measurement: '%' });
  assert(await until(async () => (await card(member))?.kind === 'filter', 3_000), '滤芯 3%：留意卡回来了');
  const off = await request('/system/modules/smart-home', owner, 'PATCH', { override: 'off' });
  assert(off.status === 200 && (await card(member)) === undefined, '收起「智能家居」：它的留意一条都不出');
  await request('/system/modules/smart-home', owner, 'PATCH', { override: null });
  ha.setState(FILTER_ENTITY, '12', { unit_of_measurement: '%' });
} finally {
  await ha.stop();
  await db.end();
}
