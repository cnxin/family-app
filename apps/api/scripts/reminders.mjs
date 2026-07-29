const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const TEST_DATE = '2199-12-23';

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
    password: 'family1234',
  });
  assert(response.status === 201, `${loginName}登录成功`);
  return response.data;
}

async function waitForReminderStatus(token, reminderId, status) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await request('/reminders?status=all', token);
    const reminder = response.data.find((item) => item.id === reminderId);
    if (reminder?.status === status) return reminder;
    await wait(100);
  }
  throw new Error(`等待提醒状态 ${status} 超时`);
}

console.log('1. 四类来源与提醒规则');
const dad = await login('爸爸');
const mom = await login('妈妈');
const members = await request('/members', dad.token);
const dadMember = members.data.find((member) => member.name === '爸爸');
const momMember = members.data.find((member) => member.name === '妈妈');
const created = { eventId: null, taskId: null, pollId: null, reminderIds: [] };

try {
  const event = await request('/calendar-events', mom.token, 'POST', {
    date: TEST_DATE,
    startsAt: `${TEST_DATE}T10:00:00.000Z`,
    title: '提醒集成测试家庭活动',
    note: '验证到期通知只投递一次',
  });
  assert(event.status === 201, '创建提醒关联的家庭事件');
  created.eventId = event.data.id;

  const task = await request('/tasks', mom.token, 'POST', {
    title: '提醒集成测试任务',
    startsOn: TEST_DATE,
    recurrence: 'once',
    defaultAssigneeId: dadMember.id,
  });
  assert(task.status === 201, '创建提醒关联的任务');
  created.taskId = task.data.id;

  const poll = await request('/polls', mom.token, 'POST', {
    title: '提醒集成测试投票',
    closesAt: '2199-12-23T12:00:00.000Z',
    options: [{ label: '方案甲' }, { label: '方案乙' }],
  });
  assert(poll.status === 201, '创建提醒关联的投票');
  created.pollId = poll.data.id;

  const menus = await request(
    `/menus?date=${TEST_DATE}&mealType=dinner`,
    dad.token,
  );
  const dishes = await request('/dishes', dad.token);
  const menu = await request(
    `/menus/${menus.data.id}/items`,
    dad.token,
    'POST',
    { items: [{ dishId: dishes.data[0].id }] },
  );
  assert(menu.status === 201, '创建提醒关联的菜单');

  const sources = await request(
    `/reminder-sources?start=${TEST_DATE}&end=${TEST_DATE}`,
    dad.token,
  );
  assert(
    sources.status === 200 &&
      ['calendar', 'task', 'poll', 'menu'].every((module) =>
        sources.data.some((source) => source.module === module),
      ),
    '提醒来源统一返回菜单、任务、事件和投票',
  );

  const missingOccurrence = await request('/reminders', mom.token, 'POST', {
    sourceModule: 'task',
    sourceId: task.data.id,
    remindAt: '2199-12-22T12:00:00.000Z',
    recipientIds: [momMember.id],
  });
  assert(missingOccurrence.status === 400, '周期任务提醒必须指定发生日期');

  for (const sourceModule of ['menu', 'task', 'poll']) {
    const source = sources.data.find((item) => item.module === sourceModule);
    const response = await request('/reminders', mom.token, 'POST', {
      sourceModule,
      sourceId: source.sourceId,
      ...(sourceModule === 'task'
        ? { occurrenceDate: source.occurrenceDate }
        : {}),
      remindAt: '2199-12-22T12:00:00.000Z',
      recipientIds: [momMember.id],
    });
    assert(response.status === 201, `${sourceModule}来源可以设置提醒`);
    created.reminderIds.push(response.data.id);
  }

  console.log('2. 编辑权限、接收人与取消');
  const privateReminder = await request('/reminders', dad.token, 'POST', {
    sourceModule: 'calendar',
    sourceId: event.data.id,
    remindAt: '2199-12-22T10:00:00.000Z',
    recipientIds: [dadMember.id],
  });
  created.reminderIds.push(privateReminder.data.id);
  const forbidden = await request(
    `/reminders/${privateReminder.data.id}`,
    mom.token,
    'PATCH',
    { remindAt: '2199-12-22T11:00:00.000Z' },
  );
  const edited = await request(
    `/reminders/${privateReminder.data.id}`,
    dad.token,
    'PATCH',
    {
      remindAt: '2199-12-22T11:00:00.000Z',
      recipientIds: [dadMember.id, momMember.id],
    },
  );
  assert(
    forbidden.status === 403 &&
      edited.status === 200 &&
      edited.data.recipients.length === 2,
    '只有创建者或管理员可编辑，接收人整组更新',
  );
  const cancelled = await request(
    `/reminders/${privateReminder.data.id}`,
    dad.token,
    'DELETE',
  );
  assert(cancelled.status === 200 && cancelled.data.status === 'cancelled', '待发送提醒可以取消');

  console.log('3. 到期幂等投递与来源失效');
  const initialDadNotifications = await request(
    '/notifications?includeRead=true&module=reminder',
    dad.token,
  );
  const dueReminder = await request('/reminders', mom.token, 'POST', {
    sourceModule: 'calendar',
    sourceId: event.data.id,
    remindAt: new Date(Date.now() + 700).toISOString(),
    recipientIds: [dadMember.id, momMember.id],
  });
  assert(dueReminder.status === 201, '可以为多个家庭成员设置近期提醒');
  created.reminderIds.push(dueReminder.data.id);
  const sent = await waitForReminderStatus(mom.token, dueReminder.data.id, 'sent');
  await wait(500);
  const dadNotifications = await request(
    '/notifications?includeRead=true&module=reminder',
    dad.token,
  );
  const momNotifications = await request(
    '/notifications?includeRead=true&module=reminder',
    mom.token,
  );
  const dadDeliveries = dadNotifications.data.filter(
    (item) => item.sourceId === dueReminder.data.id,
  );
  const momDeliveries = momNotifications.data.filter(
    (item) => item.sourceId === dueReminder.data.id,
  );
  assert(
    sent.recipients.every((recipient) => recipient.deliveredAt) &&
      dadDeliveries.length === 1 &&
      momDeliveries.length === 1 &&
      dadNotifications.data.length === initialDadNotifications.data.length + 1,
    '到期后每个接收人只生成一条站内通知',
  );
  const editSent = await request(
    `/reminders/${dueReminder.data.id}`,
    mom.token,
    'PATCH',
    { remindAt: new Date(Date.now() + 60_000).toISOString() },
  );
  assert(editSent.status === 409, '已发送提醒保持不可变');

  const invalidated = await request('/reminders', mom.token, 'POST', {
    sourceModule: 'task',
    sourceId: task.data.id,
    occurrenceDate: TEST_DATE,
    remindAt: new Date(Date.now() + 900).toISOString(),
    recipientIds: [momMember.id],
  });
  created.reminderIds.push(invalidated.data.id);
  await request(`/tasks/${task.data.id}`, mom.token, 'DELETE');
  const autoCancelled = await waitForReminderStatus(
    mom.token,
    invalidated.data.id,
    'cancelled',
  );
  assert(
    autoCancelled.cancelReason === 'source_unavailable',
    '来源在到期前停用时提醒自动取消且不误发',
  );

  console.log('\n可配置提醒测试全部通过');
} finally {
  if (created.pollId) await request(`/polls/${created.pollId}`, dad.token, 'DELETE');
  if (created.taskId) await request(`/tasks/${created.taskId}`, dad.token, 'DELETE');
  if (created.eventId) {
    await request(`/calendar-events/${created.eventId}`, dad.token, 'DELETE');
  }
}
