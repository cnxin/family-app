import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { SHELF_MODULE_KEYS } from '@family/contracts';
import {
  createModuleHousehold,
  createLedgerHousehold,
  cleanModuleHousehold,
  insertScoped,
  disableAgent,
} from './system-modules-fixtures.mjs';

const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const db = new pg.Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});
async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  return { status: response.status, ...json };
}
async function modules(fixture) {
  const result = await request('/system/modules', fixture.token);
  assert.equal(result.status, 200);
  assert.deepEqual(
    result.data.modules.map((row) => row.key),
    [...SHELF_MODULE_KEYS],
  );
  return Object.fromEntries(result.data.modules.map((row) => [row.key, row]));
}
const fixtures = [];
const globalTitles = [];
await db.connect();
try {
  const owner = await createModuleHousehold(db);
  fixtures.push(owner);
  const other = await createModuleHousehold(db, 'member');
  fixtures.push(other);
  const admin = await createModuleHousehold(db, 'admin');
  fixtures.push(admin);
  assert.equal((await request('/system/modules')).status, 401);
  const initial = await modules(owner);
  assert.equal(initial.activity.hasData, true);
  assert.equal(
    (
      await db.query(
        'SELECT count(*) FROM agent_settings WHERE "householdId"=$1',
        [owner.householdId],
      )
    ).rows[0].count,
    '0',
    '聚合读取不懒建助理配置',
  );
  const agentStatus = await request('/agent/status', owner.token);
  assert.equal(
    initial.assistant.hasData,
    agentStatus.data.enabled,
    '无设置时与真实 status.enabled 一致',
  );
  await db.query('DELETE FROM agent_settings WHERE "householdId"=$1', [
    owner.householdId,
  ]);
  await disableAgent(db, owner);
  await disableAgent(db, other);
  await disableAgent(db, admin);
  for (const fixture of [owner, other]) {
    const empty = await modules(fixture);
    for (const key of SHELF_MODULE_KEYS) {
      assert.equal(empty[key].hasData, key === 'activity', `空家庭 ${key}`);
      assert.equal(empty[key].override, null);
    }
  }
  console.log(
    '  ✓ 空家庭 / 普通成员 GET / activity 常量 / assistant 默认及只读行为',
  );

  const patch = (fixture, key, override) =>
    request(`/system/modules/${key}`, fixture.token, 'PATCH', { override });
  const asset = await request('/assets', owner.token, 'POST', {
    name: '模块端点资产',
    category: 'appliance',
  });
  assert.equal(asset.status, 201);
  assert.equal((await modules(owner)).assets.hasData, true);
  assert.equal((await modules(other)).assets.hasData, false);
  for (const override of ['on', 'off', null, null]) {
    const changed = await patch(owner, 'assets', override);
    assert.equal(changed.status, 200);
    assert.deepEqual(changed.data, { key: 'assets', hasData: true, override });
    assert.equal((await modules(other)).assets.override, null);
    const rows = (
      await db.query(
        'SELECT * FROM household_module_overrides WHERE household_id=$1 AND key=$2',
        [owner.householdId, 'assets'],
      )
    ).rows;
    assert.equal(rows.length, override === null ? 0 : 1);
    if (rows.length) {
      assert.equal(rows[0].updated_by, owner.memberId);
      assert.ok(rows[0].updated_at instanceof Date);
    }
  }
  assert.equal((await patch(admin, 'assets', 'on')).status, 200);
  assert.equal((await patch(other, 'assets', 'on')).status, 403);
  for (const key of ['today', 'settings', 'unknown', 'ASSETS'])
    assert.equal((await patch(owner, key, 'on')).status, 400);
  for (const body of [{}, { override: 'auto' }, { override: true }])
    assert.equal(
      (await request('/system/modules/assets', owner.token, 'PATCH', body))
        .status,
      400,
    );
  for (const override of ['auto', null])
    await assert.rejects(
      db.query(
        'INSERT INTO household_module_overrides (household_id,key,override,updated_by) VALUES ($1,$2,$3,$4)',
        [owner.householdId, 'assets', override, owner.memberId],
      ),
    );
  await db.query('DELETE FROM home_assets WHERE id=$1', [asset.data.id]);
  console.log(
    '  ✓ 资产从无到有、on/off/null 删行、审计字段、管理员权限、未知 key 400、数据库约束',
  );

  const forced = await patch(owner, 'assets', 'on');
  assert.deepEqual(forced.data, {
    key: 'assets',
    hasData: false,
    override: 'on',
  });
  await patch(owner, 'assets', null);
  const member = owner.memberId;
  const category = await insertScoped(db, owner, 'finance_categories', {
    name: '测试分类',
    kind: 'expense',
    createdById: member,
  });
  assert.equal(
    (await modules(owner)).finance.hasData,
    false,
    '只有分类不点亮财务',
  );
  await insertScoped(db, owner, 'points_accounts', {
    memberId: member,
    balance: 0,
  });
  assert.equal(
    (await modules(owner)).points.hasData,
    false,
    '懒建零账户不点亮积分',
  );
  const title = randomUUID();
  globalTitles.push(title);
  await db.query(
    'INSERT INTO media_titles (id,type,title,"dedupeKey") VALUES ($1,$2,$3,$4)',
    [title, 'movie', '模块测试影片', title],
  );
  // 逐表证明自己有数据 / 另一空家庭无数据；历史记录也计入，所有 UNION 分支均纳入。
  const cases = [
    ['recipes', 'dishes', { name: '测试菜', isActive: false }],
    [
      'polls',
      'polls',
      { title: '测试票', createdById: member, isArchived: true },
    ],
    [
      'inventory',
      'inventory_items',
      { name: '测试库存', category: '日用品', quantity: 0, unit: '个' },
    ],
    [
      'assets',
      'home_assets',
      {
        name: '停用资产',
        category: 'appliance',
        status: 'retired',
        createdById: member,
      },
    ],
    [
      'finance',
      'finance_accounts',
      { name: '测试账户', type: 'cash', createdById: member },
    ],
    [
      'finance',
      'finance_budgets',
      {
        categoryId: category,
        month: '2026-09',
        amount: 100,
        updatedById: member,
      },
    ],
    ['media', 'household_media', { mediaTitleId: title, createdById: member }],
    ['points', 'rewards', { name: '测试奖励', cost: 1, createdById: member }],
    ['guests', 'guests', { name: '测试访客', isActive: false }],
    [
      'guests',
      'visits',
      {
        title: '历史来访',
        startsAt: '2020-01-01',
        hostMemberId: member,
        createdById: member,
        status: 'completed',
      },
    ],
    [
      'media',
      'integrations',
      {
        kind: 'plex',
        name: '家庭媒体',
        baseUrl: 'http://127.0.0.1:1',
        isEnabled: false,
      },
    ],
    [
      'media',
      'household_media_source_configs',
      { provider: 'bangumi', baseUrl: 'http://127.0.0.1:1' },
    ],
    [
      'media',
      'household_media_source_configs',
      { provider: 'tmdb', credentialHint: '****1234' },
    ],
    [
      'travel',
      'travel_plans',
      {
        title: '历史出行',
        startDate: '2020-01-01',
        endDate: '2020-01-02',
        createdById: member,
        updatedById: member,
        archivedAt: new Date(),
      },
    ],
    [
      'knowledge',
      'knowledge_articles',
      {
        title: '历史知识',
        category: 'other',
        content: '测试',
        createdById: member,
        updatedById: member,
        archivedAt: new Date(),
      },
    ],
    [
      'memories',
      'family_memories',
      {
        title: '历史回忆',
        category: 'daily',
        happenedOn: '2020-01-01',
        createdById: member,
        updatedById: member,
        archivedAt: new Date(),
      },
    ],
  ];
  for (const [key, table, values] of cases) {
    const id = await insertScoped(db, owner, table, values);
    assert.equal(
      (await modules(owner))[key].hasData,
      true,
      `${table} 当前家庭有数据`,
    );
    assert.equal(
      (await modules(other))[key].hasData,
      false,
      `${table} 不泄漏另一家庭`,
    );
    await db.query(`DELETE FROM "${table}" WHERE id=$1`, [id]);
    assert.equal(
      (await modules(owner))[key].hasData,
      false,
      `${table} 清除后无数据`,
    );
  }
  // 不可变流水不能 DELETE；专用家庭保留到 runner 删除隔离库，不关闭触发器。
  for (const key of ['finance', 'points']) {
    const fixture = await createLedgerHousehold(db, key);
    fixtures.push(fixture);
    assert.equal(
      (await modules(fixture))[key].hasData,
      true,
      `${key} 只有流水也有数据`,
    );
    assert.equal(
      (await modules(other))[key].hasData,
      false,
      `${key} 流水不泄漏另一家庭`,
    );
  }
  for (const [status, remindAt, expected] of [
    ['scheduled', '2020-01-01', true],
    ['sent', '2199-01-01', true],
    ['sent', '2020-01-01', false],
    ['cancelled', '2199-01-01', false],
  ]) {
    const id = await insertScoped(db, owner, 'reminders', {
      sourceModule: 'calendar',
      sourceId: randomUUID(),
      status,
      remindAt,
      createdById: member,
    });
    assert.equal((await modules(owner)).reminders.hasData, expected);
    assert.equal((await modules(other)).reminders.hasData, false);
    await db.query('DELETE FROM reminders WHERE id=$1', [id]);
  }
  await db.query(
    'UPDATE agent_settings SET enabled=true WHERE "householdId"=$1',
    [owner.householdId],
  );
  assert.equal((await modules(owner)).assistant.hasData, true);
  assert.equal((await modules(other)).assistant.hasData, false);
  console.log('  ✓ 各域主表存在性、历史数据、提醒边界、助理开关与跨家庭隔离');
} finally {
  for (const fixture of fixtures.reverse())
    await cleanModuleHousehold(db, fixture);
  for (const id of globalTitles)
    await db.query('DELETE FROM media_titles WHERE id=$1', [id]);
  await db.end();
}
