// M5-E 外部访问可信代理入口验证（需在 TRUST_PROXY_HOPS=2 下运行）：
// 1. 双栈 Tailscale IP（100.64.0.0/10、fd7a:115c:a1e0::/48）+ X-Family-Ingress: tailscale + Tailscale-User-Login 才认定经由外部通道；
// 2. LAN IP 或缺少 X-Family-Ingress 一律视为非 Tailscale 通道；
// 3. 普通成员（role=member）调用 /external-access/session 仅获知 viaTailscale=true，不返回 login/name；
// 4. 经外部通道登录后写入 external_access_login 活动记录：管理员可见 tailscaleLogin 与 targetPath，普通成员读取 /activities 自动脱敏。
const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function request(path, token, method = 'GET', body, headers = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
}

async function login(loginName, headers = {}) {
  const response = await request('/auth/login', null, 'POST', { loginName, password: PASSWORD }, headers);
  if (response.status !== 201) throw new Error(`${loginName} 登录失败 ${response.status}: ${response.text}`);
  return response.body.data;
}

const tailscaleV4Headers = {
  'X-Family-Ingress': 'tailscale',
  // Express TRUST_PROXY_HOPS=2：倒数第 2 跳是 Tailscale 客户端 IP，最后一跳是 Caddy 内网代理
  'X-Forwarded-For': '100.64.12.34, 172.18.0.5',
  'Tailscale-User-Login': 'dad@example.com',
  'Tailscale-User-Name': 'Dad Tailscale',
};

const tailscaleV6Headers = {
  'X-Family-Ingress': 'tailscale',
  'X-Forwarded-For': 'fd7a:115c:a1e0::1234, 172.18.0.5',
  'Tailscale-User-Login': 'dad-v6@example.com',
  'Tailscale-User-Name': 'Dad V6',
};

const lanHeaders = {
  'X-Family-Ingress': 'tailscale',
  'X-Forwarded-For': '192.168.1.88, 172.18.0.5',
  'Tailscale-User-Login': 'lan-spoof@example.com',
};

const missingIngressHeaders = {
  'X-Forwarded-For': '100.64.12.34, 172.18.0.5',
  'Tailscale-User-Login': 'missing-marker@example.com',
};

const spoofedLeftXffHeaders = {
  'X-Family-Ingress': 'tailscale',
  // 3 段 XFF：TRUST_PROXY_HOPS=2 时 Express 取倒数第 2 跳（192.168.1.88），左侧伪造的 100.64.12.34 必须被忽略
  'X-Forwarded-For': '100.64.12.34, 192.168.1.88, 172.18.0.5',
  'Tailscale-User-Login': 'left-spoof@example.com',
};

const memberTailscaleHeaders = {
  'X-Family-Ingress': 'tailscale',
  'X-Forwarded-For': '100.64.88.12, 172.18.0.5',
  'Tailscale-User-Login': 'mom-tailscale@example.com',
  'Tailscale-User-Name': 'Mom Tailscale',
};

console.log('1. TRUST_PROXY_HOPS=2 下的外部通道登录、未认证拦截与身份头验证');
const anonSession = await request('/external-access/session', null, 'GET', undefined, tailscaleV4Headers);
assert(anonSession.status === 401, '未登录访问 /external-access/session 返回 401');

const ownerSession = await login('爸爸', tailscaleV4Headers);
const memberSession = await login('妈妈', memberTailscaleHeaders);
const owner = ownerSession.accessToken;
const member = memberSession.accessToken;

const ownerV4 = await request('/external-access/session', owner, 'GET', undefined, tailscaleV4Headers);
assert(
  ownerV4.status === 200 &&
    ownerV4.body.data.viaTailscale === true &&
    ownerV4.body.data.login === 'dad@example.com' &&
    ownerV4.body.data.name === 'Dad Tailscale',
  '管理员经 IPv4 CGNAT + X-Family-Ingress 读取到完整 Tailscale 会话信息',
);

const ownerV6 = await request('/external-access/session', owner, 'GET', undefined, tailscaleV6Headers);
assert(
  ownerV6.status === 200 &&
    ownerV6.body.data.viaTailscale === true &&
    ownerV6.body.data.login === 'dad-v6@example.com',
  '管理员经 IPv6 ULA (fd7a:115c:a1e0::/48) 同样识别为外部通道',
);

const memberV4 = await request('/external-access/session', member, 'GET', undefined, tailscaleV4Headers);
assert(
  memberV4.status === 200 &&
    memberV4.body.data.viaTailscale === true &&
    memberV4.body.data.login === null &&
    memberV4.body.data.name === null,
  '普通成员仅获知 viaTailscale=true，绝不回显 Tailscale login/name',
);

const lanRejected = await request('/external-access/session', owner, 'GET', undefined, lanHeaders);
const missingMarkerRejected = await request('/external-access/session', owner, 'GET', undefined, missingIngressHeaders);
const leftSpoofRejected = await request('/external-access/session', owner, 'GET', undefined, spoofedLeftXffHeaders);
assert(
  lanRejected.status === 200 &&
    lanRejected.body.data.viaTailscale === false &&
    missingMarkerRejected.status === 200 &&
    missingMarkerRejected.body.data.viaTailscale === false &&
    leftSpoofRejected.status === 200 &&
    leftSpoofRejected.body.data.viaTailscale === false,
  'LAN 源 IP、缺少 X-Family-Ingress 标记或左侧 XFF 伪造均不认定为外部通道',
);

console.log('2. 外部通道登录审计日志与普通成员脱敏（含本人记录脱敏）');
const ownerActivities = await request('/activities?scope=all&limit=20', owner);
const memberActivities = await request('/activities?scope=all&limit=20', member);
const ownerLoginLogs = ownerActivities.body.data.filter((row) => row.action === 'external_access_login');
const memberLoginLogs = memberActivities.body.data.filter((row) => row.action === 'external_access_login');
const ownerExpectedSummary = `${ownerSession.member.name} 通过外部通道登录`;
const memberExpectedSummary = `${memberSession.member.name} 通过外部通道登录`;
const ownerOwnLog = ownerLoginLogs.find(
  (row) => row.subjectMemberId === ownerSession.member.id && row.summary === ownerExpectedSummary,
);
const ownerSeesMemberLog = ownerLoginLogs.find(
  (row) => row.subjectMemberId === memberSession.member.id && row.summary === memberExpectedSummary,
);
const memberSeesOwnLog = memberLoginLogs.find(
  (row) => row.subjectMemberId === memberSession.member.id && row.summary === memberExpectedSummary,
);
const memberSeesOwnerLog = memberLoginLogs.find(
  (row) => row.subjectMemberId === ownerSession.member.id && row.summary === ownerExpectedSummary,
);
assert(
  ownerOwnLog &&
    ownerOwnLog.targetPath === '/house/external-access' &&
    ownerOwnLog.metadata?.tailscaleLogin === 'dad@example.com' &&
    ownerSeesMemberLog &&
    ownerSeesMemberLog.targetPath === '/house/external-access' &&
    ownerSeesMemberLog.metadata?.tailscaleLogin === 'mom-tailscale@example.com',
  '管理员在家庭活动里看到本人和普通成员的外部通道登录记录与 Tailscale 账号',
);
assert(
  memberSeesOwnerLog &&
    memberSeesOwnerLog.targetPath === null &&
    !('tailscaleLogin' in (memberSeesOwnerLog.metadata ?? {})) &&
    !('tailscaleName' in (memberSeesOwnerLog.metadata ?? {})) &&
    memberSeesOwnLog &&
    memberSeesOwnLog.targetPath === null &&
    !('tailscaleLogin' in (memberSeesOwnLog.metadata ?? {})) &&
    !('tailscaleName' in (memberSeesOwnLog.metadata ?? {})),
  '普通成员在家庭活动里对他人与本人登录记录都看不到 tailscaleLogin/tailscaleName 与管理跳转路径',
);
console.log('外部访问（M5-E）TRUST_PROXY_HOPS=2 入口与审计验证全部通过');
