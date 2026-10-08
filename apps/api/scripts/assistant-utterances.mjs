// J2 助理原话黑盒：写入与幂等、成员只能删 / 看自己的、管理员列表（游标分页）与 CSV 导出、家庭隔离、不推事件、用量统计原话段。
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { usageReport } from './usage-report-probe.mjs';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const DATABASE = process.env.DB_NAME || 'family_app';

if (!DATABASE.startsWith('family_app_test_')) {
  throw new Error('assistant-utterances.mjs 只允许在 API 临时测试库中运行');
}

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
  const type = response.headers.get('content-type') ?? '';
  const json = type.includes('application/json') && text ? JSON.parse(text) : null;
  return { status: response.status, data: json?.data, error: json?.error, text, headers: response.headers };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', { loginName, password: PASSWORD });
  assert(response.status === 201, `${loginName}可以登录`);
  return response.data;
}

const db = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: DATABASE,
});
await db.connect();

const other = { householdId: randomUUID(), memberId: randomUUID(), utteranceId: randomUUID() };
const staleId = randomUUID();

try {
  const owner = await login('爸爸');
  const member = await login('妈妈');

  console.log('1. 写入、去首尾空白、幂等');
  const clientId = randomUUID();
  const body = { clientId, text: '  记一笔  ', source: 'command_palette', outcome: 'navigated', chosenKind: 'action', chosenId: 'finance.record-expense' };
  const first = await request('/assistant/utterances', member.accessToken, 'POST', body);
  const again = await request('/assistant/utterances', member.accessToken, 'POST', { ...body, text: '另一句', outcome: 'no_match', chosenKind: null });
  const rows = await db.query('SELECT count(*)::int AS n FROM assistant_utterances WHERE "clientId" = $1', [clientId]);
  assert(
    first.status === 201 && first.data.text === '记一笔' && first.data.memberId === member.member.id &&
      first.data.memberName === '妈妈' && first.data.tier === null && first.data.outcome === 'navigated' &&
      again.status === 201 && again.data.id === first.data.id && again.data.text === '记一笔' && rows.rows[0].n === 1,
    '原话去首尾空白落一条；同一个 clientId 再交返回第一次那条，不新增',
  );
  const empty = await request('/assistant/utterances', member.accessToken, 'POST', { ...body, clientId: randomUUID(), text: '   ' });
  const tooLong = await request('/assistant/utterances', member.accessToken, 'POST', { ...body, clientId: randomUUID(), text: '字'.repeat(201) });
  const noChosen = await request('/assistant/utterances', member.accessToken, 'POST', { clientId: randomUUID(), text: '去哪', source: 'command_palette', outcome: 'navigated' });
  const badSource = await request('/assistant/utterances', member.accessToken, 'POST', { ...body, clientId: randomUUID(), source: 'sms' });
  assert(
    empty.status === 400 && tooLong.status === 400 && noChosen.status === 400 && badSource.status === 400,
    '空白原话、超过 200 字、点了某条却没说点了什么、未知入口都 400',
  );

  console.log('2. 不推事件、不进动态流水');
  const activityBefore = await db.query('SELECT count(*)::int AS n FROM household_activity_logs WHERE "householdId" = $1', [owner.member.householdId]);
  for (const [text, outcome] of [['买牛奶', 'candidates'], ['今天谁做饭', 'no_match'], ['财', 'dismissed']]) {
    const saved = await request('/assistant/utterances', owner.accessToken, 'POST', { clientId: randomUUID(), text, source: 'command_palette', outcome });
    assert(saved.status === 201, `管理员记一条「${text}」（${outcome}）`);
  }
  const activityAfter = await db.query('SELECT count(*)::int AS n FROM household_activity_logs WHERE "householdId" = $1', [owner.member.householdId]);
  assert(activityAfter.rows[0].n === activityBefore.rows[0].n, '原话不写家庭动态');

  console.log('3. 列表：管理员看全家、成员只看自己，游标分页');
  const ownerList = await request('/assistant/utterances?limit=2', owner.accessToken);
  const ownerPage2 = await request(`/assistant/utterances?limit=2&cursor=${encodeURIComponent(ownerList.data.nextCursor)}`, owner.accessToken);
  const ownerAll = await request('/assistant/utterances?limit=200', owner.accessToken);
  const seen = [...ownerList.data.items, ...ownerPage2.data.items].map((one) => one.id);
  assert(
    ownerList.status === 200 && ownerList.data.items.length === 2 && ownerList.data.nextCursor &&
      ownerPage2.data.items.length === 2 && new Set(seen).size === 4 &&
      seen.every((id, index) => id === ownerAll.data.items[index].id) &&
      ownerAll.data.items.some((one) => one.memberId === member.member.id),
    '管理员按时间倒序翻页，两页不重不漏、与一次取全部的前四条一致，看得到成员的原话',
  );
  const memberList = await request('/assistant/utterances', member.accessToken);
  const memberPeek = await request(`/assistant/utterances?memberId=${owner.member.id}`, member.accessToken);
  const filtered = await request('/assistant/utterances?outcome=no_match', owner.accessToken);
  assert(
    memberList.status === 200 && memberList.data.items.length >= 1 &&
      memberList.data.items.every((one) => one.memberId === member.member.id) &&
      memberPeek.status === 403 &&
      filtered.data.items.length >= 1 && filtered.data.items.every((one) => one.outcome === 'no_match'),
    '成员不传 memberId 只看到自己的，指定别人 403；按结果筛选生效',
  );

  console.log('4. CSV 导出（管理员）');
  const csv = await request('/assistant/utterances/export.csv', owner.accessToken);
  const memberCsv = await request('/assistant/utterances/export.csv', member.accessToken);
  // fetch 的 text() 解码时会吞掉 BOM，开头三个字节另取原始的看
  const raw = new Uint8Array(await (await fetch(`${BASE}/assistant/utterances/export.csv`, {
    headers: { Authorization: `Bearer ${owner.accessToken}` },
  })).arrayBuffer());
  const csvLines = csv.text.replace(/^\uFEFF/, '').trim().split(/\r\n/);
  assert(
    csv.status === 200 && csv.headers.get('content-type')?.startsWith('text/csv') &&
      raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf &&
      csvLines[0].startsWith('createdAt,memberName,text,source,outcome') &&
      csvLines.length === ownerAll.data.items.length + 1 && csv.text.includes('今天谁做饭') &&
      memberCsv.status === 403,
    '导出带 UTF-8 BOM、表头与全部行；成员不能导出',
  );
  const formula = await request('/assistant/utterances', owner.accessToken, 'POST', { clientId: randomUUID(), text: '=1+1,"引号"', source: 'command_palette', outcome: 'no_match' });
  const csvAgain = await request('/assistant/utterances/export.csv?outcome=no_match', owner.accessToken);
  assert(
    formula.status === 201 && csvAgain.text.includes(`"'=1+1,""引号"""`),
    '以 = 开头的原话导出时垫单引号防公式，逗号与引号按 CSV 规则转义',
  );

  console.log('5. 删除：本人或管理员；清空自己的');
  const mine = await request('/assistant/utterances', member.accessToken, 'POST', { clientId: randomUUID(), text: '成员自己的', source: 'command_palette', outcome: 'no_match' });
  const ownersOne = ownerAll.data.items.find((one) => one.memberId === owner.member.id);
  const memberDeletesOwner = await request(`/assistant/utterances/${ownersOne.id}`, member.accessToken, 'DELETE');
  const memberDeletesOwn = await request(`/assistant/utterances/${mine.data.id}`, member.accessToken, 'DELETE');
  const ownerDeletesMember = await request(`/assistant/utterances/${first.data.id}`, owner.accessToken, 'DELETE');
  assert(
    memberDeletesOwner.status === 403 && memberDeletesOwn.status === 200 && memberDeletesOwn.data.deleted === 1 &&
      ownerDeletesMember.status === 200,
    '成员删不了别人的，能删自己的；管理员能删成员的',
  );
  await request('/assistant/utterances', member.accessToken, 'POST', { clientId: randomUUID(), text: '再说一句', source: 'command_palette', outcome: 'no_match' });
  const cleared = await request('/assistant/utterances?memberId=me', member.accessToken, 'DELETE');
  const memberLeft = await db.query('SELECT count(*)::int AS n FROM assistant_utterances WHERE "memberId" = $1', [member.member.id]);
  const ownerLeft = await db.query('SELECT count(*)::int AS n FROM assistant_utterances WHERE "memberId" = $1', [owner.member.id]);
  const badClear = await request('/assistant/utterances', member.accessToken, 'DELETE');
  assert(
    cleared.status === 200 && cleared.data.deleted >= 1 && memberLeft.rows[0].n === 0 && ownerLeft.rows[0].n >= 3 &&
      badClear.status === 400,
    '清空只清自己的，不带 memberId=me 不清',
  );

  console.log('6. 家庭隔离');
  await db.query('INSERT INTO households (id, name, slug) VALUES ($1, $2, $3)', [other.householdId, '原话隔离家庭', `utterance-${other.householdId}`]);
  await db.query(
    `INSERT INTO members (id, "householdId", name, "avatarEmoji", role) VALUES ($1, $2, '隔离成员', 'U', 'owner')`,
    [other.memberId, other.householdId],
  );
  await db.query(
    `INSERT INTO assistant_utterances (id, "householdId", "memberId", "clientId", text, source, outcome)
     VALUES ($1, $2, $3, $4, '别人家的原话', 'command_palette', 'no_match')`,
    [other.utteranceId, other.householdId, other.memberId, randomUUID()],
  );
  const crossList = await request('/assistant/utterances?limit=200', owner.accessToken);
  const crossDelete = await request(`/assistant/utterances/${other.utteranceId}`, owner.accessToken, 'DELETE');
  const crossCsv = await request('/assistant/utterances/export.csv', owner.accessToken);
  const stillThere = await db.query('SELECT count(*)::int AS n FROM assistant_utterances WHERE id = $1', [other.utteranceId]);
  assert(
    !crossList.data.items.some((one) => one.id === other.utteranceId) && crossDelete.status === 404 &&
      !crossCsv.text.includes('别人家的原话') && stillThere.rows[0].n === 1,
    '别人家的原话列不出、导不出、删不掉',
  );

  console.log('7. 三档开关与配置（agent_settings 新列）');
  const defaults = await request('/agent/settings', owner.accessToken);
  assert(
    defaults.status === 200 && defaults.data.tier0Enabled === true && defaults.data.tier1Enabled === false &&
      defaults.data.tier1BaseUrl === null && defaults.data.tier1Model === null && defaults.data.tier2DailyLimit === 50 &&
      defaults.data.tier2Redact === true && defaults.data.captureUtterances === true,
    '默认：第 0 档开、第 1 档关、无地址、每日上限 50、脱敏开、记录原话开',
  );
  const patched = await request('/agent/settings', owner.accessToken, 'PATCH', {
    tier1Enabled: true, tier1BaseUrl: 'http://192.168.1.10:11434', tier1Model: ' qwen2.5:7b ',
    tier2DailyLimit: 120, tier2Redact: false, captureUtterances: false, expectedVersion: defaults.data.version,
  });
  const status = await request('/agent/status', member.accessToken);
  const memberSettings = await request('/agent/settings', member.accessToken);
  assert(
    patched.status === 200 && patched.data.tier1Enabled === true && patched.data.tier1BaseUrl === 'http://192.168.1.10:11434' &&
      patched.data.tier1Model === 'qwen2.5:7b' && patched.data.tier2DailyLimit === 120 && patched.data.tier2Redact === false &&
      patched.data.captureUtterances === false && patched.data.enabled === defaults.data.enabled &&
      status.status === 200 && status.data.captureUtterances === false &&
      memberSettings.status === 200 && memberSettings.data.tier1Model === 'qwen2.5:7b',
    '管理员能改三档与「记录原话」（局域网地址可用，模型名去空白，enabled 不受影响）；成员读得到，status 带上记录开关',
  );
  const badUrl = await request('/agent/settings', owner.accessToken, 'PATCH', { tier1BaseUrl: 'ftp://nas/models', expectedVersion: patched.data.version });
  const badLimit = await request('/agent/settings', owner.accessToken, 'PATCH', { tier2DailyLimit: 0, expectedVersion: patched.data.version });
  const tooHigh = await request('/agent/settings', owner.accessToken, 'PATCH', { tier2DailyLimit: 1001, expectedVersion: patched.data.version });
  const memberPatch = await request('/agent/settings', member.accessToken, 'PATCH', { captureUtterances: true, expectedVersion: patched.data.version });
  assert(
    badUrl.status === 400 && badLimit.status === 400 && tooHigh.status === 400 && memberPatch.status === 403,
    '非 http(s) 地址、每日上限超出 1～1000 都 400；成员不能改',
  );
  const restored = await request('/agent/settings', owner.accessToken, 'PATCH', {
    tier1Enabled: false, tier1BaseUrl: null, tier1Model: null, tier2DailyLimit: 50, tier2Redact: true, captureUtterances: true,
    expectedVersion: patched.data.version,
  });
  assert(restored.status === 200 && restored.data.tier1BaseUrl === null && restored.data.captureUtterances === true, '传 null 清空地址，设置恢复默认');

  console.log('8. 用量统计里的原话段（usage-report.mjs）');
  const searched = await request('/assistant/utterances', member.accessToken, 'POST', {
    clientId: randomUUID(), text: '冰箱里还有什么', source: 'today_search', outcome: 'navigated', chosenKind: 'page', chosenId: '/inventory',
  });
  const missed = await request('/assistant/utterances', member.accessToken, 'POST', {
    clientId: randomUUID(), text: '周末去哪玩', source: 'today_search', outcome: 'no_match',
  });
  // 三天前的一条：只进「全部时间」，不进最近 1 天
  await db.query(
    `INSERT INTO assistant_utterances (id, "householdId", "memberId", "clientId", text, source, outcome, "createdAt")
     VALUES ($1, $2, $3, $4, '三天前的原话', 'today_search', 'no_match', now() - interval '3 days')`,
    [staleId, owner.member.householdId, member.member.id, randomUUID()],
  );
  const report = await usageReport(1);
  const [{ name: householdName }] = (await db.query('SELECT name FROM households WHERE id = $1', [owner.member.householdId])).rows;
  const sectionOf = (name) => report.split('\n## ').find((part) => part.startsWith(`${name}（`)) ?? '';
  const section = sectionOf(householdName);
  const otherSection = sectionOf('原话隔离家庭');
  const cells = (text, prefix) => {
    const line = text.split('\n').find((row) => row.startsWith(prefix));
    return line ? line.split('|').slice(4, 6).map((cell) => Number(cell.trim())).join(',') : null;
  };
  const [expected] = (
    await db.query(
      `SELECT count(*) FILTER (WHERE "createdAt" >= now() - interval '1 day')::int AS recent,
              count(*) FILTER (WHERE "createdAt" >= now() - interval '1 day' AND "chosenKind" IS NOT NULL)::int AS chosen,
              count(*)::int AS total
         FROM assistant_utterances WHERE "householdId" = $1`,
      [owner.member.householdId],
    )
  ).rows;
  const reportOk =
    searched.status === 201 && missed.status === 201 &&
    cells(section, '| 妈妈 | today_search | navigated |') === '1,1' &&
    cells(section, '| 妈妈 | today_search | no_match |') === '1,0' &&
    expected.total === expected.recent + 1 &&
    section.includes(`- 最近 1 天共 ${expected.recent} 条，其中带 chosenKind 的 ${expected.chosen} 条；全部时间共 ${expected.total} 条`) &&
    cells(otherSection, '| 隔离成员 | command_palette | no_match |') === '1,0' &&
    otherSection.includes('- 最近 1 天共 1 条，其中带 chosenKind 的 0 条；全部时间共 1 条') &&
    !report.includes('冰箱里还有什么') && !report.includes('别人家的原话');
  if (!reportOk) {
    const at = section.indexOf('**助理原话');
    console.log(at >= 0 ? section.slice(at) : `没找到原话段，家庭段落：\n${section || report.slice(0, 3000)}`);
  }
  assert(
    reportOk,
    `用量统计的原话段按「成员 × 入口 × 结果」计数、带 chosenKind 单列，三天前的只进全部时间（最近 ${expected.recent} / 全部 ${expected.total}），按家庭分开，不打印原话`,
  );

  console.log('助理原话黑盒全部通过');
} finally {
  await db.query('DELETE FROM assistant_utterances WHERE id = $1', [staleId]).catch(() => undefined);
  await db.query('DELETE FROM assistant_utterances WHERE "householdId" = $1', [other.householdId]).catch(() => undefined);
  await db.query('DELETE FROM members WHERE id = $1', [other.memberId]).catch(() => undefined);
  await db.query('DELETE FROM households WHERE id = $1', [other.householdId]).catch(() => undefined);
  await db.end();
}
