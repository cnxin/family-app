// J1b.4：智能家居联动要建的家务 / 提醒 / 清单项改走事务内钩子 smart-home.link-fired（任务、提醒、购物各自订阅），
// 家务打勾改由内核事件总线通知智能家居之后：
// - 任一订阅方写失败（家务 / 提醒 / 清单项，故障用触发器注入），整条联动回滚，webhook 记 failed；
// - 「提醒」模块被家庭关掉时联动照旧建提醒、「积分」关掉时打勾照旧记积分（今天的行为：模块开关只管显示）；
// - 家务打勾 → 联动规则收到事件跑一次；联动自己打的勾不再触发联动。
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const FILTER_TASK = '换净水器滤芯';
const FILTER_ITEM = '净水器滤芯';

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

const db = new pg.Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});

const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const failFunction = `j1b_fail_link_${suffix}`;
const triggers = [];
const keyword = `J1b倒垃圾${suffix}`;
const createdTitles = [FILTER_TASK, `${keyword}`, `扫地${keyword}`, `J1b 积分关着 ${suffix}`];

async function injectFailure(table, when) {
  const name = `j1b_fail_${table}_${suffix}`;
  await db.query(`
    CREATE OR REPLACE FUNCTION ${failFunction}() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'J1b 黑盒：强制联动订阅方写失败';
    END;
    $$ LANGUAGE plpgsql`);
  await db.query(`CREATE TRIGGER ${name} BEFORE INSERT ON ${table} FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION ${failFunction}()`);
  triggers.push({ name, table });
  return name;
}

async function removeFailure(name) {
  const index = triggers.findIndex((one) => one.name === name);
  const [{ table }] = triggers.splice(index, 1);
  await db.query(`DROP TRIGGER IF EXISTS ${name} ON ${table}`);
}

async function waitFor(check, timeoutMs = 5000) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

await db.connect();

let householdId = null;
try {
  const ownerSession = await login('爸爸');
  const owner = ownerSession.accessToken;
  const helperSession = await login('妈妈');
  householdId = ownerSession.member.householdId;
  const [{ timezone }] = (await db.query('SELECT timezone FROM households WHERE id = $1', [householdId])).rows;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'Asia/Shanghai' }).format(new Date());
  const rotated = await request('/smart-home/webhook-settings/secret', owner, 'POST');
  assert(rotated.status === 201, '联动钩子测试：管理员生成 webhook 密钥');
  const secret = rotated.body.data.secret;
  const send = (event, extra = {}) => {
    const eventId = `j1b-${randomUUID()}`;
    const raw = JSON.stringify({ eventId, event, ...extra });
    const timestamp = String(Math.floor(Date.now() / 1000));
    return request(`/smart-home/webhook/${householdId}`, null, 'POST', raw, {
      'X-Family-Timestamp': timestamp,
      'X-Family-Signature': sign(secret, timestamp, raw),
    }).then((response) => ({ ...response, eventId }));
  };
  const filterState = async () => {
    const [tasks, reminders, shopping] = await Promise.all([
      db.query(
        `SELECT id FROM household_tasks WHERE "householdId" = $1 AND title = $2 AND NOT "isArchived" AND "startsOn" = $3`,
        [householdId, FILTER_TASK, today],
      ),
      db.query(
        `SELECT r.id, (SELECT count(*)::int FROM reminder_recipients rr WHERE rr."reminderId" = r.id) AS recipients
           FROM reminders r JOIN household_tasks t ON t.id::text = r."sourceId"::text
          WHERE r."householdId" = $1 AND t.title = $2 AND NOT t."isArchived"`,
        [householdId, FILTER_TASK],
      ),
      db.query(`SELECT id FROM shopping_items WHERE "householdId" = $1 AND "customName" = $2 AND NOT checked`, [householdId, FILTER_ITEM]),
    ]);
    return { tasks: tasks.rows.length, reminders: reminders.rows, shopping: shopping.rows.length };
  };
  const eventStatus = async (eventId) =>
    (await db.query('SELECT status FROM smart_home_events WHERE "householdId" = $1 AND "eventId" = $2', [householdId, eventId])).rows[0]
      ?.status;
  const empty = JSON.stringify({ tasks: 0, reminders: [], shopping: 0 });
  assert(JSON.stringify(await filterState()) === empty, '开始时今天没有「换净水器滤芯」、清单里没有没买的滤芯');

  console.log('1. 滤芯低：三个订阅方分别写失败');
  for (const [label, table, when] of [
    ['建家务', 'household_tasks', `NEW."householdId" = '${householdId}' AND NEW.title = '${FILTER_TASK}'`],
    ['建提醒', 'reminders', `NEW."householdId" = '${householdId}' AND NEW."sourceModule" = 'task'`],
    ['加清单项', 'shopping_items', `NEW."householdId" = '${householdId}' AND NEW."customName" = '${FILTER_ITEM}'`],
  ]) {
    const failure = await injectFailure(table, when);
    const failed = await send('filter_low', { value: 7 });
    await removeFailure(failure);
    assert(
      failed.status === 200 &&
        failed.body.data.result.startsWith('联动失败') &&
        (await eventStatus(failed.eventId)) === 'failed' &&
        JSON.stringify(await filterState()) === empty,
      `${label}失败：整条联动回滚，家务、提醒、清单项都没有落，事件记 failed`,
    );
  }

  console.log('2. 家庭关掉「提醒」模块后滤芯低');
  const off = await request('/system/modules/reminders', owner, 'PATCH', { override: 'off' });
  const low = await send('filter_low', { value: 7 });
  const afterLow = await filterState();
  const admins = await db.query(
    `SELECT count(*)::int AS n FROM members WHERE "householdId" = $1 AND "disabledAt" IS NULL AND role IN ('owner', 'admin')`,
    [householdId],
  );
  assert(
    off.status === 200 &&
      low.status === 200 &&
      low.body.data.result === `建了家务「${FILTER_TASK}」并提醒 ${admins.rows[0].n} 位管理员；把「${FILTER_ITEM}」加进了购物清单` &&
      (await eventStatus(low.eventId)) === 'processed' &&
      afterLow.tasks === 1 &&
      afterLow.reminders.length === 1 &&
      afterLow.reminders[0].recipients === admins.rows[0].n &&
      afterLow.shopping === 1,
    '模块开关只管显示：照旧建家务、挂在它上面的提醒（收件人是管理员）和清单项',
  );
  await request('/system/modules/reminders', owner, 'PATCH', { override: null });

  console.log('3. 家务打勾 → 联动规则经事件总线收到');
  const [link] = (
    await db.query(
      `INSERT INTO smart_home_links ("householdId", name, trigger, keyword, "offsetMinutes", "targetEntityId", action, enabled, "createdById")
       VALUES ($1, $2, 'task_done', $3, 0, 'light.j1b', 'turn_on', true, $4) RETURNING id`,
      [householdId, `J1b 联动 ${suffix}`, keyword, ownerSession.member.id],
    )
  ).rows;
  const trash = await request('/tasks', owner, 'POST', { title: keyword, startsOn: today, recurrence: 'once' });
  const trashDone = await request(`/tasks/${trash.body.data.id}/instances/${today}`, owner, 'PATCH', { status: 'done' });
  const runs = await waitFor(async () => {
    const rows = (
      await db.query(`SELECT "occurrenceKey", status, message FROM smart_home_link_runs WHERE "linkId" = $1 AND "finishedAt" IS NOT NULL`, [
        link.id,
      ])
    ).rows;
    return rows.length ? rows : null;
  });
  assert(
    trashDone.status === 200 &&
      runs?.length === 1 &&
      runs[0].occurrenceKey === `task:${trash.body.data.id}:${today}` &&
      runs[0].status === 'failed' &&
      runs[0].message === `「${keyword}」打勾了：目标设备已经不在白名单里了`,
    '打勾后联动规则跑了一次（目标设备不在白名单里，记失败），发生键与原因带着家务 id、日期和标题',
  );

  console.log('4. 联动自己打的勾不再触发联动');
  const sweep = await request('/tasks', owner, 'POST', { title: `扫地${keyword}`, startsOn: today, recurrence: 'once' });
  const vacuum = await send('vacuum_done');
  const sweepDone = await waitFor(async () => {
    const rows = (
      await db.query(`SELECT status FROM household_task_instances WHERE "taskId" = $1 AND "dueDate" = $2`, [sweep.body.data.id, today])
    ).rows;
    return rows[0]?.status === 'done';
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const runsAfterVacuum = await db.query('SELECT count(*)::int AS n FROM smart_home_link_runs WHERE "linkId" = $1', [link.id]);
  assert(
    vacuum.status === 200 && vacuum.body.data.result.includes(`「扫地${keyword}」`) && sweepDone && runsAfterVacuum.rows[0].n === 1,
    '扫完由联动打勾，名字里带关键词也不再触发联动规则',
  );

  console.log('5. 家庭关掉「积分」模块后打勾');
  const pointsOff = await request('/system/modules/points', owner, 'PATCH', { override: 'off' });
  const pointTask = await request('/tasks', owner, 'POST', {
    title: `J1b 积分关着 ${suffix}`,
    startsOn: today,
    recurrence: 'once',
    defaultAssigneeId: helperSession.member.id,
    rewardPoints: 10,
  });
  const pointDone = await request(`/tasks/${pointTask.body.data.id}/instances/${today}`, helperSession.accessToken, 'PATCH', {
    status: 'done',
  });
  const awards = await db.query(
    `SELECT count(*)::int AS n FROM points_ledger WHERE "sourceType" = 'task' AND "sourceId" = $1`,
    [`${pointTask.body.data.id}:${today}`],
  );
  assert(
    pointsOff.status === 200 && pointDone.status === 200 && pointDone.body.data.pointsAwarded === true && awards.rows[0].n === 1,
    '模块开关只管显示：照旧记积分',
  );
  await request('/system/modules/points', owner, 'PATCH', { override: null });
} finally {
  for (const { name, table } of triggers) await db.query(`DROP TRIGGER IF EXISTS ${name} ON ${table}`);
  await db.query(`DROP FUNCTION IF EXISTS ${failFunction}()`);
  if (householdId) {
    const tasks = await db.query('SELECT id FROM household_tasks WHERE "householdId" = $1 AND title = ANY($2)', [householdId, createdTitles]);
    const ids = tasks.rows.map((row) => row.id);
    if (ids.length) {
      await db.query(`DELETE FROM reminder_recipients WHERE "reminderId" IN (SELECT id FROM reminders WHERE "sourceId" = ANY($1))`, [ids]);
      await db.query('DELETE FROM reminders WHERE "sourceId" = ANY($1)', [ids]);
      await db.query('UPDATE household_tasks SET "isArchived" = true WHERE id = ANY($1)', [ids]);
    }
    await db.query(`DELETE FROM shopping_items WHERE "householdId" = $1 AND "customName" = $2`, [householdId, FILTER_ITEM]);
    await db.query(`DELETE FROM smart_home_link_runs WHERE "linkId" IN (SELECT id FROM smart_home_links WHERE keyword = $1)`, [keyword]);
    await db.query('DELETE FROM smart_home_links WHERE keyword = $1', [keyword]);
    await db.query('DELETE FROM smart_home_events WHERE "householdId" = $1', [householdId]);
    await db.query('DELETE FROM smart_home_webhook_settings WHERE "householdId" = $1', [householdId]);
    await db.query(`DELETE FROM household_module_overrides WHERE household_id = $1 AND key IN ('reminders', 'points')`, [householdId]);
  }
  await db.end();
}
