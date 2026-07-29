const BASE = process.env.API_URL || 'http://127.0.0.1:3100';

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
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, data: json?.data, error: json?.error };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', {
    loginName,
    password: 'family1234',
  });
  assert(response.status === 201, `${loginName}登录成功`);
  return response.data;
}

console.log('1. 独立家庭片单与排期校验');
const mom = await login('妈妈');
const dad = await login('爸爸');
const createdIds = [];
const suffix = Date.now().toString(36);
const tmdbId = `m4-tmdb-${suffix}`;
const imdbId = `tt-m4-${suffix}`;

try {
  const missingSchedule = await request('/media', mom.token, 'POST', {
    type: 'movie',
    title: `缺少日期的排期 ${suffix}`,
    status: 'scheduled',
  });
  assert(missingSchedule.status === 400, '已排期状态必须同时提供观影日期');

  const created = await request('/media', mom.token, 'POST', {
    type: 'movie',
    title: `家庭电影测试 ${suffix}`,
    originalTitle: `Family Movie ${suffix}`,
    year: 2099,
    overview: '不依赖任何媒体连接器的家庭片单测试',
    posterUrl: 'https://image.tmdb.org/t/p/w500/test.jpg',
    status: 'scheduled',
    scheduledFor: '2199-12-29',
    note: '周末一起看',
    externalRefs: [{ provider: 'tmdb', externalId: tmdbId }],
  });
  assert(
    created.status === 201 &&
      created.data.status === 'scheduled' &&
      created.data.scheduledFor === '2199-12-29' &&
      created.data.mediaTitle.externalRefs[0].externalId === tmdbId,
    '没有配置 Plex、Emby 或 MoviePilot 时仍可建立带元数据的家庭片单',
  );
  createdIds.push(created.data.id);
  const originalMediaTitleId = created.data.mediaTitle.id;

  const list = await request(
    `/media?status=scheduled&search=${encodeURIComponent(suffix)}`,
    dad.token,
  );
  assert(
    list.status === 200 &&
      list.data.length === 1 &&
      list.data[0].id === created.data.id,
    '家庭成员可以按状态和名称搜索共同片单',
  );

  const calendar = await request(
    '/calendar?start=2199-12-29&end=2199-12-29',
    dad.token,
  );
  assert(
    calendar.status === 200 &&
      calendar.data.some(
        (entry) =>
          entry.module === 'media' && entry.sourceId === created.data.id,
      ),
    '观影排期进入统一家庭日历',
  );

  const activities = await request('/activities?limit=100', dad.token);
  assert(
    activities.status === 200 &&
      activities.data.some(
        (activity) =>
          activity.module === 'media' &&
          activity.action === 'media_added' &&
          activity.metadata.mediaId === created.data.id,
      ) &&
      activities.data.some(
        (activity) =>
          activity.module === 'media' &&
          activity.action === 'media_scheduled' &&
          activity.metadata.mediaId === created.data.id,
      ),
    '加入片单和安排日期写入家庭活动',
  );

  console.log('2. 状态机与日期一致性');
  const invalidTransition = await request(
    `/media/${created.data.id}`,
    dad.token,
    'PATCH',
    { status: 'voting' },
  );
  const clearRequiredSchedule = await request(
    `/media/${created.data.id}`,
    dad.token,
    'PATCH',
    { scheduledFor: null },
  );
  assert(
    invalidTransition.status === 409 && clearRequiredSchedule.status === 400,
    '拒绝非法状态跳转和缺少日期的已排期记录',
  );

  const watching = await request(
    `/media/${created.data.id}`,
    dad.token,
    'PATCH',
    { status: 'watching' },
  );
  const completed = await request(
    `/media/${created.data.id}`,
    dad.token,
    'PATCH',
    { status: 'completed', note: '全家已看完' },
  );
  assert(
    watching.status === 200 &&
      watching.data.scheduledFor === '2199-12-29' &&
      completed.status === 200 &&
      completed.data.status === 'completed' &&
      completed.data.note === '全家已看完',
    '合法状态流转会保留原观影日期和家庭备注',
  );

  console.log('3. 外部编号去重与冲突保护');
  const second = await request('/media', dad.token, 'POST', {
    type: 'series',
    title: `家庭剧集测试 ${suffix}`,
    year: 2098,
    externalRefs: [{ provider: 'imdb', externalId: imdbId }],
  });
  assert(second.status === 201, '同一家庭可以加入另一部影视');
  createdIds.push(second.data.id);

  const conflictingRefs = await request('/media', mom.token, 'POST', {
    type: 'movie',
    title: `冲突编号测试 ${suffix}`,
    externalRefs: [
      { provider: 'tmdb', externalId: tmdbId },
      { provider: 'imdb', externalId: imdbId },
    ],
  });
  assert(conflictingRefs.status === 409, '拒绝把指向不同条目的外部编号错误合并');

  const duplicate = await request('/media', dad.token, 'POST', {
    type: 'movie',
    title: `不同名称但相同编号 ${suffix}`,
    year: 2001,
    externalRefs: [{ provider: 'tmdb', externalId: tmdbId }],
  });
  assert(duplicate.status === 409, '相同 TMDB 编号不会在家庭片单中重复创建');

  const removed = await request(
    `/media/${created.data.id}`,
    mom.token,
    'DELETE',
  );
  assert(removed.status === 200 && removed.data.removed, '家庭片单条目可以移除');
  createdIds.splice(createdIds.indexOf(created.data.id), 1);

  const readded = await request('/media', dad.token, 'POST', {
    type: 'movie',
    title: `重新加入时的显示名称 ${suffix}`,
    year: 2001,
    externalRefs: [{ provider: 'tmdb', externalId: tmdbId }],
  });
  assert(
    readded.status === 201 &&
      readded.data.mediaTitle.id === originalMediaTitleId &&
      readded.data.mediaTitle.title === created.data.mediaTitle.title,
    '移除后重新加入会复用外部编号对应的影视元数据',
  );
  createdIds.push(readded.data.id);

  const removedActivity = await request('/activities?limit=100', mom.token);
  assert(
    removedActivity.data.some(
      (activity) =>
        activity.module === 'media' &&
        activity.action === 'media_removed' &&
        activity.metadata.mediaId === created.data.id,
    ),
    '移除片单保留不可变家庭活动记录',
  );

  console.log('\n家庭观影测试全部通过');
} finally {
  for (const id of createdIds) {
    await request(`/media/${id}`, dad.token, 'DELETE');
  }
}
