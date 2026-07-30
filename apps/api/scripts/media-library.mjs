import { createServer } from 'node:http';

const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const CREDENTIAL = 'media-library-contract-secret';
let plexOffline = false;
let plexServerId = 'library-contract-server';

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
  if (plexOffline) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end('{}');
    return;
  }
  if (url.pathname === '/library/metadata/library-contract-242/thumb/poster-tag') {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    res.end('media-library-poster');
    return;
  }
  let body;
  if (url.pathname === '/identity') {
    body = {
      MediaContainer: {
        machineIdentifier: plexServerId,
        version: '1.43.0',
      },
    };
  } else if (url.pathname === '/library/sections') {
    body = {
      MediaContainer: {
        Directory: [{ key: '1', type: 'movie', title: '测试电影' }],
      },
    };
  } else if (url.pathname === '/accounts') {
    body = {
      MediaContainer: {
        Account: [
          { id: 'plex-user-dad', name: '爸爸 Plex' },
          { id: 'plex-user-mom', name: '妈妈 Plex' },
        ],
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
            thumb: '/library/metadata/library-contract-242/thumb/poster-tag',
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

  const forbiddenUsers = await request(
    '/media/playback-users',
    member.accessToken,
  );
  assert(forbiddenUsers.status === 403, '普通成员不能读取媒体用户映射');

  const playbackUsers = await request(
    '/media/playback-users',
    owner.accessToken,
  );
  const plexDirectory = playbackUsers.body.data.find(
    (directory) => directory.provider === 'plex',
  );
  assert(
    playbackUsers.status === 200 &&
      plexDirectory.state === 'online' &&
      plexDirectory.serverId === 'library-contract-server' &&
      plexDirectory.users.length === 2 &&
      !JSON.stringify(playbackUsers.body).includes(CREDENTIAL),
    '管理员可以读取不含凭据的 Plex 用户目录',
  );

  const mapped = await request(
    '/media/playback-users/plex/plex-user-mom/mapping',
    owner.accessToken,
    'PUT',
    { memberId: member.member.id },
  );
  const mappingId = mapped.body?.data?.id;
  assert(
    mapped.status === 200 &&
      mappingId &&
      mapped.body.data.member.id === member.member.id,
    '管理员可以把 Plex 用户显式关联到家庭成员',
  );

  const duplicateMember = await request(
    '/media/playback-users/plex/plex-user-dad/mapping',
    owner.accessToken,
    'PUT',
    { memberId: member.member.id },
  );
  assert(
    duplicateMember.status === 409,
    '同一服务器上的家庭成员不能关联多个外部用户',
  );

  const refreshedUsers = await request(
    '/media/playback-users',
    owner.accessToken,
  );
  const mappedUser = refreshedUsers.body.data
    .find((directory) => directory.provider === 'plex')
    .users.find((user) => user.externalUserId === 'plex-user-mom');
  assert(
    mappedUser.mapping?.id === mappingId &&
      mappedUser.mapping.member.name === member.member.name,
    '用户目录返回当前家庭成员映射',
  );

  plexOffline = true;
  const offlineUsers = await request(
    '/media/playback-users',
    owner.accessToken,
  );
  const unavailableMapping = offlineUsers.body.data
    .find((directory) => directory.provider === 'plex')
    .users.find((user) => user.mapping?.id === mappingId);
  assert(
    offlineUsers.body.data.find((directory) => directory.provider === 'plex').state ===
      'offline' &&
      unavailableMapping?.isStale === false,
    '服务离线时保留映射且不误报为失效',
  );
  plexOffline = false;

  plexServerId = 'library-contract-server-2';
  const changedServer = await request(
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
  assert(changedServer.status === 200, '测试连接可以切换到新的 Plex 服务器身份');
  const changedServerUsers = await request(
    '/media/playback-users',
    owner.accessToken,
  );
  const changedPlexDirectory = changedServerUsers.body.data.find(
    (directory) => directory.provider === 'plex',
  );
  const staleMapping = changedPlexDirectory.users.find(
    (user) => user.mapping?.id === mappingId,
  );
  const currentServerUser = changedPlexDirectory.users.find(
    (user) =>
      user.serverId === 'library-contract-server-2' &&
      user.externalUserId === 'plex-user-mom',
  );
  assert(
    changedPlexDirectory.serverId === 'library-contract-server-2' &&
      staleMapping?.isStale === true &&
      currentServerUser?.mapping === null,
    '服务器身份变化后旧映射失效且不会应用到同名新账号',
  );

  const forbiddenUnmap = await request(
    `/media/playback-user-mappings/${mappingId}`,
    member.accessToken,
    'DELETE',
  );
  assert(forbiddenUnmap.status === 403, '普通成员不能取消媒体用户映射');

  const unmapped = await request(
    `/media/playback-user-mappings/${mappingId}`,
    owner.accessToken,
    'DELETE',
  );
  assert(unmapped.status === 200 && unmapped.body.data.deleted, '管理员可以取消媒体用户映射');

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
      item.posterUrl.startsWith(`/media/library/${item.id}/poster?`) &&
      !item.posterUrl.includes(CREDENTIAL) &&
      !item.playbackUrl.includes(CREDENTIAL),
    '家庭成员可以浏览脱敏后的 Plex 快照和播放入口',
  );

  const poster = await fetch(`${BASE}${item.posterUrl}`);
  assert(
    poster.status === 200 &&
      poster.headers.get('content-type') === 'image/jpeg' &&
      (await poster.text()) === 'media-library-poster',
    '签名海报地址可由 API 安全代理 Plex 图片',
  );
  const invalidPosterUrl = new URL(item.posterUrl, BASE);
  invalidPosterUrl.searchParams.set('signature', 'A'.repeat(43));
  const invalidPoster = await fetch(invalidPosterUrl);
  assert(invalidPoster.status === 403, '篡改后的海报地址会被拒绝');

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
