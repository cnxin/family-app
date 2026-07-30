import { createServer } from 'node:http';

const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const CREDENTIAL = 'media-library-contract-secret';

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
  assert(response.status === 201, `${loginName}可以登录媒体库`);
  return response.body.data;
}

const plex = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (req.headers['x-plex-token'] !== CREDENTIAL) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{}');
    return;
  }
  let body;
  if (url.pathname === '/identity') {
    body = {
      MediaContainer: {
        machineIdentifier: 'library-contract-server',
        version: '1.43.0',
      },
    };
  } else if (url.pathname === '/library/sections') {
    body = {
      MediaContainer: {
        Directory: [{ key: '1', type: 'movie', title: '测试电影' }],
      },
    };
  } else if (url.pathname === '/library/sections/1/all') {
    body = {
      MediaContainer: {
        totalSize: 1,
        Metadata: [
          {
            ratingKey: 'library-contract-242',
            type: 'movie',
            title: '媒体库 API 回归样例',
            originalTitle: 'Media Library API Fixture',
            year: 2099,
            summary: 'Plex 媒体库本地快照与片单导入测试。',
            Guid: [
              { id: 'tmdb://990055' },
              { id: 'imdb://tt9900550' },
            ],
          },
        ],
      },
    };
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
});

await new Promise((resolve, reject) => {
  plex.once('error', reject);
  plex.listen(0, '127.0.0.1', resolve);
});

let createdMediaId = null;
try {
  const address = plex.address();
  if (!address || typeof address === 'string') throw new Error('测试 Plex 监听失败');
  const owner = await login('爸爸');
  const member = await login('妈妈');
  const configured = await request(
    '/media/connector-settings/plex',
    owner.accessToken,
    'PUT',
    {
      name: '媒体库测试 Plex',
      isEnabled: true,
      baseUrl: `http://127.0.0.1:${address.port}`,
      credential: CREDENTIAL,
      isPrimary: true,
    },
  );
  assert(configured.status === 200, '管理员可以配置媒体库测试连接');

  const forbidden = await request(
    '/media/library/sync',
    member.accessToken,
    'POST',
    {},
  );
  assert(forbidden.status === 403, '普通成员不能触发媒体库全量同步');

  const synced = await request(
    '/media/library/sync',
    owner.accessToken,
    'POST',
    { connectorKey: 'plex' },
  );
  assert(
    synced.status === 201 &&
      synced.body.data.results.length === 1 &&
      synced.body.data.results[0].itemCount === 1,
    '管理员可以将 Plex 媒体库同步为本地快照',
  );

  const library = await request('/media/library', member.accessToken);
  const item = library.body.data.items[0];
  assert(
    library.status === 200 &&
      library.body.data.total === 1 &&
      item.title === '媒体库 API 回归样例' &&
      item.externalRefs.some((ref) => ref.provider === 'tmdb') &&
      !item.playbackUrl.includes(CREDENTIAL),
    '家庭成员可以浏览脱敏后的 Plex 快照和播放入口',
  );

  const added = await request(
    `/media/library/${item.id}/add`,
    member.accessToken,
    'POST',
  );
  createdMediaId = added.body?.data?.householdMediaId ?? null;
  assert(
    added.status === 201 && added.body.data.added === true && createdMediaId,
    '家庭成员可以从媒体库加入家庭片单',
  );

  const refreshed = await request('/media/library', member.accessToken);
  assert(
    refreshed.body.data.items[0].householdMediaId === createdMediaId,
    '媒体库会标记已经进入家庭片单的影视',
  );

  const availability = await request(
    '/media/library-availability',
    member.accessToken,
    'POST',
    { mediaIds: [createdMediaId] },
  );
  assert(
    availability.status === 201 &&
      availability.body.data[createdMediaId][0].provider === 'plex',
    '片单条目可以使用同步快照生成 Plex 播放入口',
  );

  console.log('\n家庭媒体库同步测试全部通过');
} finally {
  if (createdMediaId) {
    const owner = await login('爸爸');
    await request(`/media/${createdMediaId}`, owner.accessToken, 'DELETE');
    await request('/media/connector-settings/plex', owner.accessToken, 'DELETE');
  }
  await new Promise((resolve, reject) =>
    plex.close((error) => (error ? reject(error) : resolve())),
  );
}
