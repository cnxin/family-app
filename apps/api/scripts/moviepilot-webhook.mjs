import http from 'node:http';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const API_KEY = 'moviepilot-webhook-fixture-key';

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
  const response = await request('/auth/login', null, 'POST', {
    loginName,
    password: PASSWORD,
  });
  assert(response.status === 201, `${loginName}可以登录`);
  return response.body.data;
}

const tmdbId = String(910000000 + Math.floor(Math.random() * 80000000));
const subscriptionId = String(700000 + Math.floor(Math.random() * 200000));
const fakeMoviePilot = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  let responseBody = {};
  if (req.headers['x-api-key'] !== API_KEY) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'unauthorized' }));
    return;
  }
  if (
    req.method === 'GET' &&
    decodeURIComponent(url.pathname) === `/api/v1/subscribe/media/themoviedb:${tmdbId}`
  ) {
    responseBody = {};
  } else if (req.method === 'POST' && url.pathname === '/api/v1/subscribe/') {
    responseBody = { success: true, data: { id: subscriptionId } };
  } else if (
    req.method === 'GET' &&
    url.pathname === `/api/v1/subscribe/${subscriptionId}`
  ) {
    responseBody = {
      id: Number(subscriptionId),
      state: 'N',
      tmdbid: Number(tmdbId),
      type: '电视剧',
    };
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(responseBody));
});

await new Promise((resolve, reject) => {
  fakeMoviePilot.once('error', reject);
  fakeMoviePilot.listen(0, '127.0.0.1', resolve);
});

const db = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});
await db.connect();

let mediaId = null;
let otherHouseholdId = null;
try {
  const address = fakeMoviePilot.address();
  if (!address || typeof address === 'string') {
    throw new Error('测试 MoviePilot 监听失败');
  }
  const owner = await login('爸爸');
  const requester = await login('妈妈');
  const configured = await request(
    '/media/connector-settings/moviepilot',
    owner.accessToken,
    'PUT',
    {
      name: '回调测试 MoviePilot',
      isEnabled: true,
      baseUrl: `http://127.0.0.1:${address.port}`,
      credential: API_KEY,
    },
  );
  assert(configured.status === 200, '管理员可以保存回调测试连接');

  const forbidden = await request(
    '/media/connector-settings/moviepilot/webhook',
    requester.accessToken,
    'POST',
    { sourceIp: '127.0.0.1' },
  );
  assert(forbidden.status === 403, '普通成员不能生成 MoviePilot 回调地址');

  const wrongSourceCallback = await request(
    '/media/connector-settings/moviepilot/webhook',
    owner.accessToken,
    'POST',
    { sourceIp: '192.0.2.10' },
  );
  const wrongSource = await request(
    wrongSourceCallback.body.data.callbackPath,
    null,
    'POST',
    { type: 'TransferComplete', data: {} },
  );
  assert(wrongSource.status === 403, '拒绝非允许来源 IP 的 MoviePilot 回调');

  const callback = await request(
    '/media/connector-settings/moviepilot/webhook',
    owner.accessToken,
    'POST',
    { sourceIp: '127.0.0.1' },
  );
  const callbackPath = callback.body.data.callbackPath;
  const callbackSecret = callbackPath.split('/').at(-1);
  const integrationId = callbackPath.split('/').at(-2);
  const storedSecret = await db.query(
    `SELECT "webhookSecretHash", "webhookSourceIp"
     FROM integrations WHERE id = $1`,
    [integrationId],
  );
  assert(
    callback.status === 201 &&
      callbackSecret &&
      storedSecret.rows[0].webhookSecretHash.length === 64 &&
      storedSecret.rows[0].webhookSecretHash !== callbackSecret &&
      !storedSecret.rows[0].webhookSecretHash.includes(callbackSecret) &&
      storedSecret.rows[0].webhookSourceIp === '127.0.0.1',
    '回调地址只显示一次且数据库只保存密钥哈希',
  );

  const wrongSecretPath = callbackPath.replace(
    callbackSecret,
    'invalid-moviepilot-webhook-secret',
  );
  const wrongSecret = await request(wrongSecretPath, null, 'POST', {
    type: 'TransferComplete',
    data: {},
  });
  assert(wrongSecret.status === 404, '错误的 MoviePilot 回调密钥会被拒绝');

  const unknownEvent = await request(callbackPath, null, 'POST', {
    type: 'DownloadAdded',
    data: { marker: 'unknown-event-must-not-be-stored' },
  });
  const eventCountAfterUnknown = await db.query(
    'SELECT count(*)::int AS count FROM integration_events WHERE "integrationId" = $1',
    [integrationId],
  );
  assert(
    unknownEvent.status === 200 &&
      unknownEvent.body.data.ignored === true &&
      eventCountAfterUnknown.rows[0].count === 0,
    '未知 MoviePilot 事件直接忽略且不会灌入审计表',
  );

  const oversized = await request(callbackPath, null, 'POST', {
    type: 'TransferComplete',
    data: { padding: 'x'.repeat(70 * 1024) },
  });
  assert(oversized.status === 413, 'MoviePilot 回调限制为 64 KiB');

  const created = await request('/media', requester.accessToken, 'POST', {
    type: 'series',
    title: `MoviePilot 回调测试 ${tmdbId}`,
    year: 2099,
    externalRefs: [{ provider: 'tmdb', externalId: tmdbId }],
  });
  mediaId = created.body.data.id;
  const submitted = await request(
    `/media/${mediaId}/requests`,
    requester.accessToken,
    'POST',
    { connectorKey: 'moviepilot', season: 3 },
  );
  assert(
    created.status === 201 &&
      submitted.status === 201 &&
      submitted.body.data.status === 'pending' &&
      submitted.body.data.season === 3,
    '家庭成员可以通过测试 MoviePilot 建立待处理订阅',
  );

  const householdId = owner.member.householdId;
  const titleId = created.body.data.mediaTitle.id;
  otherHouseholdId = randomUUID();
  const otherMemberId = randomUUID();
  const otherMediaId = randomUUID();
  const otherRequestId = randomUUID();
  await db.query(
    'INSERT INTO households (id, name, slug) VALUES ($1, $2, $3)',
    [otherHouseholdId, '回调隔离测试家庭', `webhook-${otherHouseholdId}`],
  );
  await db.query(
    `INSERT INTO members (id, "householdId", name, "avatarEmoji", role)
     VALUES ($1, $2, '回调隔离成员', 'T', 'member')`,
    [otherMemberId, otherHouseholdId],
  );
  await db.query(
    `INSERT INTO household_media
       (id, "householdId", "mediaTitleId", status, "createdById")
     VALUES ($1, $2, $3, 'watchlist', $4)`,
    [otherMediaId, otherHouseholdId, titleId, otherMemberId],
  );
  await db.query(
    `INSERT INTO media_requests
       (id, "householdId", "householdMediaId", "connectorKey", season,
        status, "requestedById")
     VALUES ($1, $2, $3, 'moviepilot', 3, 'pending', $4)`,
    [otherRequestId, otherHouseholdId, otherMediaId, otherMemberId],
  );

  const unmatchedPayload = {
    type: 'TransferComplete',
    data: {
      mediainfo: {
        title: '不匹配的回调',
        type: '电视剧',
        tmdb_id: Number(tmdbId) + 1,
      },
      meta: { begin_season: 3 },
      transferinfo: { fileitem: '/private/unmatched-path.mkv' },
    },
  };
  const unmatched = await request(callbackPath, null, 'POST', unmatchedPayload);
  const requestAfterUnmatched = await request(
    `/media/requests?mediaId=${mediaId}`,
    requester.accessToken,
  );
  assert(
    unmatched.status === 200 &&
      unmatched.body.data.ignored === true &&
      requestAfterUnmatched.body.data[0].status === 'pending',
    'TMDB ID 不匹配时保留待处理订阅',
  );

  const wrongSeasonPayload = {
    type: 'TransferComplete',
    data: {
      mediainfo: {
        title: created.body.data.mediaTitle.title,
        type: '电视剧',
        tmdb_id: Number(tmdbId),
      },
      meta: { begin_season: 2 },
      transferinfo: { fileitem: '/private/wrong-season-path.mkv' },
    },
  };
  const wrongSeason = await request(
    callbackPath,
    null,
    'POST',
    wrongSeasonPayload,
  );
  const requestAfterWrongSeason = await request(
    `/media/requests?mediaId=${mediaId}`,
    requester.accessToken,
  );
  assert(
    wrongSeason.status === 200 &&
      wrongSeason.body.data.ignored === true &&
      requestAfterWrongSeason.body.data[0].status === 'pending',
    '剧集季数不匹配时保留待处理订阅',
  );

  const completedPayload = {
    type: 'TransferComplete',
    data: {
      mediainfo: {
        title: created.body.data.mediaTitle.title,
        original_title: 'Webhook Fixture',
        year: 2099,
        type: '电视剧',
        tmdb_id: Number(tmdbId),
      },
      meta: { begin_season: 3 },
      transferinfo: { fileitem: '/private/media-ready-path.mkv' },
    },
  };
  const completed = await request(callbackPath, null, 'POST', completedPayload);
  const duplicate = await request(callbackPath, null, 'POST', completedPayload);
  const requests = await request(
    `/media/requests?mediaId=${mediaId}`,
    requester.accessToken,
  );
  const requesterNotifications = await request(
    '/notifications?includeRead=true',
    requester.accessToken,
  );
  const ownerNotifications = await request(
    '/notifications?includeRead=true',
    owner.accessToken,
  );
  const otherRequest = await db.query(
    'SELECT status FROM media_requests WHERE id = $1',
    [otherRequestId],
  );
  const events = (
    await db.query(
      `SELECT status, payload, "mediaRequestId"
       FROM integration_events WHERE "integrationId" = $1
       ORDER BY "receivedAt"`,
      [integrationId],
    )
  ).rows;
  const readyNotifications = requesterNotifications.body.data.filter(
    (item) => item.type === 'media_ready' && item.sourceId === mediaId,
  );
  assert(
    completed.status === 200 &&
      completed.body.data.matched === true &&
      requests.body.data[0].status === 'completed' &&
      duplicate.body.data.duplicate === true &&
      readyNotifications.length === 1 &&
      readyNotifications[0].module === 'media' &&
      readyNotifications[0].targetPath ===
        `/media/watchlist?mediaId=${mediaId}&view=detail` &&
      !ownerNotifications.body.data.some(
        (item) => item.type === 'media_ready' && item.sourceId === mediaId,
      ),
    '完成事件只处理一次并只通知原申请人',
  );
  assert(
    otherRequest.rows[0].status === 'pending',
    'MoviePilot 完成回调不会修改其他家庭的订阅',
  );
  assert(
    events.length === 3,
    `匹配、错误编号和错误季数事件分别保留审计记录（实际 ${events.length} 条）`,
  );
  const processedEvent = events.find((event) => event.status === 'processed');
  assert(Boolean(processedEvent), '匹配事件记录为已处理状态');
  assert(
    processedEvent.mediaRequestId === submitted.body.data.id,
    '已处理事件关联对应的家庭订阅请求',
  );
  assert(
    events.every(
      (event) =>
        !JSON.stringify(event.payload).includes('/private/') &&
        !Object.hasOwn(event.payload, 'transferinfo'),
    ),
    '事件审计只保存脱敏后的必要字段',
  );

  const listed = await request('/media/connector-settings', owner.accessToken);
  const moviePilot = listed.body.data.find((item) => item.kind === 'moviepilot');
  assert(
    moviePilot.webhookConfigured === true &&
      moviePilot.webhookSourceIp === '127.0.0.1' &&
      !JSON.stringify(moviePilot).includes(callbackSecret),
    '连接设置只返回回调状态和允许来源 IP',
  );

  console.log('\nMoviePilot 完成回调测试全部通过');
} finally {
  if (otherHouseholdId) {
    await db.query('DELETE FROM media_requests WHERE "householdId" = $1', [
      otherHouseholdId,
    ]);
    await db.query('DELETE FROM household_media WHERE "householdId" = $1', [
      otherHouseholdId,
    ]);
    await db.query('DELETE FROM members WHERE "householdId" = $1', [
      otherHouseholdId,
    ]);
    await db.query('DELETE FROM households WHERE id = $1', [otherHouseholdId]);
  }
  if (mediaId) {
    const owner = await login('爸爸');
    await request(`/media/${mediaId}`, owner.accessToken, 'DELETE');
    await request(
      '/media/connector-settings/moviepilot',
      owner.accessToken,
      'DELETE',
    );
  }
  await db.end();
  await new Promise((resolve, reject) =>
    fakeMoviePilot.close((error) => (error ? reject(error) : resolve())),
  );
}
