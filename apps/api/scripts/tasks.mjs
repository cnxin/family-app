const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const START_DATE = '2199-12-20';
const END_DATE = '2199-12-22';

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

console.log('1. 家庭任务、周期实例和权限');
const mom = await login('妈妈');
const dad = await login('爸爸');
const createdTaskIds = [];

try {
  const invalidRange = await request(
    `/tasks?start=${END_DATE}&end=${START_DATE}`,
    mom.token,
  );
  assert(invalidRange.status === 400, '任务列表拒绝倒置日期范围');

  // 以下三条守的是请求校验管道（tasks 已从 class-validator DTO 换成契约 schema）。
  // 日期原先由 @IsISO8601 + 服务里的 parseDateOnly 两道把关，现在契约 dateOnly 直接拦在最前面，
  // 状态码仍是 400。
  const badDate = await request(
    `/tasks?start=2026-13-40&end=${END_DATE}`,
    mom.token,
  );
  assert(badDate.status === 400, '任务列表拒绝非法日期');

  const badRecurrence = await request('/tasks', mom.token, 'POST', {
    title: '未知周期测试',
    startsOn: START_DATE,
    recurrence: '每小时',
  });
  assert(badRecurrence.status === 400, '未知周期类型被请求校验拒绝');

  const badInterval = await request('/tasks', mom.token, 'POST', {
    title: '间隔越界测试',
    startsOn: START_DATE,
    recurrence: 'daily',
    repeatInterval: 0,
  });
  assert(badInterval.status === 400, '重复间隔小于 1 被请求校验拒绝');

  const repeating = await request('/tasks', mom.token, 'POST', {
    title: '测试每日整理厨房',
    note: '完成后擦干台面',
    startsOn: START_DATE,
    recurrence: 'daily',
    repeatInterval: 1,
    endsOn: END_DATE,
    defaultAssigneeId: dad.member.id,
  });
  assert(
    repeating.status === 201 &&
      repeating.data.defaultAssigneeId === dad.member.id,
    '普通成员可创建周期任务并指派家庭成员',
  );
  createdTaskIds.push(repeating.data.id);

  const occurrences = await request(
    `/tasks?start=${START_DATE}&end=${END_DATE}`,
    mom.token,
  );
  const repeatingOccurrences = occurrences.data.filter(
    (item) => item.taskId === repeating.data.id,
  );
  assert(
    occurrences.status === 200 &&
      repeatingOccurrences.length === 3 &&
      repeatingOccurrences.every(
        (item) =>
          item.status === 'pending' && item.assigneeId === dad.member.id,
      ),
    '周期规则按查询范围生成三个待办实例且不预写无限数据',
  );

  const calendar = await request(
    `/calendar?start=${START_DATE}&end=${END_DATE}`,
    mom.token,
  );
  assert(
    calendar.status === 200 &&
      calendar.data.filter(
        (entry) =>
          entry.module === 'task' && entry.sourceId === repeating.data.id,
      ).length === 3,
    '统一日历按来源聚合周期任务实例',
  );

  console.log('2. 通用通知、完成、恢复和改派');
  const dadNotifications = await request('/notifications', dad.token);
  const assignedNotification = dadNotifications.data.find(
    (item) =>
      item.module === 'task' &&
      item.type === 'task_assigned' &&
      item.sourceId === repeating.data.id,
  );
  assert(assignedNotification, '被指派成员收到统一任务通知');

  const read = await request(
    `/notifications/${assignedNotification.id}/read`,
    dad.token,
    'PATCH',
  );
  const unreadAfterRead = await request('/notifications', dad.token);
  assert(
    read.status === 200 &&
      !unreadAfterRead.data.some((item) => item.id === assignedNotification.id),
    '通知可以标记已读且不再出现在未读列表',
  );

  const completed = await request(
    `/tasks/${repeating.data.id}/instances/${START_DATE}`,
    dad.token,
    'PATCH',
    { status: 'done' },
  );
  assert(
    completed.status === 200 &&
      completed.data.status === 'done' &&
      completed.data.resolvedById === dad.member.id,
    '负责人可以完成分配给自己的任务',
  );

  const momNotifications = await request('/notifications', mom.token);
  assert(
    momNotifications.data.some(
      (item) =>
        item.module === 'task' &&
        item.type === 'task_completed' &&
        item.sourceId === repeating.data.id,
    ),
    '任务创建者收到统一完成通知',
  );

  const restored = await request(
    `/tasks/${repeating.data.id}/instances/${START_DATE}`,
    dad.token,
    'PATCH',
    { status: 'pending' },
  );
  assert(
    restored.status === 200 && restored.data.status === 'pending',
    '误完成的任务可以恢复为待办',
  );

  const reassigned = await request(
    `/tasks/${repeating.data.id}/instances/2199-12-21`,
    mom.token,
    'PATCH',
    { assigneeId: mom.member.id, status: 'skipped' },
  );
  assert(
    reassigned.status === 200 &&
      reassigned.data.assigneeId === mom.member.id &&
      reassigned.data.status === 'skipped',
    '任务创建者可以改派单次实例并标记跳过',
  );

  console.log('3. 创建者与家庭管理员边界');
  const ownerTask = await request('/tasks', dad.token, 'POST', {
    title: '管理员创建的测试任务',
    startsOn: START_DATE,
    recurrence: 'once',
    defaultAssigneeId: dad.member.id,
  });
  assert(ownerTask.status === 201, '家庭管理员可以创建一次性任务');
  createdTaskIds.push(ownerTask.data.id);

  const forbiddenEdit = await request(
    `/tasks/${ownerTask.data.id}`,
    mom.token,
    'PATCH',
    { title: '不应修改' },
  );
  const forbiddenComplete = await request(
    `/tasks/${ownerTask.data.id}/instances/${START_DATE}`,
    mom.token,
    'PATCH',
    { status: 'done' },
  );
  assert(
    forbiddenEdit.status === 403 && forbiddenComplete.status === 403,
    '普通成员不能编辑或完成分配给其他成员的任务',
  );

  const adminEdit = await request(
    `/tasks/${repeating.data.id}`,
    dad.token,
    'PATCH',
    { note: '管理员确认新的完成标准' },
  );
  assert(
    adminEdit.status === 200 &&
      adminEdit.data.note === '管理员确认新的完成标准',
    '家庭管理员可以维护其他成员创建的任务',
  );

  const archived = await request(
    `/tasks/${repeating.data.id}`,
    mom.token,
    'DELETE',
  );
  const afterArchive = await request(
    `/tasks?start=${START_DATE}&end=${END_DATE}`,
    mom.token,
  );
  assert(
    archived.status === 200 &&
      archived.data.archived === true &&
      !afterArchive.data.some((item) => item.taskId === repeating.data.id),
    '停用周期任务后不再生成任务或日历安排',
  );

  console.log('\n家庭任务与通用通知测试全部通过');
} finally {
  for (const taskId of createdTaskIds) {
    await request(`/tasks/${taskId}`, dad.token, 'DELETE');
  }
}
