// K2 截图记账黑盒（docs/finance-plan.md §3-K2，J4 第四批）：用假模型服务（fake-model.mjs 收到图片回固定 JSON）
// 识别成功预填正确（分类按商户规则、账户按付款方式）、确认记一笔落 screenshot 流水、截图在私有目录且不能匿名访问；
// 没权限 403、超 4 MB / 非图片 400、模型两次都回非 JSON → 422、计入每日上限（同一把锁，用完 429）。
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { FAKE_SCREENSHOT_REPLY, startFakeModel } from './fake-model.mjs';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const DATABASE = process.env.DB_NAME || 'family_app';
const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
if (!DATABASE.startsWith('family_app_test_')) {
  throw new Error('finance-screenshot.mjs 只允许在 API 临时测试库中运行');
}

// 1×1 的 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, data: json?.data, error: json?.error };
}

async function recognize(token, bytes = PNG, type = 'image/png', name = 'shot.png') {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  const response = await fetch(`${BASE}/finance/screenshot-recognize`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, data: json?.data, error: json?.error };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', { loginName, password: PASSWORD });
  assert(response.status === 201, `${loginName}可以登录截图记账回归`);
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

const owner = await login('爸爸');
const member = await login('妈妈');
const householdId = owner.member.householdId;
const shotDir = join(UPLOAD_DIR, '.private', 'finance', householdId);
const shotsOnDisk = () => (existsSync(shotDir) ? readdirSync(shotDir).length : 0);
const model = await startFakeModel();
const original = (await request('/agent/settings', owner.accessToken)).data;
const patch = async (body) => {
  const current = (await request('/agent/settings', owner.accessToken)).data;
  return request('/agent/settings', owner.accessToken, 'PATCH', { ...body, expectedVersion: current.version });
};
const mark = randomUUID().slice(0, 6);
const parked = [];

try {
  console.log('1. 没配云端模型：入口关着，识别 403');
  const closed = (await request('/agent/status', owner.accessToken)).data;
  const refusedBeforeSetup = await recognize(owner.accessToken);
  assert(closed.visionAvailable === false && refusedBeforeSetup.status === 403, '状态 visionAvailable = false，识别接口 403');

  console.log('2. 配好云端模型（假模型服务）、测通、打开第 2 档；运行方式不动');
  await patch({ providerKind: 'custom', providerBaseUrl: model.url, providerModel: 'fake-vision', providerKey: model.key });
  const checked = await request('/agent/settings/provider-check', owner.accessToken, 'POST');
  const opened = await patch({ enabled: true, tier2Scope: 'admins', tier2DailyLimit: 50 });
  assert(checked.data?.ok === true && opened.status === 200 && opened.data.runtimeKind === original.runtimeKind, '测通、打开第 2 档，运行方式仍是原来的');
  const ownerStatus = (await request('/agent/status', owner.accessToken)).data;
  const memberStatus = (await request('/agent/status', member.accessToken)).data;
  assert(ownerStatus.visionAvailable === true && memberStatus.visionAvailable === false, '管理员 visionAvailable = true；tier2Scope = admins 时普通成员 false（表单不显示「传截图」）');

  console.log('3. 识别成功：预填金额 / 方向 / 商户 / 日期 / 分类 / 账户 / 备注，截图落在私有目录');
  const alipay = await request('/finance/accounts', owner.accessToken, 'POST', { name: `支付宝${mark}`, type: 'alipay' });
  const otherAlipay = (await request('/finance/accounts', owner.accessToken)).data.filter((one) => one.type === 'alipay' && one.isActive);
  // 家里只留这一个支付宝类账户在用，免得「同类多个就不猜」
  for (const extra of otherAlipay.filter((one) => one.id !== alipay.data.id)) {
    await db.query('UPDATE finance_accounts SET "isActive" = false WHERE id = $1', [extra.id]);
    parked.push(extra.id);
  }
  const food = (await request('/finance/categories', owner.accessToken)).data.find((one) => one.name === '餐饮' && one.kind === 'expense');
  const before = shotsOnDisk();
  const requestsBefore = model.requests.length;
  const recognized = await recognize(owner.accessToken);
  const fill = recognized.data;
  assert(
    recognized.status === 201 && fill.amount === FAKE_SCREENSHOT_REPLY.amount && fill.direction === 'expense' &&
      fill.merchant === '美团外卖-望京店' && fill.occurredOn === '2026-10-09' && fill.payMethod === '花呗' && fill.note === '午饭',
    `识别结果：36.5 元支出、美团外卖-望京店、2026-10-09、花呗、午饭（${recognized.status}）`,
  );
  assert(fill.categoryId === food.id && fill.accountId === alipay.data.id && fill.title === '美团外卖-望京店', '分类按商户规则 → 餐饮，账户按「花呗」→ 支付宝类账户，名称取商户');
  assert(
    /^[0-9a-f-]{36}\.png$/.test(fill.attachmentPath) && existsSync(join(shotDir, fill.attachmentPath)) && shotsOnDisk() === before + 1,
    `截图存到 uploads/.private/finance/<家庭>/${fill.attachmentPath}`,
  );
  const sent = model.requests.slice(requestsBefore);
  const userContent = sent[0]?.messages?.find((message) => message.role === 'user')?.content;
  assert(
    sent.length === 1 && sent[0].model === 'fake-vision' &&
      Array.isArray(userContent) && userContent.some((part) => part.type === 'image_url' && part.image_url.url.startsWith('data:image/png;base64,')) &&
      sent[0].messages[0].role === 'system' && sent[0].messages[0].content.includes('只输出一个 JSON 对象'),
    '发给模型的是一条带图片（image_url，data URL）的请求，system 是固定的 JSON 模板',
  );
  const visionRun = (await db.query(
    `SELECT tier, redacted, status, "runtimeVersion", "allowedTools" FROM agent_runs
      WHERE "householdId" = $1 AND "runtimeVersion" = 'vision-1' ORDER BY "createdAt" DESC LIMIT 1`,
    [householdId],
  )).rows[0];
  assert(
    visionRun?.tier === 2 && visionRun.status === 'completed' && visionRun.redacted === original.tier2Redact &&
      visionRun.allowedTools.length === 0,
    '记一条 tier = 2 的 run（runtimeVersion = vision-1，completed，redacted 照家庭的脱敏开关）',
  );
  const conversations = (await request('/agent/conversations', owner.accessToken)).data;
  assert(!conversations.some((one) => one.title === '截图记账'), '审计挂的会话是归档的，不出现在对话列表');

  console.log('4. 确认才落流水：sourceType = screenshot，带截图；私有文件匿名拿不到');
  const created = await request('/finance/transactions', owner.accessToken, 'POST', {
    type: fill.direction,
    amount: fill.amount,
    accountId: fill.accountId,
    categoryId: fill.categoryId,
    title: fill.title,
    note: fill.note,
    occurredOn: fill.occurredOn,
    merchant: fill.merchant,
    attachmentPath: fill.attachmentPath,
    idempotencyKey: `screenshot:${mark}`,
  });
  assert(
    created.status === 201 && created.data.sourceType === 'screenshot' && created.data.attachmentPath === fill.attachmentPath &&
      created.data.merchant === '美团外卖-望京店',
    '记一笔：sourceType = screenshot，attachmentPath、merchant 落库',
  );
  const anonymousFile = await fetch(`${BASE}/uploads/.private/finance/${householdId}/${fill.attachmentPath}`);
  const anonymousRoute = await fetch(`${BASE}/finance/transactions/${created.data.id}/attachment`);
  const memberFile = await fetch(`${BASE}/finance/transactions/${created.data.id}/attachment`, {
    headers: { Authorization: `Bearer ${member.accessToken}` },
  });
  const bytes = Buffer.from(await memberFile.arrayBuffer());
  assert(
    anonymousFile.status === 404 && anonymousRoute.status === 401 && memberFile.status === 200 &&
      memberFile.headers.get('content-type') === 'image/png' && memberFile.headers.get('cache-control') === 'private, no-store' &&
      bytes.equals(PNG),
    '静态 /uploads 拿不到 .private（404）、读取路由不带令牌 401；家里人（能看账）带令牌拿到原图',
  );
  const noShot = await request('/finance/transactions', owner.accessToken, 'POST', {
    type: 'expense', amount: 1, accountId: fill.accountId, categoryId: fill.categoryId, title: '假截图', occurredOn: '2026-10-09',
    attachmentPath: `${randomUUID()}.png`, idempotencyKey: `screenshot-missing:${mark}`,
  });
  const traversal = await request('/finance/transactions', owner.accessToken, 'POST', {
    type: 'expense', amount: 1, accountId: fill.accountId, categoryId: fill.categoryId, title: '路径', occurredOn: '2026-10-09',
    attachmentPath: '../maps/x.png', idempotencyKey: `screenshot-traversal:${mark}`,
  });
  const plain = (await request('/finance/transactions?month=2026-10', owner.accessToken)).data.find((one) => one.title === '假截图');
  assert(noShot.status === 400 && traversal.status === 400 && !plain, '截图文件名对不上真文件 400，带路径的文件名 400，都不落流水');

  console.log('5. 没权限 403，超 4 MB / 非图片 400');
  const memberRefused = await recognize(member.accessToken);
  assert(memberRefused.status === 403, 'tier2Scope = admins：普通成员识别 403');
  const big = Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)]);
  const tooBig = await recognize(owner.accessToken, big);
  const notImage = await recognize(owner.accessToken, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png', 'fake.png');
  assert(
    tooBig.status === 400 && tooBig.error?.message === '截图不能超过 4 MB' && notImage.status === 400 && notImage.error?.message === '只支持 JPG、PNG、WebP 截图',
    '超过 4 MB 400「截图不能超过 4 MB」；声明成 PNG 的 SVG 按文件头认出不是图片 400',
  );

  console.log('6. 模型两次都回非 JSON → 422，截图不留');
  model.vision.mode = 'garbage';
  const filesBefore = shotsOnDisk();
  const garbageRequests = model.requests.length;
  const unrecognized = await recognize(owner.accessToken);
  model.vision.mode = 'json';
  const failedRun = (await db.query(
    `SELECT status, "errorCode", tier FROM agent_runs WHERE "householdId" = $1 AND "runtimeVersion" = 'vision-1' ORDER BY "createdAt" DESC LIMIT 1`,
    [householdId],
  )).rows[0];
  assert(
    unrecognized.status === 422 && unrecognized.error?.message === '没认出来，手动填吧' && model.requests.length === garbageRequests + 2 &&
      shotsOnDisk() === filesBefore && failedRun.status === 'failed' && failedRun.errorCode === 'VISION_UNRECOGNIZED' && failedRun.tier === 2,
    '重试一次仍不是 JSON → 422「没认出来，手动填吧」；打了两次模型，截图删掉，run 记 failed（仍算一次额度）',
  );

  console.log('7. 计入每日上限（与对话同一把锁）：上限 1，第 2 次 429');
  await db.query('UPDATE agent_runs SET tier = NULL WHERE "householdId" = $1 AND tier = 2', [householdId]);
  await patch({ tier2DailyLimit: 1 });
  const first = await recognize(owner.accessToken);
  const modelCalls = model.requests.length;
  const second = await recognize(owner.accessToken);
  const counted = (await db.query(
    `SELECT COUNT(*) FILTER (WHERE tier = 2)::int AS tier2,
            COUNT(*) FILTER (WHERE "errorCode" = 'AGENT_DAILY_LIMIT' AND "runtimeVersion" = 'vision-1')::int AS refused
       FROM agent_runs WHERE "householdId" = $1`,
    [householdId],
  )).rows[0];
  assert(
    first.status === 201 && second.status === 429 && second.error?.message === '今天小管家的云端额度用完了，明天再问' &&
      model.requests.length === modelCalls && counted.tier2 === 1 && counted.refused >= 1,
    '第 1 次识别占掉唯一的额度；第 2 次不打模型、429 固定文案，记一条被挡下的审计 run',
  );
} finally {
  for (const id of parked) await db.query('UPDATE finance_accounts SET "isActive" = true WHERE id = $1', [id]);
  await patch({
    enabled: original.enabled,
    tier2Scope: original.tier2Scope,
    tier2DailyLimit: original.tier2DailyLimit,
    providerKind: null,
    providerBaseUrl: null,
    providerModel: null,
    providerKey: null,
  });
  await model.stop();
  await db.end();
}
console.log('finance-screenshot.mjs 全部通过');
