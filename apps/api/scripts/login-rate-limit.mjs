const BASE = process.env.API_URL || 'http://127.0.0.1:3100';

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

const membersResponse = await fetch(`${BASE}/members`);
const members = (await membersResponse.json()).data;
const member = members.find((item) => !item.hasPin);
assert(member, '存在无需 PIN 的限流测试成员');

const statuses = [];
for (let attempt = 0; attempt < 4; attempt += 1) {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memberId: member.id }),
  });
  statuses.push(response.status);
}

assert(statuses.slice(0, 3).every((status) => status === 201), '限额内登录请求成功');
assert(statuses[3] === 429, '超过配置次数后登录接口返回 429');
console.log('\n登录速率限制测试通过');
