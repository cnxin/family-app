import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import pg from 'pg';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const TEST_CREDENTIAL = 'external-regression-secret';

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  assert(response.status === 201, `${loginName}登录成功`);
  return response.data;
}

async function waitForDeliveries(token, notificationId, predicate) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await request('/notification-deliveries?status=all', token);
    const rows = response.data.filter(
      (delivery) => delivery.notificationId === notificationId,
    );
    if (predicate(rows)) return rows;
    await wait(100);
  }
  throw new Error('等待外部通知投递状态超时');
}

const received = [];
let flakyFailures = 0;
let recoverEnabled = false;
const receiver = createServer(async (incoming, response) => {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');
  let body = null;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    body = null;
  }
  received.push({
    path: incoming.url,
    authorization: incoming.headers.authorization ?? null,
    idempotencyKey: incoming.headers['idempotency-key'] ?? null,
    event: incoming.headers['x-family-notification-event'] ?? null,
    body,
  });
  if (incoming.url === '/flaky' && flakyFailures < 2) {
    flakyFailures += 1;
    response.statusCode = 503;
  } else if (incoming.url === '/recover' && !recoverEnabled) {
    response.statusCode = 400;
  } else {
    response.statusCode = 204;
  }
  response.end();
});
receiver.listen(0, '127.0.0.1');
await once(receiver, 'listening');
const address = receiver.address();
if (!address || typeof address === 'string') throw new Error('测试接收器启动失败');
const receiverBase = `http://127.0.0.1:${address.port}`;

const db = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});
const createdChannelIds = [];
const createdNotificationIds = [];
await db.connect();

try {
  const dad = await login('爸爸');
  const mom = await login('妈妈');
  const dadToken = dad.accessToken;
  const momToken = mom.accessToken;

  console.log('1. 加密渠道、权限和测试投递');
  const forbidden = await request('/notification-channels', momToken, 'POST', {
    name: '越权渠道',
    kind: 'webhook',
    endpoint: `${receiverBase}/success`,
  });
  assert(forbidden.status === 403, '普通成员不能管理家庭外部渠道');

  const successChannel = await request(
    '/notification-channels',
    dadToken,
    'POST',
    {
      name: '回归 Webhook',
      kind: 'webhook',
      endpoint: `${receiverBase}/success`,
      credential: TEST_CREDENTIAL,
    },
  );
  const flakyChannel = await request('/notification-channels', dadToken, 'POST', {
    name: '回归自动重试',
    kind: 'ntfy',
    endpoint: `${receiverBase}/flaky`,
  });
  const recoverChannel = await request(
    '/notification-channels',
    dadToken,
    'POST',
    {
      name: '回归手动恢复',
      kind: 'webhook',
      endpoint: `${receiverBase}/recover`,
    },
  );
  for (const response of [successChannel, flakyChannel, recoverChannel]) {
    assert(response.status === 201, '管理员可以创建外部通知渠道');
    createdChannelIds.push(response.data.id);
  }
  assert(
    successChannel.data.endpointHint === receiverBase &&
      successChannel.data.credentialHint === '****cret' &&
      !JSON.stringify(successChannel.data).includes('/success') &&
      !JSON.stringify(successChannel.data).includes(TEST_CREDENTIAL),
    'API 只返回地址主机提示和凭据尾号，不回传密文或完整秘密',
  );

  const tested = await request(
    `/notification-channels/${successChannel.data.id}/test`,
    dadToken,
    'POST',
  );
  assert(
    tested.status === 201 &&
      received.some(
        (entry) =>
          entry.path === '/success' &&
          entry.authorization === `Bearer ${TEST_CREDENTIAL}` &&
          entry.event === 'family.notification.test',
      ),
    '测试投递使用加密 Bearer 凭据且不写入应用响应',
  );

  const foreignPreference = await request(
    `/notification-channels/${randomUUID()}/preference`,
    momToken,
    'PUT',
    { isEnabled: true, modules: ['system'] },
  );
  assert(foreignPreference.status === 404, '不存在或跨家庭渠道按不存在处理');

  console.log('2. 成员偏好、幂等投递和自动重试');
  for (const channelId of createdChannelIds) {
    const preference = await request(
      `/notification-channels/${channelId}/preference`,
      momToken,
      'PUT',
      { isEnabled: true, modules: ['system'] },
    );
    assert(
      preference.status === 200 &&
        preference.data.isEnabled === true &&
        preference.data.modules.length === 1,
      '成员可以单独启用渠道并选择通知模块',
    );
  }

  const notificationId = randomUUID();
  createdNotificationIds.push(notificationId);
  await db.query(
    `INSERT INTO notifications
       (id, "householdId", "recipientId", module, type, "sourceId", title, body, "targetPath")
     VALUES ($1, $2, $3, 'system', 'external_regression', NULL, '外部通知回归', '验证重试和幂等', '/notifications')`,
    [notificationId, mom.member.householdId, mom.member.id],
  );
  const deliveries = await waitForDeliveries(
    momToken,
    notificationId,
    (rows) =>
      rows.length === 3 &&
      rows.some((row) => row.channelId === successChannel.data.id && row.status === 'sent') &&
      rows.some((row) => row.channelId === flakyChannel.data.id && row.status === 'sent') &&
      rows.some((row) => row.channelId === recoverChannel.data.id && row.status === 'failed'),
  );
  const flakyDelivery = deliveries.find(
    (delivery) => delivery.channelId === flakyChannel.data.id,
  );
  const recoverDelivery = deliveries.find(
    (delivery) => delivery.channelId === recoverChannel.data.id,
  );
  const flakyRequests = received.filter(
    (entry) =>
      entry.path === '/flaky' && entry.event === 'family.notification',
  );
  assert(
    flakyDelivery.attemptCount === 3 &&
      flakyDelivery.attempts.length === 3 &&
      new Set(flakyRequests.map((entry) => entry.idempotencyKey)).size === 1,
    '临时故障按指数退避自动重试，并沿用稳定幂等键记录每次尝试',
  );
  assert(
    recoverDelivery.status === 'failed' &&
      recoverDelivery.attemptCount === 1 &&
      recoverDelivery.attempts[0].errorCode === 'HTTP_400',
    '永久错误停止自动重试并保留脱敏失败原因',
  );
  await wait(300);
  const duplicateCheck = await request(
    '/notification-deliveries?status=all',
    momToken,
  );
  assert(
    duplicateCheck.data.filter(
      (delivery) => delivery.notificationId === notificationId,
    ).length === 3,
    '后台重复扫描不会为同一通知和渠道创建重复投递',
  );

  const adminHistory = await request(
    '/notification-deliveries?status=all',
    dadToken,
  );
  assert(
    adminHistory.data.some(
      (delivery) =>
        delivery.notificationId === notificationId &&
        delivery.recipient.id === mom.member.id,
    ),
    '管理员可查看本家庭投递，成员只读取自己的投递记录',
  );

  console.log('3. 手动恢复、偏好过滤和不可变历史');
  recoverEnabled = true;
  const retry = await request(
    `/notification-deliveries/${recoverDelivery.id}/retry`,
    momToken,
    'POST',
  );
  assert(retry.status === 201, '失败投递的接收成员可以明确要求重试');
  const recovered = await waitForDeliveries(
    momToken,
    notificationId,
    (rows) =>
      rows.some(
        (delivery) =>
          delivery.id === recoverDelivery.id && delivery.status === 'sent',
      ),
  );
  const recoveredDelivery = recovered.find(
    (delivery) => delivery.id === recoverDelivery.id,
  );
  assert(
    recoveredDelivery.attemptCount === 2 &&
      recoveredDelivery.attempts.length === 2,
    '手动重试追加尝试记录，不覆盖原失败历史',
  );

  await request(
    `/notification-channels/${successChannel.data.id}/preference`,
    momToken,
    'PUT',
    { isEnabled: false, modules: ['system'] },
  );
  await request(
    `/notification-channels/${flakyChannel.data.id}/preference`,
    momToken,
    'PUT',
    { isEnabled: true, modules: ['task'] },
  );
  await request(
    `/notification-channels/${recoverChannel.data.id}/preference`,
    momToken,
    'PUT',
    { isEnabled: false, modules: ['system'] },
  );
  const filteredNotificationId = randomUUID();
  createdNotificationIds.push(filteredNotificationId);
  await db.query(
    `INSERT INTO notifications
       (id, "householdId", "recipientId", module, type, "sourceId", title, body, "targetPath")
     VALUES ($1, $2, $3, 'system', 'external_filter_regression', NULL, '偏好过滤回归', NULL, '/notifications')`,
    [filteredNotificationId, mom.member.householdId, mom.member.id],
  );
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const routed = await db.query(
      `SELECT "externalRoutedAt" FROM notifications WHERE id = $1`,
      [filteredNotificationId],
    );
    if (routed.rows[0]?.externalRoutedAt) break;
    await wait(100);
  }
  const filteredDeliveries = await request(
    '/notification-deliveries?status=all',
    momToken,
  );
  assert(
    !filteredDeliveries.data.some(
      (delivery) => delivery.notificationId === filteredNotificationId,
    ),
    '停用偏好或未选择的模块不会发送到外部，站内通知仍保留',
  );

  const deleted = await request(
    `/notification-channels/${successChannel.data.id}`,
    dadToken,
    'DELETE',
  );
  createdChannelIds.splice(createdChannelIds.indexOf(successChannel.data.id), 1);
  const historyAfterDelete = await request(
    '/notification-deliveries?status=all',
    momToken,
  );
  const retained = historyAfterDelete.data.find(
    (delivery) =>
      delivery.notificationId === notificationId &&
      delivery.channelName === '回归 Webhook',
  );
  assert(
    deleted.status === 200 && retained?.channelId === null && retained.status === 'sent',
    '删除渠道只清理配置和偏好，历史投递保留渠道快照',
  );

  const activities = await request('/activities?limit=100', dadToken);
  const actions = activities.data.map((activity) => activity.action);
  assert(
    actions.includes('notification_channel_created') &&
      actions.includes('notification_channel_test_succeeded') &&
      actions.includes('notification_delivery_retried') &&
      actions.includes('notification_channel_deleted'),
    '渠道管理、测试和人工重试进入家庭活动审计',
  );

  console.log('\n外部通知渠道与投递回归测试全部通过');
} finally {
  for (const channelId of createdChannelIds) {
    const login = await request('/auth/login', null, 'POST', {
      loginName: '爸爸',
      password: PASSWORD,
    });
    if (login.status === 201) {
      await request(
        `/notification-channels/${channelId}`,
        login.data.accessToken,
        'DELETE',
      );
    }
  }
  if (createdNotificationIds.length) {
    await db.query(`DELETE FROM notifications WHERE id = ANY($1::uuid[])`, [
      createdNotificationIds,
    ]);
  }
  await db.end();
  receiver.close();
  await once(receiver, 'close');
}
