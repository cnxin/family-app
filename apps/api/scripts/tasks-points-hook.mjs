// J1b.3：任务 → 积分改走事务内钩子（tasks.completed / tasks.uncompleted）后，事务语义不变：
// 积分写失败 → 任务不变成已完成；冲销写失败 → 任务保持已完成；重复打勾 / 重复取消不重复记；并发打勾只记一次；
// 失败过的操作不占用积分幂等键（去掉故障重来照常记第 1 版）。故障用数据库触发器注入。
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';

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
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, data: json?.data, error: json?.error };
}

const db = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});

const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const failFunction = `j1b_fail_points_${suffix}`;
const failTrigger = `j1b_fail_points_ledger_${suffix}`;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());

/** 让积分流水里满足条件的插入失败（条件是触发器 WHEN 子句）。 */
async function injectFailure(when) {
  await db.query(`
    CREATE OR REPLACE FUNCTION ${failFunction}() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'J1b 黑盒：强制积分写失败';
    END;
    $$ LANGUAGE plpgsql`);
  await db.query(`CREATE TRIGGER ${failTrigger} BEFORE INSERT ON points_ledger FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION ${failFunction}()`);
}

async function removeFailure() {
  await db.query(`DROP TRIGGER IF EXISTS ${failTrigger} ON points_ledger`);
}

async function snapshot(taskId, memberId) {
  const [instance, ledger, account, notifications, activities] = await Promise.all([
    db.query(
      `SELECT status, "resolvedById", "pointsAwardVersion", "pointsLedgerId" FROM household_task_instances WHERE "taskId" = $1`,
      [taskId],
    ),
    db.query(
      `SELECT l.type, l.delta, l."idempotencyKey" FROM points_ledger l
        WHERE (l."sourceType" = 'task' AND l."sourceId" LIKE $1 || ':%')
           OR l."reversesLedgerId" IN (SELECT id FROM points_ledger WHERE "sourceType" = 'task' AND "sourceId" LIKE $1 || ':%')
        ORDER BY l."createdAt", l."idempotencyKey"`,
      [taskId],
    ),
    db.query(`SELECT balance FROM points_accounts WHERE "memberId" = $1`, [memberId]),
    db.query(`SELECT type FROM notifications WHERE "sourceId" = $1 ORDER BY "createdAt", type`, [taskId]),
    db.query(
      `SELECT action FROM household_activity_logs WHERE module = 'points' AND metadata->>'taskId' = $1 ORDER BY "createdAt", action`,
      [taskId],
    ),
  ]);
  return {
    instance: instance.rows[0] ?? null,
    ledger: ledger.rows.map((row) => `${row.type}:${row.delta}:${row.idempotencyKey.replace(/^task:[^:]+:/, '')}`),
    balance: account.rows[0]?.balance ?? 0,
    notifications: notifications.rows.map((row) => row.type),
    activities: activities.rows.map((row) => row.action),
  };
}

await db.connect();

try {
  const owner = await request('/auth/login', null, 'POST', { loginName: '爸爸', password: PASSWORD });
  const helper = await request('/auth/login', null, 'POST', { loginName: '妈妈', password: PASSWORD });
  assert(owner.status === 201 && helper.status === 201, '任务积分钩子测试的两个账号可以登录');
  const helperId = helper.data.member.id;
  const task = await request('/tasks', owner.data.accessToken, 'POST', {
    title: `J1b 积分钩子任务 ${suffix}`,
    startsOn: today,
    recurrence: 'once',
    defaultAssigneeId: helperId,
    rewardPoints: 20,
  });
  assert(task.status === 201, '管理员建了一个 20 分、分给妈妈的任务');
  const taskId = task.data.id;
  const mark = (status, token = helper.data.accessToken) =>
    request(`/tasks/${taskId}/instances/${today}`, token, 'PATCH', { status });
  const start = await snapshot(taskId, helperId);

  console.log('1. 打勾时积分写失败');
  await injectFailure(`NEW."sourceType" = 'task' AND NEW."sourceId" LIKE '${taskId}:%'`);
  const failedDone = await mark('done');
  await removeFailure();
  assert(failedDone.status === 500, '积分写失败时打勾整体报错');
  assert(
    JSON.stringify(await snapshot(taskId, helperId)) === JSON.stringify(start),
    '任务没有变成已完成（实例都没落），积分、通知、动态都没有写',
  );

  console.log('2. 去掉故障后打勾、重复打勾');
  const done = await mark('done');
  const doneAgain = await mark('done');
  const afterDone = await snapshot(taskId, helperId);
  assert(
    done.status === 200 && done.data.pointsAwarded === true && doneAgain.status === 200 && doneAgain.data.pointsAwarded === true,
    '打勾成功，重复打勾仍显示已发积分',
  );
  assert(
    afterDone.instance.status === 'done' &&
      afterDone.instance.pointsAwardVersion === 1 &&
      afterDone.instance.pointsLedgerId &&
      JSON.stringify(afterDone.ledger) === JSON.stringify(['award:20:award:1']) &&
      afterDone.balance === start.balance + 20 &&
      JSON.stringify(afterDone.notifications) === JSON.stringify([...start.notifications, 'task_completed']) &&
      JSON.stringify(afterDone.activities) === JSON.stringify([...start.activities, 'task_points_awarded']),
    '失败那次没占用幂等键：只记了第 1 版 20 分，实例记下版本与流水，重复打勾不重复记',
  );

  console.log('3. 取消打勾时冲销写失败');
  await injectFailure(`NEW."reversesLedgerId" = '${afterDone.instance.pointsLedgerId}'`);
  const failedUndo = await mark('pending');
  await removeFailure();
  assert(failedUndo.status === 500, '冲销写失败时取消打勾整体报错');
  assert(
    JSON.stringify(await snapshot(taskId, helperId)) === JSON.stringify(afterDone),
    '任务保持已完成，积分流水、余额、实例上的流水 id 都没变',
  );

  console.log('4. 去掉故障后取消、重复取消、再打勾');
  const undo = await mark('pending');
  const undoAgain = await mark('pending');
  const afterUndo = await snapshot(taskId, helperId);
  assert(
    undo.status === 200 &&
      undo.data.pointsAwarded === false &&
      undoAgain.status === 200 &&
      afterUndo.instance.status === 'pending' &&
      afterUndo.instance.pointsLedgerId === null &&
      afterUndo.instance.pointsAwardVersion === 1 &&
      JSON.stringify(afterUndo.ledger) === JSON.stringify(['award:20:award:1', 'reversal:-20:reverse:1']) &&
      afterUndo.balance === start.balance,
    '取消打勾冲销一次，重复取消不重复冲销，余额回到原值',
  );
  const redo = await mark('done');
  const afterRedo = await snapshot(taskId, helperId);
  assert(
    redo.status === 200 &&
      afterRedo.instance.pointsAwardVersion === 2 &&
      afterRedo.ledger.at(-1) === 'award:20:award:2' &&
      afterRedo.balance === start.balance + 20,
    '再次打勾记第 2 版积分',
  );

  console.log('5. 管理员改成跳过、两个人同时打勾');
  const skipped = await mark('skipped', owner.data.accessToken);
  const racing = await Promise.all([mark('done'), mark('done', owner.data.accessToken)]);
  const afterRace = await snapshot(taskId, helperId);
  assert(
    skipped.status === 200 &&
      racing.every((response) => response.status === 200) &&
      afterRace.instance.status === 'done' &&
      afterRace.instance.pointsAwardVersion === 3 &&
      JSON.stringify(afterRace.ledger) ===
        JSON.stringify([
          'award:20:award:1',
          'reversal:-20:reverse:1',
          'award:20:award:2',
          'reversal:-20:reverse:2',
          'award:20:award:3',
        ]) &&
      afterRace.balance === start.balance + 20 &&
      JSON.stringify(afterRace.activities) ===
        JSON.stringify([
          'task_points_awarded',
          'task_points_reversed',
          'task_points_awarded',
          'task_points_reversed',
          'task_points_awarded',
        ]),
    '跳过冲销第 2 版；同时打勾只记一次第 3 版，流水与动态一一对应',
  );
} finally {
  await removeFailure();
  await db.query(`DROP FUNCTION IF EXISTS ${failFunction}()`);
  await db.end();
}
