import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createModuleHousehold, insertScoped } from './system-modules-fixtures.mjs';

const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const TODAY = '2026-09-21';
const NOW = '2026-09-21T04:00:00.000Z';
const db = new pg.Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});

async function request(path, fixture, clock = NOW) {
  const response = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${fixture.token}`,
      'x-test-clock': clock,
    },
  });
  const json = await response.json();
  return { status: response.status, data: json?.data, error: json?.error };
}

async function attention(fixture, clock = NOW) {
  const result = await request('/today/attention', fixture, clock);
  assert.equal(result.status, 200, result.error?.message ?? '留意端点应成功');
  return result.data;
}

function find(result, domain) {
  return result.items.find((item) => item.domain === domain);
}

function assertAbsent(result, domain, message) {
  assert.equal(find(result, domain), undefined, message);
}

function assertItem(result, domain, expected, message) {
  const item = find(result, domain);
  assert.ok(item, message);
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(item[key], value, `${message}: ${key}`);
  return item;
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function fixture(role = 'owner', timezone = 'Asia/Shanghai') {
  const created = await createModuleHousehold(db, role);
  created.retainUntilDatabaseDrop = true;
  await db.query('UPDATE households SET timezone=$1 WHERE id=$2', [timezone, created.householdId]);
  return created;
}

async function createAsset(target, values = {}) {
  return insertScoped(db, target, 'home_assets', {
    name: values.name ?? '留意测试资产',
    category: values.category ?? 'appliance',
    createdById: target.memberId,
    ...values,
  });
}

async function dateRule({ domain, kind, threshold, create, setDue, complete }) {
  const target = await fixture();
  const id = await create(target, addDays(TODAY, threshold + 1));
  assertAbsent(await attention(target), domain, `${domain}/${kind} 到期前一天不出现`);
  await setDue(target, id, addDays(TODAY, threshold));
  assertItem(await attention(target), domain, { kind, dueOn: addDays(TODAY, threshold), overdue: false }, `${domain}/${kind} 阈值当天出现`);
  await setDue(target, id, addDays(TODAY, -1));
  assertItem(await attention(target), domain, { kind, dueOn: addDays(TODAY, -1), overdue: true }, `${domain}/${kind} 逾期出现`);
  await complete(target, id);
  assertAbsent(await attention(target), domain, `${domain}/${kind} 办完后消失`);
}

await db.connect();
try {
  const boundary = await fixture('owner', 'Pacific/Kiritimati');
  assert.equal((await attention(boundary, '2026-09-20T09:59:00.000Z')).today, '2026-09-20');
  assert.equal((await attention(boundary, '2026-09-20T10:01:00.000Z')).today, '2026-09-21');
  console.log('  ✓ 家庭零点前后一分钟使用家庭日期');

  await dateRule({
    domain: 'assets', kind: 'maintenance', threshold: 7,
    create: async (target, due) => {
      const assetId = await createAsset(target, { name: '净水器滤芯' });
      return insertScoped(db, target, 'maintenance_plans', {
        assetId, title: '更换滤芯', frequencyDays: 30, nextDueDate: due, createdById: target.memberId,
      });
    },
    setDue: (_, id, due) => db.query('UPDATE maintenance_plans SET "nextDueDate"=$1 WHERE id=$2', [due, id]),
    complete: (_, id) => db.query('UPDATE maintenance_plans SET "isEnabled"=false WHERE id=$1', [id]),
  });
  await dateRule({
    domain: 'assets', kind: 'renewal', threshold: 3,
    create: (target, due) => createAsset(target, { name: '影音订阅', category: 'subscription', renewsOn: due, renewalIntervalMonths: 1 }),
    setDue: (_, id, due) => db.query('UPDATE home_assets SET "renewsOn"=$1 WHERE id=$2', [due, id]),
    complete: (_, id) => db.query('UPDATE home_assets SET "renewsOn"=NULL WHERE id=$1', [id]),
  });
  await dateRule({
    domain: 'assets', kind: 'warranty', threshold: 30,
    create: (target, due) => createAsset(target, { name: '电视', purchaseDate: '2025-01-01', warrantyExpiresOn: due }),
    setDue: (_, id, due) => db.query('UPDATE home_assets SET "warrantyExpiresOn"=$1 WHERE id=$2', [due, id]),
    complete: (_, id) => db.query('UPDATE home_assets SET "warrantyExpiresOn"=NULL WHERE id=$1', [id]),
  });

  await dateRule({
    domain: 'guests', kind: 'menu', threshold: 7,
    create: (target, due) => insertScoped(db, target, 'visits', {
      title: '朋友来访', startsAt: `${due}T02:00:00.000Z`, hostMemberId: target.memberId, createdById: target.memberId,
    }),
    setDue: (_, id, due) => db.query('UPDATE visits SET "startsAt"=$1 WHERE id=$2', [`${due}T02:00:00.000Z`, id]),
    complete: async (target, id) => {
      const [{ due }] = (await db.query(`SELECT ("startsAt" AT TIME ZONE 'Asia/Shanghai')::date::text AS due FROM visits WHERE id=$1`, [id])).rows;
      await insertScoped(db, target, 'menus', { date: due, mealType: 'dinner' });
    },
  });

  const guestRequestFixture = await fixture();
  const visitId = await insertScoped(db, guestRequestFixture, 'visits', {
    title: '点菜请求来访', startsAt: '2026-10-20T02:00:00.000Z', hostMemberId: guestRequestFixture.memberId, createdById: guestRequestFixture.memberId,
  });
  const guestId = await insertScoped(db, guestRequestFixture, 'guests', { name: '访客' });
  const invitationId = await db.query(
    `INSERT INTO guest_invitations ("visitId","guestId","tokenHash","expiresAt","allowsMealRequests","createdById")
     VALUES ($1,$2,$3,$4,true,$5) RETURNING id`,
    [visitId, guestId, randomUUID().replaceAll('-', ''), '2026-10-21T00:00:00.000Z', guestRequestFixture.memberId],
  ).then((result) => result.rows[0].id);
  const requestId = await insertScoped(db, guestRequestFixture, 'guest_meal_requests', {
    visitId, invitationId, mealDate: '2026-10-20', mealType: 'dinner', dishName: '红烧肉',
  });
  assertItem(await attention(guestRequestFixture), 'guests', { kind: 'meal-request', overdue: false }, '待处理访客点菜请求出现');
  await db.query(`UPDATE guest_meal_requests SET status='accepted' WHERE id=$1`, [requestId]);
  assertAbsent(await attention(guestRequestFixture), 'guests', '访客点菜请求处理后消失');

  await dateRule({
    domain: 'travel', kind: 'checklist', threshold: 7,
    create: async (target, due) => {
      const planId = await insertScoped(db, target, 'travel_plans', {
        title: '周末出行', startDate: due, endDate: addDays(due, 2), createdById: target.memberId, updatedById: target.memberId,
      });
      await insertScoped(db, target, 'travel_checklist_items', {
        planId, title: '带证件', category: 'documents', createdById: target.memberId, updatedById: target.memberId,
      });
      return planId;
    },
    setDue: (_, id, due) => db.query('UPDATE travel_plans SET "startDate"=$1,"endDate"=$2 WHERE id=$3', [due, addDays(due, 2), id]),
    complete: (target, id) => db.query(`UPDATE travel_checklist_items SET status='skipped' WHERE "householdId"=$1 AND "planId"=$2`, [target.householdId, id]),
  });

  await dateRule({
    domain: 'inventory', kind: 'expiry', threshold: 3,
    create: async (target, due) => {
      const inventoryItemId = await insertScoped(db, target, 'inventory_items', { name: '鲜奶', category: '其他' });
      return insertScoped(db, target, 'inventory_batches', {
        inventoryItemId, quantity: 1, receivedOn: TODAY, expiresOn: due,
        sourceType: 'manual', sourceId: randomUUID(), createdById: target.memberId,
      });
    },
    setDue: (_, id, due) => db.query('UPDATE inventory_batches SET "expiresOn"=$1 WHERE id=$2', [due, id]),
    complete: (_, id) => db.query('UPDATE inventory_batches SET quantity=0 WHERE id=$1', [id]),
  });

  const pollFixture = await fixture();
  const pollId = await insertScoped(db, pollFixture, 'polls', { title: '周末吃什么', createdById: pollFixture.memberId });
  const optionId = await db.query('INSERT INTO poll_options ("pollId",label,"sortOrder") VALUES ($1,$2,0) RETURNING id', [pollId, '火锅']).then((result) => result.rows[0].id);
  assertItem(await attention(pollFixture), 'polls', { kind: 'vote' }, '未投票时出现');
  await insertScoped(db, pollFixture, 'poll_votes', { pollId, optionId, memberId: pollFixture.memberId });
  assertAbsent(await attention(pollFixture), 'polls', '投票后消失');

  const pointsFixture = await fixture();
  const pointsAccountId = await insertScoped(db, pointsFixture, 'points_accounts', { memberId: pointsFixture.memberId, balance: 0 });
  const rewardId = await insertScoped(db, pointsFixture, 'rewards', { name: '奖励', cost: 1, createdById: pointsFixture.memberId });
  const debitLedgerId = await insertScoped(db, pointsFixture, 'points_ledger', {
    accountId: pointsAccountId, memberId: pointsFixture.memberId, type: 'adjustment', pointsBefore: 1, delta: -1, pointsAfter: 0,
    actorId: pointsFixture.memberId, actorName: '测试成员', sourceType: 'manual', sourceId: randomUUID(), idempotencyKey: randomUUID(),
  });
  const redemptionId = await insertScoped(db, pointsFixture, 'reward_redemptions', {
    rewardId, memberId: pointsFixture.memberId, rewardName: '奖励', cost: 1,
    requestIdempotencyKey: randomUUID(), debitLedgerId,
  });
  assertItem(await attention(pointsFixture), 'points', { kind: 'redemption' }, '待审批兑换出现');
  await db.query(`UPDATE reward_redemptions SET status='approved' WHERE id=$1`, [redemptionId]);
  assertAbsent(await attention(pointsFixture), 'points', '兑换审批后消失');

  const financeFixture = await fixture();
  const categoryId = await insertScoped(db, financeFixture, 'finance_categories', {
    name: '餐饮', kind: 'expense', createdById: financeFixture.memberId,
  });
  const budgetId = await insertScoped(db, financeFixture, 'finance_budgets', {
    categoryId, month: '2026-09', amount: 100, updatedById: financeFixture.memberId,
  });
  await insertScoped(db, financeFixture, 'finance_transactions', {
    type: 'expense', amount: 99, title: '未超预算', occurredOn: TODAY, categoryId,
    actorId: financeFixture.memberId, actorName: '测试成员', sourceType: 'manual', sourceId: randomUUID(),
    idempotencyKey: randomUUID(), requestFingerprint: 'today-attention',
  });
  assertAbsent(await attention(financeFixture), 'finance', '预算未超时不出现');
  await insertScoped(db, financeFixture, 'finance_transactions', {
    type: 'expense', amount: 2, title: '超预算', occurredOn: TODAY, categoryId,
    actorId: financeFixture.memberId, actorName: '测试成员', sourceType: 'manual', sourceId: randomUUID(),
    idempotencyKey: randomUUID(), requestFingerprint: 'today-attention',
  });
  assertItem(await attention(financeFixture), 'finance', { kind: 'budget' }, '本月预算超支出现');
  await db.query('UPDATE finance_budgets SET amount=200 WHERE id=$1', [budgetId]);
  assertAbsent(await attention(financeFixture), 'finance', '提高预算后消失');

  const backupFixture = await fixture();
  const policyId = await insertScoped(db, backupFixture, 'backup_policies', { workerLastSeenAt: NOW });
  assertAbsent(await attention(backupFixture), 'backups', 'worker 在线且无失败时不出现');
  await db.query('UPDATE backup_policies SET "workerLastSeenAt"=NULL WHERE id=$1', [policyId]);
  assertItem(await attention(backupFixture), 'backups', { kind: 'backup' }, 'worker 离线时出现');
  await db.query('UPDATE backup_policies SET "workerLastSeenAt"=$1 WHERE id=$2', [NOW, policyId]);
  await insertScoped(db, backupFixture, 'backup_runs', {
    kind: 'backup', status: 'failed', trigger: 'manual', idempotencyKey: randomUUID(), createdAt: NOW,
  });
  assertItem(await attention(backupFixture), 'backups', { kind: 'backup' }, '最近一次备份失败时出现');
  await insertScoped(db, backupFixture, 'backup_runs', {
    kind: 'backup', status: 'succeeded', trigger: 'manual', idempotencyKey: randomUUID(),
    createdAt: '2026-09-21T04:01:00.000Z',
  });
  assertAbsent(await attention(backupFixture), 'backups', '最近一次备份恢复成功且 worker 在线后消失');

  const hiddenFixture = await fixture();
  const hiddenAssetId = await createAsset(hiddenFixture, { name: '被收起资产' });
  await insertScoped(db, hiddenFixture, 'maintenance_plans', {
    assetId: hiddenAssetId, title: '维护', frequencyDays: 30, nextDueDate: addDays(TODAY, 3), createdById: hiddenFixture.memberId,
  });
  assert.ok(find(await attention(hiddenFixture), 'assets'));
  await db.query(`INSERT INTO household_module_overrides (household_id,key,override,updated_by) VALUES ($1,'assets','off',$2)`, [hiddenFixture.householdId, hiddenFixture.memberId]);
  assertAbsent(await attention(hiddenFixture), 'assets', 'override off 抑制该域条目');

  const memberFixture = await fixture('member');
  const memberAssetId = await createAsset(memberFixture, { name: '普通成员资产' });
  await insertScoped(db, memberFixture, 'maintenance_plans', {
    assetId: memberAssetId, title: '维护', frequencyDays: 30, nextDueDate: TODAY, createdById: memberFixture.memberId,
  });
  await insertScoped(db, memberFixture, 'backup_policies', {});
  const memberVisitId = await insertScoped(db, memberFixture, 'visits', {
    title: '普通成员测试来访', startsAt: '2026-10-20T02:00:00.000Z',
    hostMemberId: memberFixture.memberId, createdById: memberFixture.memberId,
  });
  const memberGuestId = await insertScoped(db, memberFixture, 'guests', { name: '普通成员测试访客' });
  const memberInvitationId = await db.query(
    `INSERT INTO guest_invitations ("visitId","guestId","tokenHash","expiresAt","allowsMealRequests","createdById")
     VALUES ($1,$2,$3,$4,true,$5) RETURNING id`,
    [memberVisitId, memberGuestId, randomUUID().replaceAll('-', ''), '2026-10-21T00:00:00.000Z', memberFixture.memberId],
  ).then((result) => result.rows[0].id);
  await insertScoped(db, memberFixture, 'guest_meal_requests', {
    visitId: memberVisitId, invitationId: memberInvitationId, mealDate: '2026-10-20',
    mealType: 'dinner', dishName: '普通成员不可见的待处理点菜请求', status: 'pending',
  });
  const memberResult = await attention(memberFixture);
  assert.ok(find(memberResult, 'assets'), '普通成员仍能看到全家类条目');
  for (const domain of ['points', 'finance', 'backups']) assertAbsent(memberResult, domain, `普通成员看不到 ${domain} 管理类目`);
  assert.equal(memberResult.items.some((item) => item.kind === 'meal-request'), false, '普通成员看不到访客点菜请求');

  const sixtyFixture = await fixture();
  for (let index = 0; index < 60; index += 1) {
    const assetId = await createAsset(sixtyFixture, { name: `批量资产 ${index + 1}` });
    await insertScoped(db, sixtyFixture, 'maintenance_plans', {
      assetId, title: '批量维护', frequencyDays: 30, nextDueDate: addDays(TODAY, 7), createdById: sixtyFixture.memberId,
    });
  }
  const sixty = assertItem(await attention(sixtyFixture), 'assets', { count: 60 }, '60 件资产全部计数，不受列表上限影响');
  assert.equal(sixty.entity, undefined, '合并条目不返回单一实体');
  assert.equal(sixty.key, 'assets:attention', '域 key 在数量变化时保持稳定');

  console.log('\n今天页留意端点测试全部通过');
} finally {
  await db.end();
}
