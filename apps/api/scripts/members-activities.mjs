const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';

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
    password: PASSWORD,
  });
  assert(response.status === 201, `${loginName}可以登录`);
  return response.body.data;
}

const owner = await login('爸爸');
let member = await login('妈妈');

const managed = await request('/household/members', owner.accessToken);
const dad = managed.body.data.find((item) => item.name === '爸爸');
const mom = managed.body.data.find((item) => item.name === '妈妈');
assert(
  managed.status === 200 &&
    managed.body.data.length === 2 &&
    dad.account.loginName === '爸爸' &&
    mom.account.loginName === '妈妈' &&
    mom.disabledAt === null,
  '管理员可以读取本家庭成员档案、登录账号和家庭状态',
);

const forbiddenList = await request(
  '/household/members',
  member.accessToken,
);
const selfDisable = await request(
  `/household/members/${dad.id}/status`,
  owner.accessToken,
  'PATCH',
  { enabled: false },
);
const selfRole = await request(
  `/household/members/${dad.id}`,
  owner.accessToken,
  'PATCH',
  { role: 'member' },
);
assert(
  forbiddenList.status === 403 &&
    selfDisable.status === 403 &&
    selfRole.status === 403,
  '普通成员不能进入管理接口且管理员不能停用或改掉自己的角色',
);

const updated = await request(
  `/household/members/${mom.id}`,
  owner.accessToken,
  'PATCH',
  {
    name: '妈妈（测试）',
    avatarEmoji: 'M',
    role: 'admin',
    prefersCooking: true,
  },
);
const oldMemberSession = await request('/activities', member.accessToken);
assert(
  updated.status === 200 &&
    updated.body.data.name === '妈妈（测试）' &&
    updated.body.data.role === 'admin' &&
    updated.body.data.prefersCooking === true &&
    oldMemberSession.status === 401,
  '成员档案和角色可统一修改，角色变化会立即撤销旧会话',
);

member = await login('妈妈');
const adminCannotManageOwner = await request(
  `/household/members/${dad.id}`,
  member.accessToken,
  'PATCH',
  { name: '不应修改' },
);
assert(
  member.member.name === '妈妈（测试）' &&
    adminCannotManageOwner.status === 403,
  '登录账号与成员显示名称保持独立且协管成员不能管理家庭管理员',
);

const demoted = await request(
  `/household/members/${mom.id}`,
  owner.accessToken,
  'PATCH',
  { role: 'member' },
);
const disabled = await request(
  `/household/members/${mom.id}/status`,
  owner.accessToken,
  'PATCH',
  { enabled: false },
);
const disabledLogin = await request('/auth/login', null, 'POST', {
  loginName: '妈妈',
  password: PASSWORD,
});
const enabled = await request(
  `/household/members/${mom.id}/status`,
  owner.accessToken,
  'PATCH',
  { enabled: true },
);
assert(
  demoted.status === 200 &&
    disabled.status === 200 &&
    disabled.body.data.disabledAt &&
    disabledLogin.status === 401 &&
    enabled.status === 200 &&
    enabled.body.data.disabledAt === null,
  '家庭身份可停用和恢复，停用期间不能登录该家庭',
);

member = await login('妈妈');
const invitation = await request(
  '/household/invitations',
  owner.accessToken,
  'POST',
  { memberName: '活动测试邀请', role: 'member' },
);
const revoked = await request(
  `/household/invitations/${invitation.body.data.id}`,
  owner.accessToken,
  'DELETE',
);
assert(
  invitation.status === 201 && revoked.status === 200,
  '邀请创建和撤销操作成功',
);

const activities = await request('/activities?scope=members&limit=100', member.accessToken);
const actions = activities.body.data.map((item) => item.action);
const invalidScope = await request('/activities?scope=unknown', member.accessToken);
const invalidLimit = await request('/activities?limit=101', member.accessToken);
assert(
  activities.status === 200 &&
    actions.includes('member_profile_updated') &&
    actions.includes('member_disabled') &&
    actions.includes('member_enabled') &&
    actions.includes('invitation_created') &&
    actions.includes('invitation_revoked') &&
    activities.body.data.every((item) =>
      ['member', 'invitation'].includes(item.module),
    ) &&
    invalidScope.status === 400 &&
    invalidLimit.status === 400,
  '活动记录按家庭范围返回不可变成员审计并校验查询范围',
);

console.log('\n成员管理与家庭活动测试全部通过');
