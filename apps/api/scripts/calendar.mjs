const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const TEST_DATE = process.env.SMOKE_DATE || '2199-12-28';

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
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', {
    loginName,
    password: 'family1234',
  });
  if (response.status !== 201) {
    throw new Error(`${loginName} 登录失败: ${JSON.stringify(response.body)}`);
  }
  return response.body.data.token;
}

const momToken = await login('妈妈');
const dadToken = await login('爸爸');
const createdIds = [];

try {
  const invalidDate = await request(
    '/calendar?start=2199-12-29&end=2199-12-28',
    momToken,
  );
  const oversizedRange = await request(
    '/calendar?start=2199-01-01&end=2200-12-31',
    momToken,
  );
  assert(
    invalidDate.status === 400 && oversizedRange.status === 400,
    '统一日历拒绝倒置日期和过大的查询范围',
  );

  const invalidTime = await request('/calendar-events', momToken, 'POST', {
    date: TEST_DATE,
    title: '无效时间事件',
    startsAt: `${TEST_DATE}T12:00:00.000Z`,
    endsAt: `${TEST_DATE}T11:00:00.000Z`,
  });
  assert(invalidTime.status === 400, '家庭事件校验结束时间必须晚于开始时间');

  const createdByMom = await request('/calendar-events', momToken, 'POST', {
    date: TEST_DATE,
    title: '周末家庭聚餐',
    note: '提前准备甜品',
    startsAt: `${TEST_DATE}T10:00:00.000Z`,
    endsAt: `${TEST_DATE}T13:00:00.000Z`,
  });
  assert(createdByMom.status === 201, '普通家庭成员可以创建日历事件');
  const momEventId = createdByMom.body.data.id;
  createdIds.push(momEventId);

  const asset = await request('/assets', momToken, 'POST', {
    name: '日历回归净化器',
    category: 'appliance',
  });
  assert(asset.status === 201, '日历回归可以创建测试资产');
  const maintenancePlan = await request(
    `/assets/${asset.body.data.id}/maintenance-plans`,
    momToken,
    'POST',
    {
      title: '清洁滤网',
      frequencyDays: 30,
      nextDueDate: TEST_DATE,
      note: '统一日历维护测试',
    },
  );
  assert(maintenancePlan.status === 201, '日历回归可以创建维护计划');

  const calendar = await request(
    `/calendar?start=${TEST_DATE}&end=${TEST_DATE}`,
    momToken,
  );
  const entries = calendar.body.data;
  const manualEntry = entries.find((entry) => entry.sourceId === momEventId);
  const menuEntry = entries.find(
    (entry) =>
      entry.module === 'menu' && entry.metadata?.mealType === 'dinner',
  );
  const maintenanceEntry = entries.find(
    (entry) =>
      entry.module === 'maintenance' &&
      entry.sourceId === maintenancePlan.body.data.id,
  );
  assert(
    calendar.status === 200 &&
      manualEntry?.module === 'calendar' &&
      manualEntry.metadata?.canManage === true &&
      menuEntry?.metadata?.itemCount >= 1 &&
      maintenanceEntry?.metadata?.assetId === asset.body.data.id &&
      maintenanceEntry.targetPath.includes(
        `/home-assets?assetId=${asset.body.data.id}`,
      ),
    '统一日历同时聚合家庭事件、菜单餐次和资产维护计划',
  );

  await request(
    `/maintenance-plans/${maintenancePlan.body.data.id}`,
    momToken,
    'PATCH',
    { isEnabled: false },
  );
  const afterDisable = await request(
    `/calendar?start=${TEST_DATE}&end=${TEST_DATE}`,
    momToken,
  );
  assert(
    !afterDisable.body.data.some(
      (entry) => entry.sourceId === maintenancePlan.body.data.id,
    ),
    '停用维护计划后会立即退出统一日历',
  );

  const adminUpdate = await request(
    `/calendar-events/${momEventId}`,
    dadToken,
    'PATCH',
    { note: '管理员已确认场地' },
  );
  assert(
    adminUpdate.status === 200 &&
      adminUpdate.body.data.note === '管理员已确认场地',
    '家庭管理员可以维护其他成员创建的事件',
  );

  const createdByDad = await request('/calendar-events', dadToken, 'POST', {
    date: TEST_DATE,
    title: '管理员事件',
  });
  const dadEventId = createdByDad.body.data.id;
  createdIds.push(dadEventId);
  const memberUpdate = await request(
    `/calendar-events/${dadEventId}`,
    momToken,
    'PATCH',
    { title: '不应修改' },
  );
  const memberDelete = await request(
    `/calendar-events/${dadEventId}`,
    momToken,
    'DELETE',
  );
  assert(
    memberUpdate.status === 403 && memberDelete.status === 403,
    '普通成员不能修改或删除其他成员创建的事件',
  );

  const removed = await request(
    `/calendar-events/${momEventId}`,
    dadToken,
    'DELETE',
  );
  createdIds.splice(createdIds.indexOf(momEventId), 1);
  assert(
    removed.status === 200 && removed.body.data.removed === true,
    '创建者或管理员可以删除误加的家庭事件',
  );

  console.log('\n统一日历测试全部通过');
} finally {
  for (const id of createdIds) {
    await request(`/calendar-events/${id}`, dadToken, 'DELETE');
  }
}
