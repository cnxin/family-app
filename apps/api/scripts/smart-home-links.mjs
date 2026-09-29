// H3 E4 黑盒：小管家 → HA 的联动。规则校验与权限、家务打勾触发（不等 HA、同一次只跑一次、不匹配不跑、
// 关着不跑）、E3 联动自己打的勾不触发（防自激）、HA 失败不影响打勾且家庭动态记一句、日程开始前 N 分钟触发
// （太早不跑、只跑一次、改期后按新时间再跑）、HA 停掉时日历提醒照常。对面是 fake-ha.mjs。
// run-api-tests 把联动轮询设成 0.3 秒、命令超时 1.5 秒。
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { usageReport } from './usage-report-probe.mjs';
import { startFakeHomeAssistant } from './fake-ha.mjs';

const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const TOKEN = `ha-long-lived-${randomUUID()}`;

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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, timeoutMs, stepMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await wait(stepMs);
  }
  return false;
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
const titles = ['打扫卫生', '洗碗', '扫地（联动自激测试）', '打扫阳台', '打扫厨房'];
const eventTitles = [];

try {
  const ownerSession = await login('爸爸');
  const owner = ownerSession.accessToken;
  const member = (await login('妈妈')).accessToken;
  const householdId = ownerSession.member.householdId;
  const [{ timezone }] = (await db.query('SELECT timezone FROM households WHERE id = $1', [householdId])).rows;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'Asia/Shanghai' }).format(new Date());
  const calls = (service) => ha.serviceCalls.filter((call) => call.service === service);
  const createTask = async (title) => (await request('/tasks', owner, 'POST', { title, startsOn: today })).body.data.id;
  const complete = (taskId, token = member, status = 'done') =>
    request(`/tasks/${taskId}/instances/${today}`, token, 'PATCH', { status });

  await request('/smart-home/connector-settings', owner, 'PUT', { baseUrl: ha.url, credential: TOKEN });
  const add = async (body, patch) => {
    const id = (await request('/smart-home/devices', owner, 'POST', body)).body.data.id;
    await request(`/smart-home/devices/${id}`, owner, 'PATCH', patch);
    return id;
  };
  const vacuumId = await add({ haDeviceId: 'dev_roborock' }, { displayName: '扫地机', controllable: true });
  const sceneId = await add({ entityId: 'scene.movie_night' }, { displayName: '电影之夜', controllable: true });
  const curtainId = await add({ haDeviceId: 'dev_curtain' }, { displayName: '客厅窗帘' });

  console.log('1. 规则校验与权限');
  const link = (body) => request('/smart-home/links', owner, 'POST', body);
  const invalid = await Promise.all([
    link({ name: '窗帘', trigger: 'task_done', keyword: '打扫', targetDeviceId: curtainId, action: 'close' }),
    link({ name: '不在白名单', trigger: 'task_done', keyword: '打扫', targetDeviceId: randomUUID(), action: 'turn_on' }),
    link({ name: '动作不对', trigger: 'task_done', keyword: '打扫', targetDeviceId: vacuumId, action: 'open' }),
    link({ name: '', trigger: 'task_done', keyword: '打扫', targetDeviceId: vacuumId, action: 'start' }),
    link({ name: '提前太多', trigger: 'calendar_before', keyword: '电影', offsetMinutes: 721, targetDeviceId: sceneId, action: 'activate' }),
    link({ name: '旧写法', trigger: 'task_done', keyword: '打扫', targetEntityId: 'vacuum.roborock_s8', action: 'start' }),
  ]);
  const memberCreate = await request('/smart-home/links', member, 'POST', {
    name: '打扫就扫地', trigger: 'task_done', keyword: '打扫', targetDeviceId: vacuumId, action: 'start',
  });
  assert(
    invalid.every((one) => one.status === 400) && memberCreate.status === 403,
    '目标没开放控制 / 不在白名单 / 动作不对 / 没名字 / 提前超过 12 小时 / 还按实体 ID 指目标都 400；成员不能建联动',
  );
  const sweep = await link({ name: '打扫就扫地', trigger: 'task_done', keyword: '打扫', targetDeviceId: vacuumId, action: 'start' });
  const movie = await link({
    name: '电影夜', trigger: 'calendar_before', keyword: '电影', offsetMinutes: 5, targetDeviceId: sceneId, action: 'activate',
  });
  const selfLoop = await link({ name: '扫地就扫地', trigger: 'task_done', keyword: '扫地', targetDeviceId: vacuumId, action: 'return_to_base' });
  assert(
    sweep.status === 201 && sweep.body.data.offsetMinutes === 0 && movie.status === 201 && movie.body.data.offsetMinutes === 5 &&
      selfLoop.status === 201 && sweep.body.data.targetDeviceId === vacuumId && sweep.body.data.targetEntityId === 'vacuum.roborock_s8',
    '建了三条：打扫 → 扫地机开扫、电影开始前 5 分钟 → 电影之夜场景、扫地 → 扫地机回充',
  );

  console.log('2. 家务打勾 → 跑');
  const cleanId = await createTask('打扫卫生');
  let startedAt = Date.now();
  const done = await complete(cleanId);
  const doneMs = Date.now() - startedAt;
  assert(await until(() => calls('start').length === 1, 2_000), `妈妈把「打扫卫生」打勾：扫地机收到 vacuum.start（打勾接口 ${doneMs}ms 就回了）`);
  assert(done.status === 200 && done.body.data.status === 'done', '打勾本身照常成功');
  const audit = await db.query(`SELECT service, status FROM smart_home_commands WHERE service = 'vacuum.start'`);
  const firstRun = (await request('/smart-home/links', owner)).body.data.find((one) => one.id === sweep.body.data.id).lastRun;
  assert(
    audit.rows.length === 1 && audit.rows[0].status === 'succeeded' && firstRun.status === 'succeeded' &&
      firstRun.message.startsWith('「打扫卫生」打勾了'),
    '走 E2 的控制链路：审计里有这一条；规则上看得到最近一次运行',
  );
  const byLink = (await request('/smart-home/commands?source=link', owner)).body.data;
  const byHand = (await request('/smart-home/commands?source=manual', owner)).body.data;
  const badSource = await request('/smart-home/commands?source=webhook', owner);
  assert(
    byLink.length === 1 && byLink[0].source === 'link' && byLink[0].linkName === '打扫就扫地' && byLink[0].action === 'start' &&
      byHand.every((one) => one.source === 'manual' && one.linkName === null) && !byHand.some((one) => one.id === byLink[0].id) &&
      badSource.status === 400,
    '操作记录按来源筛（E5）：联动按的记 source=link 并带联动名，「手按」里没有它；不认识的来源 400',
  );
  const report = await usageReport(1);
  const [{ name: householdName }] = (await db.query('SELECT name FROM households WHERE id = $1', [householdId])).rows;
  const section = report.split('\n## ').find((part) => part.startsWith(`${householdName}（`)) ?? '';
  const [{ manual: manualCount, link: linkCount }] = (
    await db.query(
      `SELECT count(*) FILTER (WHERE source = 'manual')::int AS manual, count(*) FILTER (WHERE source = 'link')::int AS link
         FROM smart_home_commands WHERE "householdId" = $1`,
      [householdId],
    )
  ).rows;
  const total = (label) => {
    const line = section.split('\n').find((row) => row.startsWith(`| ${label} |`));
    return line ? Number(line.split('|').at(-3).trim()) : 0;
  };
  assert(
    linkCount === 1 && total('智能家居（联动控制）') === linkCount && total('智能家居（手动控制）') === manualCount &&
      section.includes('source = link，记在家庭主人名下'),
    `用量统计（usage-report.mjs）按来源分开数智能家居控制：联动 ${linkCount}、手动 ${manualCount}，与审计表一致`,
  );
  await complete(cleanId, member, 'pending');
  await complete(cleanId);
  await wait(500);
  assert(calls('start').length === 1, '同一天的同一件家务取消再打勾：不再跑第二次');
  const dishId = await createTask('洗碗');
  await complete(dishId);
  await wait(500);
  assert(calls('start').length === 1, '标题里没有关键词的家务：不跑');
  await request(`/smart-home/links/${sweep.body.data.id}`, owner, 'PATCH', { enabled: false });
  const balconyId = await createTask('打扫阳台');
  await complete(balconyId);
  await wait(500);
  assert(calls('start').length === 1, '规则关掉：不跑');
  await request(`/smart-home/links/${sweep.body.data.id}`, owner, 'PATCH', { enabled: true });

  console.log('3. 联动自己打的勾不触发（防自激）');
  const rotated = await request('/smart-home/webhook-settings/secret', owner, 'POST');
  const secret = rotated.body.data.secret;
  const loopTaskId = await createTask('扫地（联动自激测试）');
  const raw = JSON.stringify({ eventId: `ctx-${randomUUID()}`, event: 'vacuum_done' });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
  const webhook = await request(`/smart-home/webhook/${householdId}`, null, 'POST', raw, {
    'X-Family-Timestamp': timestamp,
    'X-Family-Signature': sha256(secret + sha256(`${secret}${timestamp}.${raw}`)),
  });
  await wait(600);
  const loopTask = (await request(`/tasks?start=${today}&end=${today}`, owner)).body.data.find((one) => one.taskId === loopTaskId);
  assert(
    webhook.status === 200 && loopTask.status === 'done' && calls('return_to_base').length === 0,
    'E3「扫完 → 打勾扫地」打的勾，不会再触发 E4「扫地 → 回充」',
  );

  console.log('4. HA 失败：打勾照常，动态里记一句');
  ha.serviceMode = 'fail';
  const kitchenId = await createTask('打扫厨房');
  startedAt = Date.now();
  const failedDone = await complete(kitchenId);
  const failedMs = Date.now() - startedAt;
  const failedRun = await until(async () => {
    const runs = await db.query(`SELECT status FROM smart_home_link_runs WHERE "occurrenceKey" = $1`, [`task:${kitchenId}:${today}`]);
    return runs.rows[0]?.status === 'failed';
  }, 3_000);
  const activity = await db.query(
    `SELECT summary, "actorName" FROM household_activity_logs WHERE action = 'smart_home_link_failed' ORDER BY "createdAt" DESC LIMIT 1`,
  );
  ha.serviceMode = 'ok';
  assert(failedDone.status === 200 && failedDone.body.data.status === 'done', `HA 报错：打勾照常成功（${failedMs}ms，没等 HA）`);
  assert(
    failedRun && activity.rows[0]?.summary === '联动「打扫就扫地」没执行成功' && activity.rows[0].actorName === '智能家居联动',
    '这次运行记失败，家庭动态里记一句「联动没执行成功」',
  );

  console.log('5. 日程开始前 N 分钟');
  const event = async (title, minutesFromNow) => {
    eventTitles.push(title);
    const startsAt = new Date(Date.now() + minutesFromNow * 60_000);
    return (await request('/calendar-events', owner, 'POST', { date: today, startsAt: startsAt.toISOString(), title })).body.data;
  };
  const scene = () => calls('turn_on').filter((call) => call.domain === 'scene').length;
  const later = await event('周末电影（还早）', 30);
  const soon = await event('家庭电影夜', 4);
  assert(await until(() => scene() === 1, 3_000), '「家庭电影夜」4 分钟后开始、规则是提前 5 分钟：到点跑了电影之夜场景');
  await wait(1_000);
  assert(scene() === 1, '多轮轮询过去仍然只跑一次；30 分钟后才开始的「周末电影」还没到点');
  const moved = await request(`/calendar-events/${soon.id}`, owner, 'PATCH', {
    startsAt: new Date(Date.now() + 3 * 60_000).toISOString(),
  });
  assert(moved.status === 200 && (await until(() => scene() === 2, 3_000)), '日程改了时间：按新时间再跑一次');
  await request(`/calendar-events/${later.id}`, owner, 'PATCH', { startsAt: new Date(Date.now() + 60 * 60_000).toISOString() });

  console.log('6. HA 停掉：联动失败，日历提醒照常');
  const [{ id: momId }] = (await db.query(`SELECT id FROM members WHERE "householdId" = $1 AND role = 'member' AND "disabledAt" IS NULL LIMIT 1`, [householdId])).rows;
  await ha.stop();
  const withReminder = await event('电影首映', 4);
  const reminder = await request('/reminders', owner, 'POST', {
    sourceModule: 'calendar',
    sourceId: withReminder.id,
    remindAt: new Date(Date.now() + 1_000).toISOString(),
    recipientIds: [momId],
  });
  const reminded = await until(async () => {
    const rows = await db.query(
      `SELECT 1 FROM notifications WHERE type = 'reminder_due' AND "sourceId" = $1`,
      [reminder.body.data.id],
    );
    return rows.rows.length > 0;
  }, 5_000);
  const haDownRun = await until(async () => {
    const rows = await db.query(
      `SELECT status FROM smart_home_link_runs WHERE "occurrenceKey" LIKE $1`,
      [`calendar:${withReminder.id}:%`],
    );
    return rows.rows[0]?.status === 'failed';
  }, 5_000);
  assert(reminder.status === 201 && reminded, 'HA 停掉：日历提醒照常发到妈妈那里');
  assert(haDownRun, '同一场日程的联动这次记失败，不影响提醒');

  console.log('7. 被联动引用的设备、删除');
  const blockedRemove = await request(`/smart-home/devices/${sceneId}`, owner, 'DELETE');
  assert(
    blockedRemove.status === 409 && blockedRemove.body.error.message.includes('电影夜'),
    '还有联动在用的设备移不出白名单，说清是哪条（不级联删除，免得联动悄悄失效）',
  );
  const removed = await request(`/smart-home/links/${movie.body.data.id}`, owner, 'DELETE');
  const again = await request(`/smart-home/links/${movie.body.data.id}`, owner, 'DELETE');
  const runsLeft = await db.query(`SELECT count(*)::int AS n FROM smart_home_link_runs WHERE "linkId" = $1`, [movie.body.data.id]);
  assert(removed.status === 200 && again.status === 404 && runsLeft.rows[0].n === 0, '删掉联动（运行记录一起删）；再删 404');

  console.log('\n智能家居 E4 联动黑盒全部通过');
} finally {
  await db.query('DELETE FROM smart_home_links');
  const tasks = await db.query('SELECT id FROM household_tasks WHERE title = ANY($1)', [titles]);
  if (tasks.rows.length) {
    await db.query('UPDATE household_tasks SET "isArchived" = true WHERE id = ANY($1)', [tasks.rows.map((row) => row.id)]);
  }
  if (eventTitles.length) {
    const events = await db.query('SELECT id FROM calendar_events WHERE title = ANY($1)', [eventTitles]);
    const ids = events.rows.map((row) => row.id);
    await db.query(`DELETE FROM reminder_recipients WHERE "reminderId" IN (SELECT id FROM reminders WHERE "sourceId" = ANY($1))`, [ids]);
    await db.query('DELETE FROM reminders WHERE "sourceId" = ANY($1)', [ids]);
    await db.query('DELETE FROM calendar_events WHERE id = ANY($1)', [ids]);
  }
  await db.query('DELETE FROM smart_home_commands');
  await db.query('DELETE FROM smart_home_events');
  await db.query('DELETE FROM smart_home_webhook_settings');
  await db.query(`DELETE FROM smart_home_devices WHERE "householdId" IN (SELECT "householdId" FROM members WHERE name = '爸爸')`);
  await db.query(`DELETE FROM integrations WHERE kind = 'home_assistant'`);
  await ha.stop();
  await db.end();
}
