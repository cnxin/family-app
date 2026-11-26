// M5-E 外部访问黑盒测试：
// - 设置接口权限、只写不读、凭据加密存库、阶段 1 读写凭据拒存守门、恢复默认
// - OAuth 优先与 API 令牌兼容、连通性与只读探针测试（含草稿测试）
// - 概览/设备列表/单台设备明细、敏感底层字段脱敏、60 秒缓存与强制刷新、控制面故障隔离
// - 通知中心去重推送与今天页「需要留意」（key-expiring + 控制面离线 ≥ 1 小时，仅管理员可见）
// - 跨家庭隔离与 /system/modules hasData
// - /external-access/session 伪造入口头拦截（TRUST_PROXY_HOPS=0）
import pg from 'pg';
import { startFakeTailscale } from './fake-tailscale.mjs';
import { cleanModuleHousehold, createModuleHousehold } from './system-modules-fixtures.mjs';

const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function request(path, token, method = 'GET', body, extraHeaders = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', { loginName, password: PASSWORD });
  if (response.status !== 201) throw new Error(`${loginName} 登录失败 ${response.status}`);
  return response.body.data;
}

async function externalAccessHasData(token) {
  const result = await request('/system/modules', token);
  if (result.status !== 200) throw new Error(`/system/modules 失败 ${result.status}`);
  return result.body.data.modules.find((row) => row.key === 'external-access').hasData;
}

const db = new pg.Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  user: process.env.DB_USER || 'family',
  password: process.env.DB_PASSWORD || 'family123',
  database: process.env.DB_NAME || 'family_app',
});
await db.connect();

let fake = null;
let secondFake = null;
const fixtures = [];
let primaryHouseholdId = null;

try {
  fake = await startFakeTailscale();
  const ownerSession = await login('爸爸');
  const memberSession = await login('妈妈');
  const owner = ownerSession.accessToken;
  const member = memberSession.accessToken;
  const householdId = ownerSession.member.householdId;
  primaryHouseholdId = householdId;

  // 确保干净起始状态
  await db.query(`DELETE FROM integrations WHERE "householdId" = $1 AND kind = 'tailscale'`, [householdId]);
  await db.query(
    `DELETE FROM notifications WHERE "householdId" = $1 AND module = 'system'
       AND (type LIKE 'external_access_key_expiring%' OR type = 'external_access_stale_offline')`,
    [householdId],
  );

  console.log('1. 设置初始态、权限边界、输入校验与阶段 1 只读守门');
  const anonCalls = await Promise.all([
    request('/external-access/session', null),
    request('/external-access/settings', null),
    request('/external-access/overview', null),
    request('/external-access/devices', null),
  ]);
  assert(anonCalls.every((res) => res.status === 401), '未认证请求访问 /external-access/* 全部返回 401');

  const initial = await request('/external-access/settings', owner);
  assert(
    initial.status === 200 &&
      initial.body.data.mode === 'server_default' &&
      initial.body.data.configured === false &&
      initial.body.data.credentialConfigured === false,
    '未配置服务器默认时返回 server_default 且 configured=false',
  );
  assert((await externalAccessHasData(owner)) === false, '未配置时 /system/modules 的 external-access.hasData 为 false');

  const memberForbidden = await Promise.all([
    request('/external-access/settings', member),
    request('/external-access/settings', member, 'PUT', { baseUrl: fake.url }),
    request('/external-access/settings', member, 'DELETE'),
    request('/external-access/settings/test', member, 'POST', {}),
    request('/external-access/overview', member),
    request('/external-access/devices', member),
    request('/external-access/devices/dev-server-1', member),
  ]);
  assert(
    memberForbidden.every((res) => res.status === 403),
    '普通成员被禁止访问外部访问设置、测试、概览与设备接口（全 403）',
  );

  const badInputs = await Promise.all([
    request('/external-access/settings', owner, 'PUT', { baseUrl: 'https://user:pass@api.tailscale.com' }),
    request('/external-access/settings', owner, 'PUT', { baseUrl: 'https://127.0.0.1' }),
    request('/external-access/settings', owner, 'PUT', { baseUrl: 'https://169.254.169.254' }),
    request('/external-access/settings', owner, 'PUT', { baseUrl: 'https://[::ffff:127.0.0.1]' }),
    request('/external-access/settings', owner, 'PUT', { tailnet: '../etc' }),
    request('/external-access/settings', owner, 'PUT', { publicUrl: 'https://xiaoguanjia.family.ts.net/bad-path' }),
    request('/external-access/settings', owner, 'PUT', { credential: 'short' }),
    request('/external-access/settings', owner, 'PUT', {
      credential: fake.credentials.apiToken,
      clearCredential: true,
    }),
  ]);
  assert(badInputs.every((res) => res.status === 400), '非法控制面地址、SSRF 目标、路径化入口地址与短凭据均被 400 拦截');

  const rwOauthRejected = await request('/external-access/settings', owner, 'PUT', {
    baseUrl: fake.url,
    tailnet: '-',
    credentialKind: 'oauth_client',
    oauthClientId: fake.credentials.rwOauthClientId,
    credential: fake.credentials.rwOauthClientSecret,
  });
  const rwTokenRejected = await request('/external-access/settings', owner, 'PUT', {
    baseUrl: fake.url,
    tailnet: '-',
    credentialKind: 'api_token',
    credential: fake.credentials.rwApiToken,
  });
  assert(
    rwOauthRejected.status === 400 && rwTokenRejected.status === 400,
    '阶段 1 拒绝保存具备写权限的 OAuth 客户端与 API 令牌',
  );
  const rowsAfterReject = await db.query(
    `SELECT id FROM integrations WHERE "householdId" = $1 AND kind = 'tailscale'`,
    [householdId],
  );
  assert(rowsAfterReject.rows.length === 0, '被拒绝的读写凭据不会写入数据库');

  console.log('2. 保存只读 OAuth、加密存库、草稿与已保存测试、API 令牌切换与恢复默认');
  const saved = await request('/external-access/settings', owner, 'PUT', {
    baseUrl: fake.url,
    tailnet: '-',
    nodeHostname: 'xiaoguanjia',
    publicUrl: 'https://xiaoguanjia.family.ts.net/',
    credentialKind: 'oauth_client',
    oauthClientId: fake.credentials.oauthClientId,
    credential: fake.credentials.oauthClientSecret,
  });
  assert(
    saved.status === 200 &&
      saved.body.data.mode === 'household' &&
      saved.body.data.configured === true &&
      saved.body.data.credentialKind === 'oauth_client' &&
      saved.body.data.publicUrl === 'https://xiaoguanjia.family.ts.net' &&
      saved.body.data.oauthClientIdHint === 'kTes…t001' &&
      saved.body.data.credentialHint === `****${fake.credentials.oauthClientSecret.slice(-4)}` &&
      saved.body.data.credentialHint.length <= 16 &&
      !saved.text.includes(fake.credentials.oauthClientSecret),
    '保存只读 OAuth 成功：返回脱敏提示且永不回显明文凭据',
  );

  const secretRow = await db.query(
    `SELECT s."credentialEncrypted", s."credentialHint"
       FROM integrations i JOIN integration_secrets s ON s."integrationId" = i.id
      WHERE i."householdId" = $1 AND i.kind = 'tailscale'`,
    [householdId],
  );
  assert(
    secretRow.rows.length === 1 &&
      secretRow.rows[0].credentialHint.length <= 16 &&
      !secretRow.rows[0].credentialEncrypted.includes(fake.credentials.oauthClientSecret),
    '凭据密文加密存库，不落明文',
  );
  assert((await externalAccessHasData(owner)) === true, '配置完成后 external-access.hasData 为 true');

  const testedSaved = await request('/external-access/settings/test', owner, 'POST', {});
  assert(
    testedSaved.status === 200 &&
      testedSaved.body.data.ok === true &&
      testedSaved.body.data.available === true &&
      testedSaved.body.data.readOnlyVerified === true &&
      testedSaved.body.data.permissionLevel === 'read_only' &&
      testedSaved.body.data.deviceCount === 4 &&
      testedSaved.body.data.matchedNodeName === 'xiaoguanjia.family.ts.net',
    '测试已保存的只读 OAuth 凭据通过并匹配小管家节点',
  );

  // 安全防线：更改控制面地址或切换凭据类型时绝不把已存密文发往新地址或按新类型误用
  const testOtherBaseWithoutSecret = await request('/external-access/settings/test', owner, 'POST', {
    baseUrl: 'https://evil.example.com',
  });
  assert(
    testOtherBaseWithoutSecret.status === 400,
    '草稿测试更改控制面地址但未填新凭据时拒绝（防止把已存凭据外泄给第三方地址）',
  );
  const testOtherKindWithoutSecret = await request('/external-access/settings/test', owner, 'POST', {
    credentialKind: 'api_token',
  });
  assert(
    testOtherKindWithoutSecret.status === 200 && testOtherKindWithoutSecret.body.data.ok === false,
    '草稿测试切换凭据类型但未填新凭据时不复用旧类型凭据',
  );
  const saveOtherBaseWithoutSecret = await request('/external-access/settings', owner, 'PUT', {
    baseUrl: 'https://evil.example.com',
  });
  assert(
    saveOtherBaseWithoutSecret.status === 400,
    '保存时更改控制面地址但未填新凭据返回 400',
  );
  const saveOtherKindWithoutSecret = await request('/external-access/settings', owner, 'PUT', {
    credentialKind: 'api_token',
  });
  assert(
    saveOtherKindWithoutSecret.status === 400,
    '保存时切换凭据类型但未填新凭据返回 400',
  );

  const testedDraftRw = await request('/external-access/settings/test', owner, 'POST', {
    baseUrl: fake.url,
    credentialKind: 'oauth_client',
    oauthClientId: fake.credentials.rwOauthClientId,
    credential: fake.credentials.rwOauthClientSecret,
  });
  assert(
    testedDraftRw.status === 200 &&
      testedDraftRw.body.data.ok === false &&
      testedDraftRw.body.data.available === true &&
      testedDraftRw.body.data.readOnlyVerified === false &&
      testedDraftRw.body.data.permissionLevel === 'read_write',
    '草稿测试可识别含写权限的 OAuth 凭据并标记失败',
  );

  const testedDraftToken = await request('/external-access/settings/test', owner, 'POST', {
    baseUrl: fake.url,
    credentialKind: 'api_token',
    credential: fake.credentials.apiToken,
  });
  assert(
    testedDraftToken.status === 200 &&
      testedDraftToken.body.data.ok === true &&
      testedDraftToken.body.data.permissionLevel === 'read_only' &&
      testedDraftToken.body.data.credentialKind === 'api_token',
    '草稿测试兼容只读 API 令牌',
  );

  // 持久化切换为 API 令牌，验证读概览/设备、isEnabled=false、clearCredential=true
  const savedApiToken = await request('/external-access/settings', owner, 'PUT', {
    baseUrl: fake.url,
    tailnet: '-',
    nodeHostname: 'xiaoguanjia',
    publicUrl: 'https://xiaoguanjia.family.ts.net',
    credentialKind: 'api_token',
    credential: fake.credentials.apiToken,
  });
  const overviewViaToken = await request('/external-access/overview?refresh=true', owner);
  assert(
    savedApiToken.status === 200 &&
      savedApiToken.body.data.credentialKind === 'api_token' &&
      !savedApiToken.text.includes(fake.credentials.apiToken) &&
      overviewViaToken.status === 200 &&
      overviewViaToken.body.data.connection.available === true &&
      overviewViaToken.body.data.devices.length === 4,
    '切换保存为 API 令牌后可正常读取概览且不回显明文令牌',
  );

  const disabledRes = await request('/external-access/settings', owner, 'PUT', { isEnabled: false });
  const disabledOverview = await request('/external-access/overview?refresh=true', owner);
  assert(
    disabledRes.status === 200 &&
      disabledRes.body.data.isEnabled === false &&
      disabledOverview.status === 200 &&
      disabledOverview.body.data.connection.configured === false,
    'isEnabled=false 停用后概览返回未配置',
  );

  const clearedCred = await request('/external-access/settings', owner, 'PUT', {
    isEnabled: true,
    clearCredential: true,
  });
  assert(
    clearedCred.status === 200 &&
      clearedCred.body.data.credentialConfigured === false &&
      clearedCred.body.data.configured === false,
    'clearCredential=true 清除已存凭据',
  );

  const reset = await request('/external-access/settings', owner, 'DELETE');
  assert(
    reset.status === 200 &&
      reset.body.data.mode === 'server_default' &&
      reset.body.data.configured === false,
    '恢复默认清除家庭覆盖并回退服务器默认',
  );
  assert((await externalAccessHasData(owner)) === false, '恢复默认后 external-access.hasData 回落为 false');

  // 重新写回只读 OAuth 供后续概览、通知与留意测试
  const restored = await request('/external-access/settings', owner, 'PUT', {
    baseUrl: fake.url,
    tailnet: '-',
    nodeHostname: 'xiaoguanjia',
    publicUrl: 'https://xiaoguanjia.family.ts.net',
    credentialKind: 'oauth_client',
    oauthClientId: fake.credentials.oauthClientId,
    credential: fake.credentials.oauthClientSecret,
  });
  assert(restored.status === 200 && restored.body.data.configured === true, '重新保存只读 OAuth 配置');

  console.log('3. 概览、设备列表、单台明细、敏感字段脱敏与 60 秒缓存');
  const beforeRequests = fake.requests.length;
  const overview = await request('/external-access/overview', owner);
  assert(
    overview.status === 200 &&
      overview.body.data.connection.configured === true &&
      overview.body.data.connection.available === true &&
      overview.body.data.connection.cached === false &&
      overview.body.data.node?.id === 'dev-server-1' &&
      overview.body.data.node?.isServerNode === true &&
      overview.body.data.summary.totalDevices === 4 &&
      overview.body.data.summary.onlineDevices === 2 &&
      overview.body.data.summary.unauthorizedDevices === 1 &&
      overview.body.data.summary.expiringSoonCount === 1 &&
      overview.body.data.summary.staleOfflineCount === 1 &&
      overview.body.data.summary.externalDevices === 1 &&
      overview.body.data.alerts.some((a) => a.kind === 'key_expiring' && a.deviceId === 'dev-dad-phone') &&
      overview.body.data.alerts.some((a) => a.kind === 'stale_offline' && a.deviceId === 'dev-old-ipad'),
    '概览返回完整节点匹配、统计摘要与告警',
  );
  assert(
    !overview.text.includes('must-never-leak') &&
      !overview.text.includes('machineKey') &&
      !overview.text.includes('nodeKey') &&
      !overview.text.includes('tailnetLockKey') &&
      !overview.text.includes('clientConnectivity') &&
      overview.body.data.devices.every((d) => !('addresses' in d) && !('tags' in d)),
    '概览绝不返回敏感底层字段，且摘要剥离明细字段',
  );

  const afterFirstOverview = fake.requests.length;
  assert(afterFirstOverview > beforeRequests, '首次概览访问了控制面');
  const cachedOverview = await request('/external-access/overview', owner);
  assert(
    cachedOverview.status === 200 &&
      cachedOverview.body.data.connection.cached === true &&
      fake.requests.length === afterFirstOverview,
    '60 秒内重复请求命中快照缓存，不再重复拉控制面',
  );
  const refreshedOverview = await request('/external-access/overview?refresh=true', owner);
  assert(
    refreshedOverview.status === 200 &&
      refreshedOverview.body.data.connection.cached === false &&
      fake.requests.length > afterFirstOverview,
    '?refresh=true 绕过缓存强制同步控制面',
  );

  const devicesRes = await request('/external-access/devices', owner);
  assert(
    devicesRes.status === 200 &&
      devicesRes.body.data.devices.length === 4 &&
      !devicesRes.text.includes('must-never-leak'),
    '设备列表返回白名单字段且不泄漏底层密钥',
  );
  const detailRes = await request('/external-access/devices/dev-server-1', owner);
  assert(
    detailRes.status === 200 &&
      detailRes.body.data.id === 'dev-server-1' &&
      Array.isArray(detailRes.body.data.addresses) &&
      detailRes.body.data.addresses.includes('100.64.0.10') &&
      detailRes.body.data.tags.includes('tag:server') &&
      !detailRes.text.includes('must-never-leak') &&
      !detailRes.text.includes('clientConnectivity'),
    '单台设备明细返回地址与 ACL 标签，仍不泄露底层密钥',
  );
  const missingDetail = await request('/external-access/devices/non-existent-device', owner);
  assert(missingDetail.status === 404, '不存在的设备返回 404');

  console.log('4. 通知中心去重与今天页「需要留意」（含控制面离线 ≥ 1 小时与故障隔离）');
  const ownerNotifs = await db.query(
    `SELECT "recipientId", type, module, "targetPath"
       FROM notifications
      WHERE "householdId" = $1 AND module = 'system'
        AND (type LIKE 'external_access_key_expiring%' OR type = 'external_access_stale_offline')`,
    [householdId],
  );
  assert(
    ownerNotifs.rows.some((r) => r.recipientId === ownerSession.member.id && r.type.startsWith('external_access_key_expiring:')) &&
      ownerNotifs.rows.some((r) => r.recipientId === ownerSession.member.id && r.type === 'external_access_stale_offline') &&
      ownerNotifs.rows.every((r) => r.recipientId !== memberSession.member.id && r.targetPath === '/house/external-access'),
    '到期与长期离线告警仅推送给管理员（module=system），普通成员不收到',
  );
  const countBeforeSecondRefresh = ownerNotifs.rows.length;
  await request('/external-access/overview?refresh=true', owner);
  const countAfterSecondRefresh = (
    await db.query(
      `SELECT count(*)::int AS c FROM notifications
        WHERE "householdId" = $1 AND module = 'system'
          AND (type LIKE 'external_access_key_expiring%' OR type = 'external_access_stale_offline')`,
      [householdId],
    )
  ).rows[0].c;
  assert(countAfterSecondRefresh === countBeforeSecondRefresh, '同一天重复刷新不会重复写入通知');

  // 通过 HTTP GET /notifications 校验送达（管理员收到、普通成员未收到）
  const ownerNotifHttp = await request('/notifications?module=system', owner);
  const memberNotifHttp = await request('/notifications?module=system', member);
  assert(
    ownerNotifHttp.status === 200 &&
      Array.isArray(ownerNotifHttp.body.data) &&
      ownerNotifHttp.body.data.some((n) => n.type.startsWith('external_access_key_expiring:')) &&
      memberNotifHttp.status === 200 &&
      Array.isArray(memberNotifHttp.body.data) &&
      !memberNotifHttp.body.data.some((n) => n.type.startsWith('external_access_key_expiring:')),
    'HTTP GET /notifications 仅向管理员投递密钥到期通知',
  );

  // 到期日变化后重新计算并写入新的去重键
  const prevDevices = fake.devices.map((d) => ({ ...d }));
  fake.setDevices(
    prevDevices.map((d) =>
      d.id === 'dev-dad-phone'
        ? { ...d, expires: new Date(Date.now() + 2 * 86_400_000).toISOString() }
        : d,
    ),
  );
  await request('/external-access/overview?refresh=true', owner);
  const countAfterDueDateChange = (
    await db.query(
      `SELECT count(*)::int AS c FROM notifications
        WHERE "householdId" = $1 AND module = 'system'
          AND type LIKE 'external_access_key_expiring%'`,
      [householdId],
    )
  ).rows[0].c;
  assert(countAfterDueDateChange >= 2, '设备密钥到期日变化后重新生成新的提醒记录');
  fake.setDevices(prevDevices);

  const ownerAttention = await request('/today/attention', owner);
  const memberAttention = await request('/today/attention', member);
  const eaCard = ownerAttention.body.data.items.find((item) => item.domain === 'external-access');
  assert(
    ownerAttention.status === 200 &&
      eaCard &&
      eaCard.kind === 'key-expiring' &&
      eaCard.entity?.name === 'dad-iphone' &&
      memberAttention.status === 200 &&
      !memberAttention.body.data.items.some((item) => item.domain === 'external-access'),
    '今天页留意对管理员展示 key-expiring 卡片，对普通成员完全隐藏',
  );

  // 控制面断联：不 500、不影响其他接口；离线不足 1 小时不出 offline 卡，≥ 1 小时后出 offline 卡，恢复后消除
  fake.mode = 'error';
  const downOverview = await request('/external-access/overview?refresh=true', owner);
  const healthDuringOutage = await request('/health/ready', null);
  assert(
    downOverview.status === 200 &&
      downOverview.body.data.connection.configured === true &&
      downOverview.body.data.connection.available === false &&
      healthDuringOutage.status === 200,
    '控制面故障时概览降级返回 200（available=false），不拖垮主服务',
  );
  const halfHourClock = new Date(Date.now() + 30 * 60_000).toISOString();
  const ownerShortDownAtt = await request('/today/attention', owner, 'GET', undefined, { 'x-test-clock': halfHourClock });
  assert(
    !ownerShortDownAtt.body.data.items.some((item) => item.domain === 'external-access' && item.kind === 'offline'),
    '控制面离线不足 1 小时时不展示 offline 留意卡',
  );
  const futureClock = new Date(Date.now() + 65 * 60_000).toISOString();
  const ownerOfflineAtt = await request('/today/attention', owner, 'GET', undefined, { 'x-test-clock': futureClock });
  const memberOfflineAtt = await request('/today/attention', member, 'GET', undefined, { 'x-test-clock': futureClock });
  const offlineCard = ownerOfflineAtt.body.data.items.find((item) => item.domain === 'external-access');
  assert(
    offlineCard &&
      offlineCard.kind === 'offline' &&
      offlineCard.entity?.id === householdId &&
      !memberOfflineAtt.body.data.items.some((item) => item.domain === 'external-access'),
    '控制面不可达超过 1 小时后，今天页仅对管理员展示 offline 留意卡',
  );
  fake.mode = 'ok';
  await request('/external-access/overview?refresh=true', owner);
  const ownerRecoveredAtt = await request('/today/attention', owner, 'GET', undefined, { 'x-test-clock': futureClock });
  assert(
    !ownerRecoveredAtt.body.data.items.some((item) => item.domain === 'external-access' && item.kind === 'offline'),
    '控制面恢复后 offline 留意卡立即清除',
  );

  console.log('5. 入口会话识别：未启用信任代理时伪造头绝不被信任');
  const forgedHeaders = {
    'X-Family-Ingress': 'tailscale',
    'X-Forwarded-For': '100.64.0.42',
    'Tailscale-User-Login': 'spoof@example.com',
    'Tailscale-User-Name': 'Spoofed',
  };
  const ownerSessionRes = await request('/external-access/session', owner, 'GET', undefined, forgedHeaders);
  const memberSessionRes = await request('/external-access/session', member, 'GET', undefined, forgedHeaders);
  assert(
    ownerSessionRes.status === 200 &&
      ownerSessionRes.body.data.viaTailscale === false &&
      ownerSessionRes.body.data.login === null &&
      memberSessionRes.status === 200 &&
      memberSessionRes.body.data.viaTailscale === false &&
      memberSessionRes.body.data.login === null,
    '未配置可信代理时伪造 X-Family-Ingress 与 Tailscale-User-Login 均被忽略',
  );

  console.log('6. 跨家庭隔离与双家庭并发缓存隔离');
  const other = await createModuleHousehold(db);
  fixtures.push(other);
  const otherSettings = await request('/external-access/settings', other.token);
  const otherOverview = await request('/external-access/overview', other.token);
  const otherDevices = await request('/external-access/devices', other.token);
  const otherDeviceDetail = await request('/external-access/devices/dev-server-1', other.token);
  const otherTest = await request('/external-access/settings/test', other.token, 'POST', {});
  const otherDelete = await request('/external-access/settings', other.token, 'DELETE');
  const otherAttention = await request('/today/attention', other.token);
  const otherNotifs = await request('/notifications?module=system', other.token);
  assert(
    otherSettings.status === 200 &&
      otherSettings.body.data.accessScope === 'restricted' &&
      otherSettings.body.data.configured === false &&
      !otherSettings.text.includes('xiaoguanjia.family.ts.net') &&
      otherOverview.status === 200 &&
      otherOverview.body.data.accessScope === 'restricted' &&
      otherOverview.body.data.connection.configured === false &&
      otherOverview.body.data.devices.length === 0 &&
      otherDevices.status === 200 &&
      otherDevices.body.data.devices.length === 0 &&
      otherDeviceDetail.status === 403 &&
      otherTest.status === 200 &&
      otherTest.body.data.ok === false &&
      otherDelete.status === 404 &&
      !otherAttention.body.data.items.some((item) => item.domain === 'external-access') &&
      Array.isArray(otherNotifs.body.data) &&
      !otherNotifs.body.data.some((n) => n.type.startsWith('external_access_')) &&
      (await externalAccessHasData(other.token)) === false,
    '未配置的另一家庭处于 restricted，无法跨户查看设备/明细/留意/通知，也无法测试或删除首户配置',
  );

  secondFake = await startFakeTailscale({
    oauthClientId: 'kOtherHousehold01',
    oauthClientSecret: 'tskey-client-kOtherHousehold01-secret',
    devices: [
      {
        id: 'dev-other-host',
        name: 'other-home.tail.ts.net.',
        hostname: 'other-home',
        user: 'other@example.com',
        os: 'linux',
        clientVersion: '1.80.0',
        updateAvailable: false,
        authorized: true,
        connectedToControl: true,
        isExternal: false,
        lastSeen: new Date().toISOString(),
        expires: '0001-01-01T00:00:00Z',
        keyExpiryDisabled: true,
        addresses: ['100.64.55.1'],
        tags: [],
        blocksIncomingConnections: false,
        created: new Date().toISOString(),
      },
    ],
  });
  const otherSaved = await request('/external-access/settings', other.token, 'PUT', {
    baseUrl: secondFake.url,
    tailnet: '-',
    nodeHostname: 'other-home',
    publicUrl: 'https://other-home.tail.ts.net',
    credentialKind: 'oauth_client',
    oauthClientId: secondFake.credentials.oauthClientId,
    credential: secondFake.credentials.oauthClientSecret,
  });
  const otherOwnOverview = await request('/external-access/overview?refresh=true', other.token);
  const primaryStillIsolated = await request('/external-access/overview', owner);
  assert(
    otherSaved.status === 200 &&
      otherOwnOverview.status === 200 &&
      otherOwnOverview.body.data.devices.length === 1 &&
      otherOwnOverview.body.data.devices[0].id === 'dev-other-host' &&
      primaryStillIsolated.status === 200 &&
      primaryStillIsolated.body.data.devices.length === 4 &&
      !primaryStillIsolated.text.includes('dev-other-host'),
    '双家庭并发配置独立控制面时，快照与 OAuth 令牌缓存互不串扰',
  );

  console.log('外部访问（M5-E）API 黑盒测试全部通过');
} finally {
  if (primaryHouseholdId) {
    await db.query(`DELETE FROM integrations WHERE "householdId" = $1 AND kind = 'tailscale'`, [primaryHouseholdId]);
    await db.query(
      `DELETE FROM notifications WHERE "householdId" = $1 AND module = 'system'
         AND (type LIKE 'external_access_key_expiring%' OR type = 'external_access_stale_offline')`,
      [primaryHouseholdId],
    );
  }
  for (const fixture of fixtures) {
    await db.query('DELETE FROM notifications WHERE "householdId" = $1', [fixture.householdId]);
    await cleanModuleHousehold(db, fixture);
  }
  await secondFake?.stop();
  await fake?.stop();
  await db.end();
}
