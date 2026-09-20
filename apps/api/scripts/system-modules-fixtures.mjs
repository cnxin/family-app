import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';

export async function createModuleHousehold(db, role = 'owner') {
  const householdId = randomUUID();
  const accountId = randomUUID();
  const memberId = randomUUID();
  const sessionId = randomUUID();
  await db.query('INSERT INTO households (id,name,slug) VALUES ($1,$2,$3)', [
    householdId,
    '模块测试家庭',
    householdId,
  ]);
  await db.query(
    'INSERT INTO accounts (id,"loginName","loginNameNormalized") VALUES ($1,$2,$3)',
    [accountId, accountId, accountId],
  );
  await db.query(
    'INSERT INTO members (id,"householdId","accountId",name,"avatarEmoji",role) VALUES ($1,$2,$3,$4,$5,$6)',
    [memberId, householdId, accountId, '模块测试成员', 'T', role],
  );
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  await db.query(
    `INSERT INTO auth_sessions (id,"householdId","accountId","memberId","refreshTokenHash","roleSnapshot","credentialSnapshot","expiresAt")
    VALUES ($1,$2,$3,$4,$5,$6,$7,now()+interval '10 minutes')`,
    [
      sessionId,
      householdId,
      accountId,
      memberId,
      hash(sessionId),
      role,
      hash('family-app-credential:no-pin'),
    ],
  );
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const content = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: accountId, accountId, householdId, memberId, sid: sessionId, name: '模块测试成员', role, iat: now, exp: now + 600 })}`;
  const signature = createHmac(
    'sha256',
    process.env.JWT_SECRET || 'family-app-dev-secret',
  )
    .update(content)
    .digest('base64url');
  return { householdId, memberId, accountId, token: `${content}.${signature}` };
}

export async function insertScoped(db, fixture, table, values) {
  // 表 / 列仅来自脚本的静态夹具，值全部参数化。
  const row = { householdId: fixture.householdId, ...values };
  const columns = Object.keys(row)
    .map((key) => `"${key}"`)
    .join(',');
  const parameters = Object.values(row);
  const result = await db.query(
    `INSERT INTO "${table}" (${columns}) VALUES (${parameters.map((_, index) => `$${index + 1}`).join(',')}) RETURNING id`,
    parameters,
  );
  return result.rows[0].id;
}

export async function disableAgent(db, fixture) {
  return insertScoped(db, fixture, 'agent_settings', {
    enabled: false,
    updatedByMemberId: fixture.memberId,
  });
}

export async function cleanModuleHousehold(db, fixture) {
  if (fixture.retainUntilDatabaseDrop) return;
  for (const table of [
    'household_module_overrides',
    'household_activity_logs',
    'agent_settings',
    'reminders',
    'polls',
    'dishes',
    'inventory_items',
    'home_assets',
    'finance_budgets',
    'finance_postings',
    'finance_transactions',
    'finance_accounts',
    'finance_categories',
    'points_ledger',
    'points_accounts',
    'rewards',
    'visits',
    'guests',
    'household_media',
    'integrations',
    'household_media_source_configs',
    'travel_plans',
    'knowledge_articles',
    'family_memories',
    'auth_sessions',
  ]) {
    const column =
      table === 'household_module_overrides' ? 'household_id' : 'householdId';
    await db.query(`DELETE FROM "${table}" WHERE "${column}" = $1`, [
      fixture.householdId,
    ]);
  }
  await db.query('DELETE FROM members WHERE "householdId"=$1', [
    fixture.householdId,
  ]);
  await db.query('DELETE FROM households WHERE id=$1', [fixture.householdId]);
  await db.query('DELETE FROM accounts WHERE id=$1', [fixture.accountId]);
}

// 流水表有不可变触发器；只在 runner 临时库建立独立家庭，清理由删库负责。
export async function createLedgerHousehold(db, key) {
  assert.match(process.env.DB_NAME ?? '', /^family_app_test_[a-f0-9]+$/);
  const fixture = await createModuleHousehold(db);
  fixture.retainUntilDatabaseDrop = true;
  const member = fixture.memberId;
  if (key === 'finance') {
    await insertScoped(db, fixture, 'finance_transactions', {
      type: 'transfer',
      amount: 1,
      title: '测试流水',
      occurredOn: '2026-09-01',
      actorId: member,
      actorName: '测试成员',
      sourceType: 'manual',
      sourceId: randomUUID(),
      idempotencyKey: randomUUID(),
      requestFingerprint: 'test',
    });
  } else {
    const account = await insertScoped(db, fixture, 'points_accounts', {
      memberId: member,
      balance: 1,
    });
    await insertScoped(db, fixture, 'points_ledger', {
      accountId: account,
      memberId: member,
      type: 'award',
      pointsBefore: 0,
      delta: 1,
      pointsAfter: 1,
      actorId: member,
      actorName: '测试成员',
      sourceType: 'manual',
      sourceId: randomUUID(),
      idempotencyKey: randomUUID(),
    });
  }
  return fixture;
}
