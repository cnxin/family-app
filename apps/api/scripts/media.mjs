import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
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
const createdPollIds = [];
const suffix = Date.now().toString(36);
const tmdbId = `m4-tmdb-${suffix}`;
const imdbId = `tt-m4-${suffix}`;
const db = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});
let activePermissionRequestId = null;

await db.connect();

try {
  const connectors = await request('/media/connectors', mom.token);
  assert(
    connectors.status === 200 &&
      connectors.data.length === 3 &&
      connectors.data.every(
        (connector) =>
          connector.state === 'not_configured' &&
          !Object.hasOwn(connector, 'credential') &&
          !Object.hasOwn(connector, 'baseUrl'),
      ),
    '未配置连接器时返回明确状态且不暴露地址或凭据',
  );

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

  const availability = await request(
    '/media/library-availability',
    dad.token,
    'POST',
    { mediaIds: [created.data.id] },
  );
  assert(
    availability.status === 201 &&
      Array.isArray(availability.data[created.data.id]) &&
      availability.data[created.data.id].length === 0,
    '媒体连接器未配置或离线时不阻断片单并返回空媒体库匹配',
  );

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

  console.log('4. 片单关联家庭投票');
  const linkedPoll = await request('/polls', mom.token, 'POST', {
    title: `要一起看家庭剧集测试 ${suffix} 吗？`,
    category: 'movie',
    voteMode: 'single',
    options: [{ label: '想看' }, { label: '这次先不看' }],
    sourceModule: 'media',
    sourceId: second.data.id,
  });
  assert(
    linkedPoll.status === 201 &&
      linkedPoll.data.category === 'movie' &&
      linkedPoll.data.sourceModule === 'media' &&
      linkedPoll.data.sourceId === second.data.id,
    '可以从家庭片单发起带真实来源关联的观影投票',
  );
  createdPollIds.push(linkedPoll.data.id);

  const votingEntry = await request(
    `/media?status=voting&search=${encodeURIComponent(suffix)}`,
    dad.token,
  );
  const duplicatePoll = await request('/polls', dad.token, 'POST', {
    title: '不应重复创建的观影投票',
    options: [{ label: '想看' }, { label: '不看' }],
    sourceModule: 'media',
    sourceId: second.data.id,
  });
  const changeDuringPoll = await request(
    `/media/${second.data.id}`,
    dad.token,
    'PATCH',
    { status: 'dropped' },
  );
  const removeDuringPoll = await request(
    `/media/${second.data.id}`,
    dad.token,
    'DELETE',
  );
  assert(
    votingEntry.data.some(
      (entry) => entry.id === second.data.id && entry.status === 'voting',
    ) &&
      duplicatePoll.status === 409 &&
      changeDuringPoll.status === 409 &&
      removeDuringPoll.status === 409,
    '发起投票后同步投票中状态，并阻止重复投票和绕过投票修改片单',
  );

  const closedPoll = await request(
    `/polls/${linkedPoll.data.id}/close`,
    dad.token,
    'POST',
  );
  const afterClose = await request(
    `/media?status=watchlist&search=${encodeURIComponent(suffix)}`,
    mom.token,
  );
  const reopenedPoll = await request(
    `/polls/${linkedPoll.data.id}/reopen`,
    dad.token,
    'POST',
  );
  const afterReopen = await request(
    `/media?status=voting&search=${encodeURIComponent(suffix)}`,
    mom.token,
  );
  const closedAgain = await request(
    `/polls/${linkedPoll.data.id}/close`,
    dad.token,
    'POST',
  );
  const successorPoll = await request('/polls', dad.token, 'POST', {
    title: `第二轮家庭剧集投票 ${suffix}`,
    options: [{ label: '想看' }, { label: '稍后再看' }],
    sourceModule: 'media',
    sourceId: second.data.id,
  });
  createdPollIds.push(successorPoll.data.id);
  const reopenOldPoll = await request(
    `/polls/${linkedPoll.data.id}/reopen`,
    mom.token,
    'POST',
  );
  const archivedOldPoll = await request(
    `/polls/${linkedPoll.data.id}`,
    mom.token,
    'DELETE',
  );
  createdPollIds.splice(createdPollIds.indexOf(linkedPoll.data.id), 1);
  const afterOldArchive = await request(
    `/media?status=voting&search=${encodeURIComponent(suffix)}`,
    dad.token,
  );
  const archivedSuccessor = await request(
    `/polls/${successorPoll.data.id}`,
    dad.token,
    'DELETE',
  );
  createdPollIds.splice(createdPollIds.indexOf(successorPoll.data.id), 1);
  const afterFinalArchive = await request(
    `/media?status=watchlist&search=${encodeURIComponent(suffix)}`,
    dad.token,
  );
  assert(
    closedPoll.data.status === 'closed' &&
      afterClose.data.some((entry) => entry.id === second.data.id) &&
      reopenedPoll.data.status === 'open' &&
      afterReopen.data.some((entry) => entry.id === second.data.id) &&
      closedAgain.data.status === 'closed' &&
      successorPoll.data.status === 'open' &&
      reopenOldPoll.status === 409 &&
      archivedOldPoll.data.archived === true &&
      afterOldArchive.data.some((entry) => entry.id === second.data.id) &&
      archivedSuccessor.data.archived === true &&
      afterFinalArchive.data.some((entry) => entry.id === second.data.id),
    '顺序投票会阻止旧投票重开，归档旧记录不覆盖当前观影状态',
  );

  const concurrentPayload = {
    title: `并发观影投票 ${suffix}`,
    options: [{ label: '想看' }, { label: '不看' }],
    sourceModule: 'media',
    sourceId: readded.data.id,
  };
  const concurrentPolls = await Promise.all([
    request('/polls', mom.token, 'POST', concurrentPayload),
    request('/polls', dad.token, 'POST', concurrentPayload),
  ]);
  const concurrentWinner = concurrentPolls.find(
    (response) => response.status === 201,
  );
  assert(
    concurrentWinner &&
      concurrentPolls.filter((response) => response.status === 201).length === 1 &&
      concurrentPolls.filter((response) => response.status === 409).length === 1,
    '同一片单并发发起投票时只创建一条，其余请求返回明确冲突',
  );
  createdPollIds.push(concurrentWinner.data.id);
  await request(`/polls/${concurrentWinner.data.id}`, dad.token, 'DELETE');
  createdPollIds.splice(createdPollIds.indexOf(concurrentWinner.data.id), 1);

  const pollActivity = await request('/activities?limit=100', mom.token);
  assert(
    pollActivity.data.some(
      (activity) =>
        activity.module === 'media' &&
        activity.action === 'media_poll_started' &&
        activity.metadata.pollId === linkedPoll.data.id,
    ),
    '观影投票操作写入家庭活动记录',
  );

  console.log('5. MoviePilot 请求持久化与家庭权限');
  const requestable = await request('/media', mom.token, 'POST', {
    type: 'movie',
    title: `订阅持久化测试 ${suffix}`,
    year: 2097,
    externalRefs: [
      { provider: 'tmdb', externalId: String(Date.now()) },
    ],
  });
  assert(requestable.status === 201, '可以建立带数字 TMDB ID 的待订阅影片');
  createdIds.push(requestable.data.id);

  const unavailableRequest = await request(
    `/media/${requestable.data.id}/requests`,
    mom.token,
    'POST',
    { connectorKey: 'moviepilot' },
  );
  const persistedRequests = await request('/media/requests', dad.token);
  const failedRequest = persistedRequests.data.find(
    (item) => item.householdMediaId === requestable.data.id,
  );
  assert(
    unavailableRequest.status === 502 &&
      failedRequest?.status === 'failed' &&
      failedRequest.requestedBy.id === mom.member.id,
    'MoviePilot 未配置时保留失败请求、请求人和错误状态',
  );

  const requestActivities = await request('/activities?limit=100', dad.token);
  assert(
    requestActivities.data.some(
      (activity) =>
        activity.action === 'media_request_submitted' &&
        activity.metadata.mediaRequestId === failedRequest.id,
    ) &&
      requestActivities.data.some(
        (activity) =>
          activity.action === 'media_request_failed' &&
          activity.metadata.mediaRequestId === failedRequest.id,
      ),
    '订阅提交和连接失败分别写入家庭活动',
  );

  activePermissionRequestId = randomUUID();
  await db.query(
    `INSERT INTO media_requests
       (id, "householdId", "householdMediaId", "connectorKey", season, status,
        "externalRequestId", "requestedById")
     VALUES ($1, $2, $3, 'moviepilot', 0, 'pending', $4, $5)`,
    [
      activePermissionRequestId,
      requestable.data.householdId,
      requestable.data.id,
      `permission-${suffix}`,
      dad.member.id,
    ],
  );
  const memberView = await request('/media/requests', mom.token);
  const ownerRequest = memberView.data.find(
    (item) => item.id === activePermissionRequestId,
  );
  const memberCancel = await request(
    `/media/requests/${activePermissionRequestId}`,
    mom.token,
    'DELETE',
  );
  const removeWithActiveRequest = await request(
    `/media/${requestable.data.id}`,
    dad.token,
    'DELETE',
  );
  assert(
    ownerRequest?.canCancel === false &&
      memberCancel.status === 403 &&
      removeWithActiveRequest.status === 409,
    '普通成员不能取消他人请求，进行中订阅会阻止影片移出片单',
  );
  await db.query('DELETE FROM media_requests WHERE id = $1', [
    activePermissionRequestId,
  ]);
  activePermissionRequestId = null;

  console.log('\n家庭观影测试全部通过');
} finally {
  if (activePermissionRequestId) {
    await db.query('DELETE FROM media_requests WHERE id = $1', [
      activePermissionRequestId,
    ]);
  }
  for (const id of createdPollIds) {
    await request(`/polls/${id}`, dad.token, 'DELETE');
  }
  for (const id of createdIds) {
    await request(`/media/${id}`, dad.token, 'DELETE');
  }
  await db.end();
}
