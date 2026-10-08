import { readFileSync } from 'node:fs';
import http from 'node:http';
import pg from 'pg';

const { Client } = pg;
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const PLEX_TOKEN = 'playback-plex-fixture-token';
const EMBY_KEY = 'playback-emby-fixture-key';

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

async function plexWebhook(path, payload) {
  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  const response = await fetch(`${BASE}${path}`, { method: 'POST', body: form });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

/** 任意 multipart：parts 是 [字段名, 值, 文件名?]，值是 Blob 时当文件；requestId 用来在 API 日志里找这条 */
async function multipartWebhook(path, parts, requestId) {
  const form = new FormData();
  for (const [name, value, fileName] of parts) {
    if (value instanceof Blob) form.append(name, value, fileName);
    else form.append(name, value);
  }
  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'x-request-id': requestId }, body: form });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', {
    loginName,
    password: PASSWORD,
  });
  assert(response.status === 201, `${loginName}可以登录播放回调测试`);
  return response.body.data;
}

const fakeMediaServer = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  let body;
  if (url.pathname === '/identity') {
    body = {
      MediaContainer: {
        machineIdentifier: 'playback-plex-server',
        version: 'fixture',
      },
    };
  } else if (url.pathname === '/accounts') {
    body = {
      MediaContainer: {
        Account: [
          { id: 'plex-user-mom', name: '妈妈 Plex' },
          { id: 'plex-user-guest', name: '访客 Plex' },
        ],
      },
    };
  } else if (url.pathname === '/System/Info') {
    body = { Id: 'playback-emby-server', Version: 'fixture' };
  } else if (url.pathname === '/Users') {
    body = [
      { Id: 'emby-user-mom', Name: '妈妈 Emby', Policy: { IsDisabled: false } },
    ];
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
});

await new Promise((resolve, reject) => {
  fakeMediaServer.once('error', reject);
  fakeMediaServer.listen(0, '127.0.0.1', resolve);
});

const db = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});
await db.connect();

try {
  const address = fakeMediaServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('测试媒体服务监听失败');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const owner = await login('爸爸');
  const member = await login('妈妈');
  const householdId = owner.member.householdId;

  const configurePlex = await request(
    '/media/connector-settings/plex',
    owner.accessToken,
    'PUT',
    {
      name: '播放测试 Plex',
      isEnabled: true,
      baseUrl,
      credential: PLEX_TOKEN,
      isPrimary: true,
    },
  );
  const configureEmby = await request(
    '/media/connector-settings/emby',
    owner.accessToken,
    'PUT',
    {
      name: '播放测试 Emby',
      isEnabled: true,
      baseUrl,
      credential: EMBY_KEY,
      isPrimary: false,
    },
  );
  assert(
    configurePlex.status === 200 && configureEmby.status === 200,
    '管理员可以配置 Plex 与 Emby 播放回调测试服务',
  );

  const mapPlex = await request(
    '/media/playback-users/plex/plex-user-mom/mapping',
    owner.accessToken,
    'PUT',
    { memberId: member.member.id },
  );
  const mapEmby = await request(
    '/media/playback-users/emby/emby-user-mom/mapping',
    owner.accessToken,
    'PUT',
    { memberId: member.member.id },
  );
  assert(mapPlex.status === 200 && mapEmby.status === 200, '两个媒体账号已显式关联家庭成员');

  await db.query(
    `INSERT INTO media_library_items
       ("householdId", provider, "connectorKey", "libraryItemId", "mediaType",
        title, "playbackUrl", metadata, "lastSeenAt")
     VALUES
       ($1, 'plex', 'plex', 'plex-movie-242', 'movie', 'Plex 回调影片',
        'http://plex.example/web/index.html#!/server/test/details?key=/library/metadata/242', '{}', now()),
       ($1, 'emby', 'emby', 'emby-movie-86', 'movie', 'Emby 回调影片',
        'http://emby.example/web/index.html#!/item?id=86', '{}', now())`,
    [householdId],
  );

  const forbidden = await request(
    '/media/connector-settings/plex/playback-webhook',
    member.accessToken,
    'POST',
    { sourceIp: '127.0.0.1' },
  );
  assert(forbidden.status === 403, '普通成员不能生成播放回调地址');

  const wrongSourceCallback = await request(
    '/media/connector-settings/plex/playback-webhook',
    owner.accessToken,
    'POST',
    { sourceIp: '192.0.2.20' },
  );
  const wrongSource = await plexWebhook(wrongSourceCallback.body.data.callbackPath, {
    event: 'media.play',
    Account: { id: 'plex-user-mom', title: '妈妈 Plex' },
    Server: { uuid: 'playback-plex-server' },
    Player: { uuid: 'plex-player', title: '浏览器' },
    Metadata: {
      type: 'movie',
      ratingKey: 'plex-movie-242',
      title: 'Plex 回调影片',
      duration: 6_000_000,
      viewOffset: 0,
    },
  });
  assert(wrongSource.status === 403, '拒绝非允许来源 IP 的播放回调');

  const plexCallback = await request(
    '/media/connector-settings/plex/playback-webhook',
    owner.accessToken,
    'POST',
    { sourceIp: '127.0.0.1' },
  );
  const embyCallback = await request(
    '/media/connector-settings/emby/playback-webhook',
    owner.accessToken,
    'POST',
    { sourceIp: '127.0.0.1' },
  );
  const plexPath = plexCallback.body.data.callbackPath;
  const embyPath = embyCallback.body.data.callbackPath;
  const plexSecret = plexPath.split('/').at(-1);
  const plexIntegrationId = plexPath.split('/').at(-2);
  const stored = await db.query(
    `SELECT "webhookSecretHash", settings FROM integrations WHERE id = $1`,
    [plexIntegrationId],
  );
  assert(
    plexCallback.status === 201 &&
      embyCallback.status === 201 &&
      stored.rows[0].webhookSecretHash.length === 64 &&
      stored.rows[0].webhookSecretHash !== plexSecret &&
      stored.rows[0].settings.playbackServerId === 'playback-plex-server',
    '播放回调密钥只显示一次并绑定当前服务器',
  );

  const wrongSecret = await plexWebhook(
    plexPath.replace(plexSecret, 'invalid-playback-secret'),
    { event: 'media.play' },
  );
  assert(wrongSecret.status === 404, '错误的播放回调密钥会被拒绝');
  // C2：AnyFilesInterceptor 在比对密钥之前就解析 multipart（公开端点）。错密钥带缩略图 → 404；
  // 超文件数、超大数组下标字段名在解析阶段 400（只发一个下标字段，不跟 payload[x]，见 GHSA-535w）；
  // 之后服务照常，正确密钥带缩略图照常收（library.new 早返回，不写库，不影响后面的计数）。
  const badPath = plexPath.replace(plexSecret, 'invalid-playback-secret');
  const thumb = new Blob([Buffer.alloc(4 * 1024, 0xff)], { type: 'image/jpeg' });
  const wrongSecretWithThumb = await multipartWebhook(
    badPath,
    [['payload', JSON.stringify({ event: 'media.play' })], ['thumb', thumb, 'thumb.jpg']],
    'playback-c2-multipart-0001',
  );
  const tooManyFiles = await multipartWebhook(
    badPath,
    [['payload', '{}'], ['thumb', thumb, 'a.jpg'], ['poster', thumb, 'b.jpg']],
    'playback-c2-multipart-0002',
  );
  const hugeArrayIndex = await multipartWebhook(badPath, [['payload[4294967294]', 'x']], 'playback-c2-multipart-0003');
  const healthAfterJunk = await fetch(`${BASE}/health/ready`);
  const ignoredWithThumb = await multipartWebhook(
    plexPath,
    [['payload', JSON.stringify({ event: 'library.new' })], ['thumb', thumb, 'thumb.jpg']],
    'playback-c2-multipart-0004',
  );
  await new Promise((done) => setTimeout(done, 100)); // runner 异步 append 日志
  const unhandled = process.env.API_LOG_FILE
    ? readFileSync(process.env.API_LOG_FILE, 'utf8')
        .split('\n')
        .filter((line) => line.includes('"event":"unhandled_exception"') && line.includes('"requestId":"playback-c2-multipart-'))
        .length
    : 0;
  assert(
    wrongSecretWithThumb.status === 404 &&
      wrongSecretWithThumb.body.error.message === '播放回调不存在' &&
      tooManyFiles.status === 400 &&
      hugeArrayIndex.status === 400 &&
      healthAfterJunk.status === 200 &&
      ignoredWithThumb.status === 200 &&
      ignoredWithThumb.body.data.ignored === true &&
      unhandled === 0,
    '错误密钥的 multipart（带缩略图）404；超文件数、超大数组下标字段名解析阶段 400；服务仍就绪，正确密钥带缩略图照常收',
  );

  const oversized = await plexWebhook(plexPath, {
    event: 'media.play',
    Account: { id: 'plex-user-mom' },
    Server: { uuid: 'playback-plex-server' },
    Player: { uuid: 'plex-player' },
    Metadata: {
      type: 'movie',
      ratingKey: 'plex-movie-242',
      title: 'Plex 回调影片',
      summary: 'x'.repeat(70 * 1024),
    },
  });
  assert(oversized.status === 413, '播放回调 JSON 限制为 64 KiB');

  const now = Date.now();
  const plexPayload = (event, timestamp, viewOffset, overrides = {}) => ({
    event,
    timestamp: new Date(timestamp).toISOString(),
    Account: { id: 'plex-user-mom', title: '妈妈 Plex' },
    Server: { uuid: 'playback-plex-server', title: '家庭 Plex' },
    Player: { uuid: 'plex-player', title: '客厅浏览器' },
    Metadata: {
      type: 'movie',
      ratingKey: 'plex-movie-242',
      title: 'Plex 回调影片',
      duration: 6_000_000,
      viewOffset,
    },
    ...overrides,
  });
  const stopped = await plexWebhook(
    plexPath,
    plexPayload('media.stop', now - 10_000, 2_400_000),
  );
  const startedLate = await plexWebhook(
    plexPath,
    plexPayload('media.play', now - 20_000, 0),
  );
  const progressLate = await plexWebhook(
    plexPath,
    plexPayload('media.resume', now - 15_000, 2_100_000),
  );
  const duplicate = await plexWebhook(
    plexPath,
    plexPayload('media.stop', now - 10_000, 2_400_000),
  );
  assert(
    stopped.body.data.matched === true &&
      startedLate.body.data.viewingSessionId === stopped.body.data.viewingSessionId &&
      progressLate.body.data.viewingSessionId === stopped.body.data.viewingSessionId &&
      duplicate.body.data.duplicate === true,
    '重复和乱序的 Plex 事件合并为同一观看会话',
  );

  const unmapped = await plexWebhook(
    plexPath,
    plexPayload('media.play', now - 8_000, 0, {
      Account: { id: 'plex-user-guest', title: '访客 Plex' },
      Player: { uuid: 'guest-player', title: '访客设备' },
    }),
  );
  const oldServer = await plexWebhook(
    plexPath,
    plexPayload('media.play', now - 7_000, 0, {
      Server: { uuid: 'playback-plex-old-server' },
      Player: { uuid: 'old-player' },
    }),
  );
  assert(
    unmapped.body.data.ignored === true && oldServer.body.data.ignored === true,
    '未映射用户与旧服务器事件只进入审计',
  );

  const completed = await plexWebhook(
    plexPath,
    plexPayload('media.scrobble', now - 1_000, 5_900_000),
  );
  const embyStarted = await request(embyPath, null, 'POST', {
    Event: 'playback.start',
    Timestamp: new Date(now).toISOString(),
    Server: { Id: 'playback-emby-server' },
    User: { Id: 'emby-user-mom', Name: '妈妈 Emby' },
    Session: {
      Id: 'emby-session-1',
      DeviceId: 'emby-tv',
      DeviceName: '客厅电视',
      PlayState: { PositionTicks: 1_200_000_000 },
    },
    Item: {
      Id: 'emby-movie-86',
      Type: 'Movie',
      Name: 'Emby 回调影片',
      RunTimeTicks: 54_000_000_000,
    },
  });
  assert(
    completed.body.data.matched === true && embyStarted.body.data.matched === true,
    'Plex 完成事件和 Emby JSON 开始事件均已处理',
  );

  const sessions = await request('/media/viewing-sessions', member.accessToken);
  const progress = await request('/media/viewing-progress', member.accessToken);
  const plexSession = sessions.body.data.find((item) => item.provider === 'plex');
  const embySession = sessions.body.data.find((item) => item.provider === 'emby');
  const plexProgress = progress.body.data.find((item) => item.provider === 'plex');
  assert(
    sessions.status === 200 &&
      sessions.body.data.length === 2 &&
      plexSession.status === 'completed' &&
      plexSession.positionMs === 5_900_000 &&
      plexSession.participants[0].member.id === member.member.id &&
      embySession.deviceName === '客厅电视',
    '观看记录按成员展示 Plex 与 Emby 会话',
  );
  assert(
    progress.status === 200 &&
      plexProgress.completed === true &&
      plexProgress.member.id === member.member.id &&
      plexProgress.percentage > 98,
    '成员观看进度由最新有效事件更新',
  );

  const audit = await db.query(
    `SELECT status, payload, error FROM integration_events
     WHERE "integrationId" = $1 ORDER BY "receivedAt"`,
    [plexIntegrationId],
  );
  const ignoredAudit = audit.rows.filter((row) => row.status === 'ignored');
  assert(
    ignoredAudit.length === 2 &&
      ignoredAudit.every(
        (row) =>
          !JSON.stringify(row.payload).includes('plex-user-guest') &&
          !JSON.stringify(row.payload).includes('访客 Plex') &&
          typeof row.payload.actorRef === 'string',
      ),
    '未映射账号只留下不可逆引用，不保存账号名称或外部 ID',
  );
} finally {
  await db.end();
  await new Promise((resolve) => fakeMediaServer.close(resolve));
}
