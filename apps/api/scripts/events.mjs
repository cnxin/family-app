// H2a /events 事件通道黑盒：凭据、hello、写后按域推送、actor、读和失败的写不推、心跳间隔、
// 连接上限、访客公开端点的显式推送。跨家庭收不到见 household-isolation.mjs。
// run-api-tests 把 EVENTS_HEARTBEAT_MS 设成 300，这里按它验间隔。
import { randomUUID } from 'node:crypto';
import { changedDomains, openEventStream } from './events-client.mjs';

const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const HEARTBEAT_MS = Number(process.env.EVENTS_HEARTBEAT_MS || 20_000);
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
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', { loginName, password: PASSWORD });
  if (response.status !== 201) throw new Error(`${loginName} 登录失败 ${response.status}`);
  return { token: response.body.data.accessToken ?? response.body.data.token, memberId: response.body.data.member.id };
}

const isChanged = (domain) => (frame) => changedDomains(frame).includes(domain);
const opened = [];

try {
  console.log('1. 凭据');
  const anonymous = await openEventStream(BASE, null);
  const forged = await openEventStream(BASE, 'not-a-real-token');
  assert(anonymous.status === 401 && forged.status === 401, '没带或带了无效令牌都是 401，令牌不走 URL');

  const dad = await login('爸爸');
  const mom = await login('妈妈');

  console.log('2. hello 与写后推送');
  const stream = await openEventStream(BASE, dad.token);
  opened.push(stream);
  assert(stream.status === 200, '带 Authorization 请求头可以建立连接');
  const hello = await stream.waitFor((frame) => frame.event === 'hello', 2_000);
  const helloData = hello ? JSON.parse(hello.data) : {};
  assert(
    typeof helloData.connectionId === 'string' && !Number.isNaN(Date.parse(helloData.serverTime)),
    '连接后第一条是 hello（serverTime + connectionId）',
  );

  let since = stream.frames.length;
  const list = await request('/shopping-list?date=2200-03-03', mom.token);
  const failed = await request('/shopping-items', mom.token, 'POST', { customName: '' });
  const quiet = await stream.waitFor(isChanged('shopping'), 600, since);
  assert(list.status === 200 && failed.status >= 400 && quiet === null, '读请求和失败的写请求都不推事件');

  since = stream.frames.length;
  const startedAt = Date.now();
  const created = await request('/shopping-items', mom.token, 'POST', {
    date: '2200-03-03',
    customName: `事件测试-${randomUUID().slice(0, 8)}`,
    totalQty: 1,
    unit: '份',
  });
  const pushed = await stream.waitFor(isChanged('shopping'), 1_000, since);
  const pushedData = pushed ? JSON.parse(pushed.data) : {};
  assert(created.status === 201 && pushed !== null, `另一个成员加购物项后 1 秒内收到 changed（${pushed ? pushed.at - startedAt : '-'}ms）`);
  assert(pushedData.actor === mom.memberId && !Number.isNaN(Date.parse(pushedData.at)), 'changed 带发起人和时间，不带数据');
  if (created.body?.data?.id) await request(`/shopping-items/${created.body.data.id}`, mom.token, 'DELETE');

  console.log('3. 访客公开端点由业务服务显式推送');
  const guest = await request('/guests', dad.token, 'POST', { name: `事件访客-${randomUUID().slice(0, 6)}` });
  const visit = await request('/visits', dad.token, 'POST', {
    title: '事件测试来访',
    startsAt: '2200-03-03T11:00:00.000Z',
    guestIds: [guest.body.data.id],
  });
  since = stream.frames.length;
  const invite = await request(`/visits/${visit.body.data.id}/invitations`, dad.token, 'POST', {
    guestId: guest.body.data.id,
    expiresInHours: 1,
  });
  // 先等「创建邀请」这条登录写请求的事件落地，免得它被当成访客回复的事件
  await stream.waitFor(isChanged('guests'), 1_000, since);
  since = stream.frames.length;
  const replied = await request(
    `/guest-invitations/${invite.body.data.invitationToken}/response`,
    null,
    'POST',
    { attending: true },
  );
  const guestEvent = await stream.waitFor(
    (frame) => isChanged('guests')(frame) && JSON.parse(frame.data).actor === undefined,
    1_000,
    since,
  );
  assert(
    replied.status === 201 && guestEvent !== null,
    '访客在公开页回复后，家里人 1 秒内收到 guests（没有 actor）',
  );

  console.log('4. 心跳');
  since = stream.frames.length;
  const first = await stream.waitFor((frame) => frame.event === 'heartbeat', HEARTBEAT_MS * 3, since);
  const second = first
    ? await stream.waitFor((frame) => frame.event === 'heartbeat' && frame !== first, HEARTBEAT_MS * 3, stream.frames.indexOf(first) + 1)
    : null;
  const gap = first && second ? second.at - first.at : -1;
  assert(
    gap >= HEARTBEAT_MS * 0.6 && gap <= HEARTBEAT_MS * 2,
    `心跳间隔约 ${HEARTBEAT_MS}ms（实测 ${gap}ms），内容为空`,
  );
  assert(first.data === '' && second.data === '', '心跳不带内容');

  console.log('5. 每个家庭最多 20 条连接');
  const more = [];
  for (let index = 0; index < 19; index += 1) more.push(await openEventStream(BASE, mom.token));
  opened.push(...more);
  const overflow = await openEventStream(BASE, mom.token);
  opened.push(overflow);
  assert(
    more.every((one) => one.status === 200) && overflow.status === 429,
    '同一家庭第 21 条连接被拒（429），前 20 条正常',
  );
  for (const one of more) one.close();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const again = await openEventStream(BASE, mom.token);
  opened.push(again);
  assert(again.status === 200, '断开之后名额立即归还');

  console.log('\n事件通道测试全部通过');
} finally {
  for (const one of opened) one.close();
}
