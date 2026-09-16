import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const TASK_DATE = '2199-12-18';

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

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', {
    loginName,
    password: PASSWORD,
  });
  assert(response.status === 201, `${loginName}可以登录积分模块`);
  return response.data;
}

async function balance(token, memberId) {
  const response = await request('/points/accounts', token);
  return response.data.find((account) => account.memberId === memberId)?.balance;
}

const db = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});

await db.connect();
const other = {
  householdId: randomUUID(),
  memberId: randomUUID(),
  rewardId: randomUUID(),
};

try {
  const owner = await login('爸爸');
  const member = await login('妈妈');

  console.log('1. 积分账户、权限、幂等与并发');
  const accounts = await request('/points/accounts', member.accessToken);
  assert(
    accounts.status === 200 &&
      accounts.data.length === 2 &&
      accounts.data.every((account) => account.balance === 0),
    '首次读取为家庭成员建立零余额账户',
  );

  const forbiddenAdjustment = await request(
    '/points/adjustments',
    member.accessToken,
    'POST',
    {
      memberId: member.member.id,
      delta: 100,
      idempotencyKey: randomUUID(),
    },
  );
  const forbiddenReward = await request('/rewards', member.accessToken, 'POST', {
    name: '不应创建的奖励',
    cost: 1,
  });
  assert(
    forbiddenAdjustment.status === 403 && forbiddenReward.status === 403,
    '普通成员不能调整积分或维护奖励目录',
  );

  const grantKey = randomUUID();
  const grantBody = {
    memberId: member.member.id,
    delta: 120,
    note: '积分回归初始发放',
    idempotencyKey: grantKey,
  };
  const grant = await request(
    '/points/adjustments',
    owner.accessToken,
    'POST',
    grantBody,
  );
  const duplicateGrant = await request(
    '/points/adjustments',
    owner.accessToken,
    'POST',
    grantBody,
  );
  const conflictingGrant = await request(
    '/points/adjustments',
    owner.accessToken,
    'POST',
    { ...grantBody, delta: 121 },
  );
  assert(
    grant.status === 201 &&
      duplicateGrant.status === 201 &&
      duplicateGrant.data.id === grant.data.id &&
      conflictingGrant.status === 409 &&
      (await balance(owner.accessToken, member.member.id)) === 120,
    '重复幂等键只发放一次且拒绝不同载荷复用',
  );

  const concurrentKey = randomUUID();
  const concurrentBody = {
    memberId: member.member.id,
    delta: 10,
    note: '并发幂等发放',
    idempotencyKey: concurrentKey,
  };
  const concurrent = await Promise.all([
    request('/points/adjustments', owner.accessToken, 'POST', concurrentBody),
    request('/points/adjustments', owner.accessToken, 'POST', concurrentBody),
  ]);
  assert(
    concurrent.every((item) => item.status === 201) &&
      concurrent[0].data.id === concurrent[1].data.id &&
      (await balance(owner.accessToken, member.member.id)) === 130,
    '并发重复请求由幂等锁合并为一笔积分流水',
  );

  console.log('2. 奖励兑换、审批、退回与余额不足');
  const reward = await request('/rewards', owner.accessToken, 'POST', {
    name: `积分回归奖励-${randomUUID().slice(0, 8)}`,
    description: '用于验证兑换完整状态机',
    cost: 40,
  });
  const expensive = await request('/rewards', owner.accessToken, 'POST', {
    name: `高积分奖励-${randomUUID().slice(0, 8)}`,
    cost: 1000,
  });
  assert(
    reward.status === 201 && expensive.status === 201,
    '管理员可以创建家庭奖励并设置兑换积分',
  );

  // 以下三条守的是请求校验管道（points 已从 class-validator DTO 换成契约 schema）。
  const emptyKey = await request(
    `/rewards/${reward.data.id}/redemptions`,
    member.accessToken,
    'POST',
    { idempotencyKey: '' },
  );
  assert(
    emptyKey.status === 400,
    '空幂等键被请求校验拒绝（契约 min(1)，原 DTO 只限了最大长度）',
  );

  const badDecision = await request(
    `/reward-redemptions/${randomUUID()}/decision`,
    owner.accessToken,
    'POST',
    { decision: '再想想', idempotencyKey: randomUUID() },
  );
  assert(badDecision.status === 400, '未知审批动作被请求校验拒绝');

  // rewardsQuery 用 .catch(undefined) 保住了原来的容忍：非 true/false 不报错，按"不含停用项"处理
  const looseFlag = await request('/rewards?includeInactive=yes', owner.accessToken);
  assert(
    looseFlag.status === 200 &&
      looseFlag.data.every((item) => item.isActive),
    '奖励目录对无法识别的 includeInactive 仍按不含停用项处理',
  );

  const redeemKey = randomUUID();
  const redemption = await request(
    `/rewards/${reward.data.id}/redemptions`,
    member.accessToken,
    'POST',
    { note: '第一次兑换', idempotencyKey: redeemKey },
  );
  const duplicateRedemption = await request(
    `/rewards/${reward.data.id}/redemptions`,
    member.accessToken,
    'POST',
    { note: '第一次兑换', idempotencyKey: redeemKey },
  );
  const insufficient = await request(
    `/rewards/${expensive.data.id}/redemptions`,
    member.accessToken,
    'POST',
    { idempotencyKey: randomUUID() },
  );
  assert(
    redemption.status === 201 &&
      redemption.data.status === 'pending' &&
      duplicateRedemption.data.id === redemption.data.id &&
      insufficient.status === 400 &&
      (await balance(member.accessToken, member.member.id)) === 90,
    '兑换申请立即扣分、重复申请不重复扣分且余额不足被拒绝',
  );

  const decisionKey = randomUUID();
  const approved = await request(
    `/reward-redemptions/${redemption.data.id}/decision`,
    owner.accessToken,
    'POST',
    { decision: 'approve', note: '回归确认通过', idempotencyKey: decisionKey },
  );
  const duplicateDecision = await request(
    `/reward-redemptions/${redemption.data.id}/decision`,
    owner.accessToken,
    'POST',
    { decision: 'approve', note: '回归确认通过', idempotencyKey: decisionKey },
  );
  const conflictingDecision = await request(
    `/reward-redemptions/${redemption.data.id}/decision`,
    owner.accessToken,
    'POST',
    { decision: 'reject', idempotencyKey: randomUUID() },
  );
  assert(
    approved.status === 201 &&
      duplicateDecision.status === 201 &&
      duplicateDecision.data.status === 'approved' &&
      conflictingDecision.status === 409 &&
      (await balance(member.accessToken, member.member.id)) === 90,
    '审批操作幂等且已确认兑换不会重复扣分或改判',
  );

  const reversed = await request(
    `/reward-redemptions/${redemption.data.id}/reverse`,
    owner.accessToken,
    'POST',
    { note: '管理员撤销履约', idempotencyKey: randomUUID() },
  );
  assert(
    reversed.status === 201 &&
      reversed.data.status === 'reversed' &&
      (await balance(member.accessToken, member.member.id)) === 130,
    '管理员撤销已确认兑换并通过反向流水退回积分',
  );

  const rejectedRequest = await request(
    `/rewards/${reward.data.id}/redemptions`,
    member.accessToken,
    'POST',
    { idempotencyKey: randomUUID() },
  );
  const rejected = await request(
    `/reward-redemptions/${rejectedRequest.data.id}/decision`,
    owner.accessToken,
    'POST',
    { decision: 'reject', note: '本次不批准', idempotencyKey: randomUUID() },
  );
  const cancelledRequest = await request(
    `/rewards/${reward.data.id}/redemptions`,
    member.accessToken,
    'POST',
    { idempotencyKey: randomUUID() },
  );
  const cancelled = await request(
    `/reward-redemptions/${cancelledRequest.data.id}/cancel`,
    member.accessToken,
    'POST',
    { note: '申请人主动取消', idempotencyKey: randomUUID() },
  );
  assert(
    rejected.status === 201 &&
      rejected.data.status === 'rejected' &&
      cancelled.status === 201 &&
      cancelled.data.status === 'cancelled' &&
      (await balance(member.accessToken, member.member.id)) === 130,
    '拒绝和申请人取消都会写反向流水并完整退回积分',
  );

  const memberRedemptions = await request('/reward-redemptions', member.accessToken);
  const notifications = await request('/notifications?includeRead=true', member.accessToken);
  assert(
    memberRedemptions.data.every((item) => item.memberId === member.member.id) &&
      notifications.data.some(
        (item) => item.module === 'points' && item.sourceId === redemption.data.id,
      ),
    '成员只能读取自己的兑换且能收到审批状态通知',
  );

  console.log('3. 任务积分、恢复冲销与管理员配置边界');
  const forbiddenPointTask = await request('/tasks', member.accessToken, 'POST', {
    title: '普通成员不应配置积分',
    startsOn: TASK_DATE,
    recurrence: 'once',
    rewardPoints: 10,
  });
  const task = await request('/tasks', owner.accessToken, 'POST', {
    title: '积分回归任务',
    startsOn: TASK_DATE,
    recurrence: 'once',
    defaultAssigneeId: member.member.id,
    rewardPoints: 30,
  });
  const completed = await request(
    `/tasks/${task.data.id}/instances/${TASK_DATE}`,
    member.accessToken,
    'PATCH',
    { status: 'done' },
  );
  const duplicateComplete = await request(
    `/tasks/${task.data.id}/instances/${TASK_DATE}`,
    member.accessToken,
    'PATCH',
    { status: 'done' },
  );
  assert(
    forbiddenPointTask.status === 403 &&
      task.status === 201 &&
      completed.data.pointsAwarded === true &&
      duplicateComplete.data.pointsAwarded === true &&
      (await balance(member.accessToken, member.member.id)) === 160,
    '只有管理员可配置任务积分且重复完成不会重复发放',
  );
  const restored = await request(
    `/tasks/${task.data.id}/instances/${TASK_DATE}`,
    member.accessToken,
    'PATCH',
    { status: 'pending' },
  );
  const completedAgain = await request(
    `/tasks/${task.data.id}/instances/${TASK_DATE}`,
    member.accessToken,
    'PATCH',
    { status: 'done' },
  );
  assert(
    restored.status === 200 &&
      restored.data.pointsAwarded === false &&
      completedAgain.status === 200 &&
      completedAgain.data.pointsAwarded === true &&
      (await balance(member.accessToken, member.member.id)) === 160,
    '恢复任务冲销积分，再次真实完成产生新版本流水',
  );

  console.log('4. 家庭隔离、手工撤销与数据库不可变保护');
  await db.query('INSERT INTO households (id, name, slug) VALUES ($1, $2, $3)', [
    other.householdId,
    '积分隔离测试家庭',
    `points-${other.householdId}`,
  ]);
  await db.query(
    `INSERT INTO members (id, "householdId", name, "avatarEmoji", role)
     VALUES ($1, $2, '其他家庭成员', 'O', 'owner')`,
    [other.memberId, other.householdId],
  );
  await db.query(
    `INSERT INTO rewards (id, "householdId", name, cost, "createdById")
     VALUES ($1, $2, '其他家庭奖励', 1, $3)`,
    [other.rewardId, other.householdId, other.memberId],
  );
  const crossRedeem = await request(
    `/rewards/${other.rewardId}/redemptions`,
    member.accessToken,
    'POST',
    { idempotencyKey: randomUUID() },
  );
  const crossUpdate = await request(
    `/rewards/${other.rewardId}`,
    owner.accessToken,
    'PATCH',
    { cost: 2 },
  );
  assert(
    crossRedeem.status === 404 && crossUpdate.status === 404,
    '跨家庭奖励读取和修改统一按不存在处理',
  );

  const reverseKey = randomUUID();
  const manualReverse = await request(
    `/points/ledger/${grant.data.id}/reverse`,
    owner.accessToken,
    'POST',
    { note: '撤销初始手工发放', idempotencyKey: reverseKey },
  );
  const duplicateReverse = await request(
    `/points/ledger/${grant.data.id}/reverse`,
    owner.accessToken,
    'POST',
    { note: '撤销初始手工发放', idempotencyKey: reverseKey },
  );
  assert(
    manualReverse.status === 201 &&
      duplicateReverse.data.id === manualReverse.data.id &&
      (await balance(member.accessToken, member.member.id)) === 40,
    '管理员可幂等撤销手工积分且原流水仍保留',
  );

  let updateBlocked = false;
  let deleteBlocked = false;
  try {
    await db.query('UPDATE points_ledger SET note = $1 WHERE id = $2', [
      '不应写入',
      grant.data.id,
    ]);
  } catch (error) {
    updateBlocked = error?.code === '55000';
  }
  try {
    await db.query('DELETE FROM points_ledger WHERE id = $1', [grant.data.id]);
  } catch (error) {
    deleteBlocked = error?.code === '55000';
  }
  const pointActivities = await request('/activities?scope=all&limit=100', owner.accessToken);
  assert(
    updateBlocked &&
      deleteBlocked &&
      pointActivities.data.some((item) => item.module === 'points'),
    '数据库拒绝更新或删除积分流水且积分操作进入家庭活动',
  );

  console.log('\n积分、奖励与兑换回归测试全部通过');
} finally {
  await db.query('DELETE FROM rewards WHERE id = $1', [other.rewardId]);
  await db.query('DELETE FROM members WHERE id = $1', [other.memberId]);
  await db.query('DELETE FROM households WHERE id = $1', [other.householdId]);
  await db.end();
}
