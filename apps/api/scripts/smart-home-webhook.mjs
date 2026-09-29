// H3 E3 黑盒：HA → 小管家 webhook。签名 / 时间戳不对 401、重放按事件 id 去重 10 分钟、三条联动各自产生
// 正确的对象（晾衣服家务 + 通知；扫地打勾；换滤芯家务 + 提醒 + 购物清单）、联动开关、密钥轮换 24 小时宽限、
// 先发 smart-home 再发联动写到的域。签名算法与设置页生成的 HA 模板一致。
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { changedDomains, openEventStream } from './events-client.mjs';

const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';

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

/** 像 HA 那样发一条：正文是紧凑 JSON，签名按原始正文算。 */
function send(householdId, secret, payload, { timestamp = Math.floor(Date.now() / 1000), tamper, signature } = {}) {
  const raw = JSON.stringify(payload);
  const sent = tamper ? tamper(raw) : raw;
  return request(`/smart-home/webhook/${householdId}`, null, 'POST', sent, {
    'X-Family-Timestamp': String(timestamp),
    'X-Family-Signature': signature ?? sign(secret, String(timestamp), raw),
  });
}

const db = new pg.Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});
await db.connect();
const streams = [];
const createdTaskTitles = ['晾衣服', '扫地（联动测试）', '换净水器滤芯'];

try {
  const ownerSession = await login('爸爸');
  const owner = ownerSession.accessToken;
  const member = (await login('妈妈')).accessToken;
  const householdId = ownerSession.member.householdId;
  const [{ timezone }] = (await db.query('SELECT timezone FROM households WHERE id = $1', [householdId])).rows;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'Asia/Shanghai' }).format(new Date());
  const tasksToday = async () => (await request(`/tasks?start=${today}&end=${today}`, owner)).body.data;
  const event = (name, extra = {}) => ({ eventId: `ctx-${randomUUID()}`, event: name, ...extra });

  console.log('1. 密钥与权限');
  const before = await request('/smart-home/webhook-settings', owner);
  const memberSettings = await request('/smart-home/webhook-settings', member);
  const memberRotate = await request('/smart-home/webhook-settings/secret', member, 'POST');
  assert(
    before.status === 200 && before.body.data.configured === false && before.body.data.path === `/smart-home/webhook/${householdId}` &&
      before.body.data.rules.laundry.enabled === true && memberSettings.status === 403 && memberRotate.status === 403,
    '没生成密钥前 configured=false、三条联动默认开；成员看不了也生成不了',
  );
  const unconfigured = await send(householdId, 'whatever', event('ping'));
  assert(unconfigured.status === 401, '还没生成密钥时一律 401');
  const rotated = await request('/smart-home/webhook-settings/secret', owner, 'POST');
  const secret = rotated.body.data.secret;
  const after = await request('/smart-home/webhook-settings', owner);
  const stored = await db.query('SELECT "secretEncrypted" FROM smart_home_webhook_settings WHERE "householdId" = $1', [householdId]);
  assert(
    rotated.status === 201 && secret.length >= 24 && after.body.data.configured && after.body.data.secretHint === `****${secret.slice(-4)}` &&
      !JSON.stringify(after.body).includes(secret) && !stored.rows[0].secretEncrypted.includes(secret),
    '生成密钥：明文只在这一次给出，之后只回提示，库里加密存',
  );

  console.log('2. 验签');
  const pong = await send(householdId, secret, event('ping'));
  assert(pong.status === 200 && pong.body.data.accepted && pong.body.data.result === '连通了', '签名对：200，ping 回「连通了」');
  const rejected = await Promise.all([
    request(`/smart-home/webhook/${householdId}`, null, 'POST', event('ping')),
    send(householdId, secret, event('ping'), { signature: 'f'.repeat(64) }),
    send(householdId, `wrong-${secret}`, event('ping')),
    send(householdId, secret, event('ping'), { timestamp: Math.floor(Date.now() / 1000) - 400 }),
    send(householdId, secret, event('ping'), { timestamp: Math.floor(Date.now() / 1000) + 400 }),
    send(householdId, secret, event('laundry_done'), { tamper: (raw) => raw.replace('laundry_done', 'filter_low') }),
    send(randomUUID(), secret, event('ping')),
  ]);
  assert(
    rejected.every((one) => one.status === 401),
    '没签名、签名乱写、密钥不对、时间戳早于 / 晚于 5 分钟、签完改正文、别的家庭：全部 401',
  );

  console.log('3. 洗完 / 烘完 → 通知 + 家务「晾衣服」');
  const stream = await openEventStream(BASE, member);
  streams.push(stream);
  await stream.waitFor((frame) => frame.event === 'hello', 2_000);
  const since = stream.frames.length;
  const laundry = event('laundry_done', { appliance: 'dryer', entityId: 'binary_sensor.dryer_running' });
  const dried = await send(householdId, secret, laundry);
  const hanging = (await tasksToday()).filter((one) => one.task.title === '晾衣服' && one.status === 'pending');
  const laundryNotices = await db.query(
    `SELECT count(*)::int AS n, min(title) AS title FROM notifications WHERE "householdId" = $1 AND type = 'smart_home_laundry_done'`,
    [householdId],
  );
  const activeMembers = await db.query(`SELECT count(*)::int AS n FROM members WHERE "householdId" = $1 AND "disabledAt" IS NULL`, [householdId]);
  assert(
    dried.status === 200 && hanging.length === 1 && laundryNotices.rows[0].n === activeMembers.rows[0].n &&
      laundryNotices.rows[0].title === '烘干机完成了，记得晾衣服',
    `烘干完成：今天多一件「晾衣服」，全家 ${activeMembers.rows[0].n} 人各收到「烘干机完成了，记得晾衣服」（${dried.body.data.result}）`,
  );
  const smartHomeAt = await stream.waitFor((frame) => changedDomains(frame).includes('smart-home'), 1_500, since);
  const tasksAt = await stream.waitFor((frame) => changedDomains(frame).includes('tasks'), 1_500, since);
  assert(
    smartHomeAt && tasksAt && stream.frames.indexOf(smartHomeAt) < stream.frames.indexOf(tasksAt) &&
      changedDomains(tasksAt).includes('notifications'),
    '/events 先推 smart-home，再推联动写到的 tasks、notifications',
  );
  const replay = await send(householdId, secret, laundry);
  const replayNotices = await db.query(
    `SELECT count(*)::int AS n FROM notifications WHERE "householdId" = $1 AND type = 'smart_home_laundry_done'`,
    [householdId],
  );
  assert(
    replay.status === 200 && replay.body.data.duplicate === true &&
      (await tasksToday()).filter((one) => one.task.title === '晾衣服').length === 1 &&
      replayNotices.rows[0].n === laundryNotices.rows[0].n,
    'HA 重发同一个事件：duplicate，不再建家务、不再发通知',
  );
  const washed = await send(householdId, secret, event('laundry_done', { appliance: 'washer' }));
  assert(
    washed.body.data.result.startsWith('今天已有「晾衣服」') &&
      (await tasksToday()).filter((one) => one.task.title === '晾衣服').length === 1,
    '洗衣机又完成一次（新事件）：今天已有没做的「晾衣服」就不重复建，只再通知',
  );

  console.log('4. 扫完 → 打勾今天的「扫地」');
  const nothing = await send(householdId, secret, event('vacuum_done', { entityId: 'vacuum.roborock_s8' }));
  assert(nothing.body.data.result === '今天没有待做的「扫地」家务', '今天没有扫地家务：什么都不做');
  const sweep = await request('/tasks', owner, 'POST', { title: '扫地（联动测试）', startsOn: today });
  const swept = await send(householdId, secret, event('vacuum_done', { entityId: 'vacuum.roborock_s8' }));
  const sweepToday = (await tasksToday()).find((one) => one.taskId === sweep.body.data.id);
  assert(
    swept.status === 200 && sweepToday.status === 'done' && swept.body.data.result.includes('扫地（联动测试）'),
    `扫地机扫完：今天的「扫地（联动测试）」自动打勾（${swept.body.data.result}）`,
  );

  console.log('5. 滤芯低 → 提醒 + 购物清单');
  const low = await send(householdId, secret, event('filter_low', { entityId: 'sensor.kitchen_purifier_ro_filter_life', value: 8 }));
  const filterTask = (await tasksToday()).find((one) => one.task.title === '换净水器滤芯');
  const reminder = await db.query(
    `SELECT r.status, count(rr.*)::int AS recipients FROM reminders r JOIN reminder_recipients rr ON rr."reminderId" = r.id
     WHERE r."sourceModule" = 'task' AND r."sourceId" = $1 GROUP BY r.status`,
    [filterTask?.taskId],
  );
  const shopping = await db.query(
    `SELECT count(*)::int AS n FROM shopping_items WHERE "householdId" = $1 AND "customName" = '净水器滤芯' AND checked = false`,
    [householdId],
  );
  assert(
    low.status === 200 && filterTask && filterTask.task.note === 'Home Assistant 报滤芯剩 8%' &&
      reminder.rows[0]?.status === 'scheduled' && reminder.rows[0].recipients >= 1 && shopping.rows[0].n === 1,
    `滤芯剩 8%：今天一件「换净水器滤芯」+ 给管理员的提醒 + 购物清单里一个「净水器滤芯」（${low.body.data.result}）`,
  );
  const lowAgain = await send(householdId, secret, event('filter_low', { value: 6 }));
  const shoppingAgain = await db.query(
    `SELECT count(*)::int AS n FROM shopping_items WHERE "householdId" = $1 AND "customName" = '净水器滤芯' AND checked = false`,
    [householdId],
  );
  assert(
    lowAgain.body.data.result === '今天已有「换净水器滤芯」；购物清单里已经有了' && shoppingAgain.rows[0].n === 1,
    '又报一次（新事件）：家务、购物清单都不重复加',
  );

  console.log('6. 联动开关、事件流水');
  const rules = after.body.data.rules;
  const off = await request('/smart-home/webhook-settings/rules', owner, 'PUT', { ...rules, vacuum: { ...rules.vacuum, enabled: false } });
  const ignored = await send(householdId, secret, event('vacuum_done'));
  const badRules = await request('/smart-home/webhook-settings/rules', owner, 'PUT', { ...rules, filter: { ...rules.filter, threshold: 0 } });
  assert(
    off.status === 200 && off.body.data.rules.vacuum.enabled === false && ignored.body.data.result === '这条联动在设置里关着' &&
      badRules.status === 400,
    '在设置页关掉「扫完打勾」：再来的事件只记不做；阈值越界 400',
  );
  await request('/smart-home/webhook-settings/rules', owner, 'PUT', rules);

  // R1：触发实体按「白名单设备 + 它名下的实体」引用
  const [{ id: dryerDevice }] = (
    await db.query(
      `INSERT INTO smart_home_devices ("householdId", "primaryEntityId", "primaryDomain", "displayName", icon, "knownEntityIds")
       VALUES ($1, 'binary_sensor.dryer_running', 'binary_sensor', '烘干机', 'dryer', '["binary_sensor.dryer_running", "sensor.dryer_left"]')
       RETURNING id`,
      [householdId],
    )
  ).rows;
  const refRules = (dryer) => ({ ...rules, laundry: { ...rules.laundry, dryer } });
  const refChecks = await Promise.all([
    request('/smart-home/webhook-settings/rules', owner, 'PUT', refRules({ deviceId: randomUUID(), entityId: 'binary_sensor.dryer_running' })),
    request('/smart-home/webhook-settings/rules', owner, 'PUT', refRules({ deviceId: dryerDevice, entityId: 'sensor.someone_else' })),
    request('/smart-home/webhook-settings/rules', owner, 'PUT', refRules('binary_sensor.dryer_running')),
  ]);
  const refOk = await request('/smart-home/webhook-settings/rules', owner, 'PUT', refRules({ deviceId: dryerDevice, entityId: 'sensor.dryer_left' }));
  assert(
    refChecks.every((one) => one.status === 400) &&
      refOk.status === 200 &&
      refOk.body.data.rules.laundry.dryer.deviceId === dryerDevice &&
      refOk.body.data.rules.laundry.dryer.entityId === 'sensor.dryer_left',
    '触发实体按「设备 + 它名下的某个实体」引用：设备不在白名单、实体不是它的、还按实体 ID 写都 400；设备的次要实体可以当触发',
  );
  await request('/smart-home/webhook-settings/rules', owner, 'PUT', rules);
  await db.query('DELETE FROM smart_home_devices WHERE id = $1', [dryerDevice]);

  const recent = await request('/smart-home/webhook-settings/events', owner);
  assert(
    recent.status === 200 && recent.body.data[0].result === '这条联动在设置里关着' && recent.body.data[0].status === 'ignored' &&
      recent.body.data.some((one) => one.event === 'filter_low' && one.status === 'processed'),
    '最近收到的事件（新的在前）带结果，管理员排查用',
  );

  console.log('7. 去重窗口');
  await db.query(
    `UPDATE smart_home_events SET "receivedAt" = now() - interval '11 minutes' WHERE "householdId" = $1 AND "eventId" = $2`,
    [householdId, laundry.eventId],
  );
  const later = await send(householdId, secret, laundry);
  assert(later.body.data.duplicate === false, '同一个事件 id 过了 10 分钟再来：当新事件处理');

  console.log('8. 密钥轮换与 24 小时宽限');
  const second = await request('/smart-home/webhook-settings/secret', owner, 'POST');
  const newSecret = second.body.data.secret;
  const withOld = await send(householdId, secret, event('ping'));
  const withNew = await send(householdId, newSecret, event('ping'));
  const graceHours = (Date.parse(second.body.data.previousValidUntil) - Date.now()) / 3_600_000;
  assert(
    newSecret !== secret && withOld.status === 200 && withNew.status === 200 && graceHours > 23.9 && graceHours <= 24,
    '轮换后新密钥立即可用，旧密钥还能用 24 小时（HA 那边改配置要时间）',
  );
  await db.query(
    `UPDATE smart_home_webhook_settings SET "previousValidUntil" = now() - interval '1 second' WHERE "householdId" = $1`,
    [householdId],
  );
  const expired = await send(householdId, secret, event('ping'));
  const stillNew = await send(householdId, newSecret, event('ping'));
  const view = await request('/smart-home/webhook-settings', owner);
  assert(
    expired.status === 401 && stillNew.status === 200 && view.body.data.previousValidUntil === null,
    '宽限期过了：旧密钥 401，新密钥照常',
  );

  console.log('\n智能家居 E3 webhook 黑盒全部通过');
} finally {
  for (const stream of streams) stream.close();
  const tasks = await db.query('SELECT id FROM household_tasks WHERE title = ANY($1)', [createdTaskTitles]);
  const ids = tasks.rows.map((row) => row.id);
  if (ids.length) {
    await db.query(`DELETE FROM reminder_recipients WHERE "reminderId" IN (SELECT id FROM reminders WHERE "sourceId" = ANY($1))`, [ids]);
    await db.query('DELETE FROM reminders WHERE "sourceId" = ANY($1)', [ids]);
    await db.query('UPDATE household_tasks SET "isArchived" = true WHERE id = ANY($1)', [ids]);
  }
  await db.query(`DELETE FROM shopping_items WHERE "customName" = '净水器滤芯'`);
  await db.query('DELETE FROM smart_home_events');
  await db.query('DELETE FROM smart_home_webhook_settings');
  await db.end();
}
