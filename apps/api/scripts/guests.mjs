const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const VISIT_DATE = '2200-02-02';

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
    password: 'family1234',
  });
  if (response.status !== 201) throw new Error(`${loginName} 登录失败`);
  return response.body.data.token;
}

const adminToken = await login('爸爸');
const memberToken = await login('妈妈');

const memberRead = await request('/guests', memberToken);
assert(memberRead.status === 403, '普通成员不能读取访客目录');

const guestCreated = await request('/guests', adminToken, 'POST', {
  name: '访客验收小林',
  avatarEmoji: '🪴',
  note: '不吃香菜',
});
assert(guestCreated.status === 201, '管理员可以创建独立访客档案');
const guest = guestCreated.body.data;

const invalidVisit = await request('/visits', adminToken, 'POST', {
  title: '无效来访',
  startsAt: `${VISIT_DATE}T19:00:00.000Z`,
  endsAt: `${VISIT_DATE}T18:00:00.000Z`,
  guestIds: [guest.id],
});
assert(invalidVisit.status === 400, '来访计划拒绝倒置时间范围');

const created = await request('/visits', adminToken, 'POST', {
  title: '访客验收晚餐',
  startsAt: `${VISIT_DATE}T18:30:00.000Z`,
  endsAt: `${VISIT_DATE}T21:00:00.000Z`,
  note: '请在门铃处确认',
  guestIds: [guest.id],
});
assert(
  created.status === 201 && created.body.data.guests[0]?.guest.id === guest.id,
  '管理员可以安排多访客模型中的单次来访',
);
const visit = created.body.data;

const calendar = await request(`/calendar?start=${VISIT_DATE}&end=${VISIT_DATE}`, adminToken);
assert(
  calendar.status === 200 && calendar.body.data.some((entry) => entry.module === 'guest' && entry.sourceId === visit.id),
  '统一日历聚合已安排的来访计划',
);

const invitationCreated = await request(`/visits/${visit.id}/invitations`, adminToken, 'POST', {
  guestId: guest.id,
  expiresInHours: 24,
});
const invitation = invitationCreated.body.data;
assert(
  invitationCreated.status === 201 && typeof invitation.invitationToken === 'string' && !('tokenHash' in invitation),
  '邀请仅在创建时返回明文令牌，响应不含摘要',
);

const preview = await request(`/guest-invitations/${invitation.invitationToken}`, null);
assert(
  preview.status === 200 &&
    preview.body.data.guest.name === guest.name &&
    preview.body.data.visit.title === visit.title &&
    !('hostMember' in preview.body.data) &&
    !('householdId' in preview.body.data) &&
    !('tokenHash' in preview.body.data),
  '公开邀请页只返回该访客的来访信息，不返回家庭成员或令牌摘要',
);

const response = await request(
  `/guest-invitations/${invitation.invitationToken}/response`,
  null,
  'POST',
  { attending: true },
);
assert(
  response.status === 201 && response.body.data.response.attending === true,
  '访客无需登录即可确认参加',
);

const listed = await request('/visits?status=scheduled', adminToken);
assert(
  listed.status === 200 &&
    listed.body.data.find((entry) => entry.id === visit.id)?.guests[0]?.isAttending === true,
  '家庭侧只在自己的来访计划中看到访客确认结果',
);

const revoked = await request(`/guest-invitations/${invitation.id}`, adminToken, 'DELETE');
const expiredPreview = await request(`/guest-invitations/${invitation.invitationToken}`, null);
assert(
  revoked.status === 200 && revoked.body.data.revoked === true && expiredPreview.status === 404,
  '撤销邀请后公开链接立即失效',
);

const cancelled = await request(`/visits/${visit.id}`, adminToken, 'PATCH', { status: 'cancelled' });
assert(cancelled.status === 200 && cancelled.body.data.status === 'cancelled', '管理员可以结束或取消来访计划');

console.log('\n访客与来访测试全部通过');
