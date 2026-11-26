// M5-E 外部访问单测与控制面契约测试（ts-node + node:assert）：
// 覆盖 Tailscale 双栈入口识别、URL/tailnet/主机名归一化、设备脱敏与告警、OAuth/API 令牌客户端与只读核验探针。
// 单独运行：node -r ts-node/register scripts/external-access.contract.ts
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  extractTailscaleIngress,
  isTailscaleIp,
  normalizeClientIp,
} from '../src/common/tailscale-ingress';
import {
  computeExternalAccessAlerts,
  computeExternalAccessSummary,
  matchServerNode,
  presentTailscaleDeviceDetail,
  sortDevices,
  toDeviceSummary,
  type TailscaleRawDevice,
} from '../src/external-access/tailscale.alerts';
import {
  clearTailscaleTokenCache,
  fetchTailscaleDevice,
  fetchTailscaleDevices,
  probeTailscaleReadOnly,
  TailscaleApiError,
  type TailscaleTarget,
} from '../src/external-access/tailscale.client';
import {
  deterministicExternalAccessUuid,
  isolatedTestMode,
  maskOauthClientId,
  normalizeNodeHostname,
  normalizeTailnet,
  normalizeTailscaleBaseUrl,
  normalizeTailscalePublicUrl,
  tailscaleServerDefault,
  tailscaleServerDefaultConfigured,
} from '../src/external-access/tailscale.config';

const FAKE_TS_MODULE = pathToFileURL(join(__dirname, 'fake-tailscale.mjs')).href;
const importEsm = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<Record<string, unknown>>;

interface FakeTailscaleServer {
  url: string;
  mode: 'ok' | 'error' | 'hang' | 'redirect';
  probeStatusOverride: number | null;
  failNextBearerOnce: boolean;
  oauthClientId: string;
  oauthClientSecret: string;
  rwOauthClientId: string;
  rwOauthClientSecret: string;
  apiToken: string;
  rwApiToken: string;
  requests: { method: string; path: string; authKind: string }[];
  resetRequests(): void;
  stop(): Promise<void>;
}

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

void (async () => {
  console.log('1. Tailscale 双栈入口与身份头识别（tailscale-ingress.ts）');
  await check('IPv4 CGNAT (100.64.0.0/10) 与 IPv4-mapped IPv6 边界精确', () => {
    assert.equal(normalizeClientIp('::ffff:100.64.0.1'), '100.64.0.1');
    assert.equal(normalizeClientIp('::ffff:6440:1'), '100.64.0.1');
    assert.equal(normalizeClientIp('0:0:0:0:0:ffff:100.64.0.1'), '100.64.0.1');
    assert.equal(normalizeClientIp('[fd7a:115c:a1e0::1]%utun0'), 'fd7a:115c:a1e0::1');
    const valid = [
      '100.64.0.1', '100.127.255.254', '::ffff:100.100.100.100', '::ffff:6440:1',
      '0:0:0:0:0:ffff:100.64.0.1', 'fd7a:115c:a1e0::1', 'FD7A:115C:A1E0:ab12::0042',
    ];
    for (const ip of valid) assert.equal(isTailscaleIp(ip), true, ip);
    const invalid = [
      '100.63.255.255', '100.128.0.0', '192.168.1.50', '127.0.0.1',
      '::1', '::ffff:7f00:1', 'fd7a:115c:a1e1::1', 'fe80::1', 'not-an-ip',
    ];
    for (const ip of invalid) assert.equal(isTailscaleIp(ip), false, ip);
  });

  await check('必须同时满足 X-Family-Ingress、双栈 IP 和 Tailscale-User-Login 才认定经由外部通道', () => {
    assert.deepEqual(
      extractTailscaleIngress({
        ip: '::ffff:100.64.2.9',
        headers: {
          'x-family-ingress': 'tailscale',
          'tailscale-user-login': '  dad@example.com\r\n\x00 ',
          'tailscale-user-name': '爸爸\tHome',
        },
      }),
      { viaTailscale: true, login: 'dad@example.com', name: '爸爸Home' },
    );
    assert.deepEqual(
      extractTailscaleIngress({
        ip: 'fd7a:115c:a1e0::99',
        headers: { 'x-family-ingress': 'tailscale', 'tailscale-user-login': 'mom@example.com' },
      }),
      { viaTailscale: true, login: 'mom@example.com', name: null },
    );
    const rejected: [string, { ip: string; headers: Record<string, string> }][] = [
      ['缺少 X-Family-Ingress 标记', { ip: '100.64.2.9', headers: { 'tailscale-user-login': 'dad@example.com' } }],
      ['局域网 IP 伪造头被拒', { ip: '192.168.1.20', headers: { 'x-family-ingress': 'tailscale', 'tailscale-user-login': 'dad@example.com' } }],
      ['纯控制字符 login 被拒', { ip: '100.64.2.9', headers: { 'x-family-ingress': 'tailscale', 'tailscale-user-login': '\r\n\t   ' } }],
    ];
    for (const [label, req] of rejected) {
      assert.equal(extractTailscaleIngress(req).viaTailscale, false, label);
    }
  });

  console.log('2. 配置归一化与安全边界（tailscale.config.ts）');
  await check('常规模式拦截回环/元数据/HTTP/凭据 URL，仅隔离测试库放行 127.0.0.1 HTTP', () => {
    const savedNodeEnv = process.env.NODE_ENV;
    const savedDbName = process.env.DB_NAME;
    try {
      process.env.NODE_ENV = 'production';
      process.env.DB_NAME = 'family_app';
      assert.equal(isolatedTestMode(), false);
      assert.equal(normalizeTailscaleBaseUrl(''), 'https://api.tailscale.com');
      assert.equal(normalizeTailscaleBaseUrl('https://api.tailscale.com/'), 'https://api.tailscale.com');
      assert.equal(normalizeTailscaleBaseUrl('https://headscale.example.com/api/'), 'https://headscale.example.com/api');
      const blocked = [
        'http://127.0.0.1:8080', 'https://127.0.0.1', 'https://localhost',
        'https://localhost.', 'https://sub.localhost.', 'https://169.254.169.254',
        'https://[::ffff:127.0.0.1]', 'https://[::ffff:0:127.0.0.1]',
        'https://[64:ff9b::127.0.0.1]', 'https://user:pass@api.tailscale.com',
        'https://api.tailscale.com?a=1',
      ];
      for (const url of blocked) assert.equal(normalizeTailscaleBaseUrl(url), undefined, url);

      assert.equal(normalizeTailscalePublicUrl('https://xiaoguanjia.tail123.ts.net/'), 'https://xiaoguanjia.tail123.ts.net');
      assert.equal(normalizeTailscalePublicUrl('https://xiaoguanjia.tail123.ts.net/path'), undefined);
      assert.equal(normalizeTailscalePublicUrl('http://127.0.0.1:8089'), undefined);

      process.env.NODE_ENV = 'test';
      process.env.DB_NAME = 'family_app_test_0123456789abcdef';
      assert.equal(isolatedTestMode(), true);
      assert.equal(normalizeTailscaleBaseUrl('http://127.0.0.1:41234'), 'http://127.0.0.1:41234');
      assert.equal(normalizeTailscalePublicUrl('http://127.0.0.1:8089'), 'http://127.0.0.1:8089');
    } finally {
      if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedNodeEnv;
      if (savedDbName === undefined) delete process.env.DB_NAME;
      else process.env.DB_NAME = savedDbName;
    }
  });

  await check('tailnet、节点名、Client ID 脱敏与确定性 UUID', () => {
    assert.equal(normalizeTailnet(''), '-');
    assert.equal(normalizeTailnet('family.ts.net'), 'family.ts.net');
    assert.equal(normalizeTailnet('../etc'), undefined);
    assert.equal(normalizeNodeHostname('xiaoguanjia\r\n'), 'xiaoguanjia');
    assert.equal(normalizeNodeHostname('a'.repeat(121)), undefined);
    assert.equal(maskOauthClientId('kShort12'), 'kShort12');
    assert.equal(maskOauthClientId('kTestOAuthClient001'), 'kTes…t001');

    const uuid1 = deterministicExternalAccessUuid('11111111-1111-4111-8111-111111111111', 'dev-1');
    const uuid2 = deterministicExternalAccessUuid('11111111-1111-4111-8111-111111111111', 'dev-1');
    const uuidOther = deterministicExternalAccessUuid('22222222-2222-4222-8222-222222222222', 'dev-1');
    assert.equal(uuid1, uuid2);
    assert.notEqual(uuid1, uuidOther);
    assert.match(uuid1, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  console.log('3. 设备白名单序列化与告警规则（tailscale.alerts.ts）');
  await check('节点匹配、敏感底层字段绝不输出、摘要剥离明细字段、告警与排序', () => {
    const now = new Date('2026-11-25T08:00:00.000Z');
    assert.equal(matchServerNode({ hostname: 'xiaoguanjia', name: 'other.ts.net.' }, 'XiaoGuanJia'), true);
    assert.equal(matchServerNode({ hostname: 'mac-mini', name: 'xiaoguanjia.family.ts.net.' }, 'xiaoguanjia'), true);
    assert.equal(matchServerNode({ hostname: 'mac-mini', name: 'other.family.ts.net.' }, 'xiaoguanjia'), false);

    const rawServer: TailscaleRawDevice & Record<string, unknown> = {
      id: 'd1',
      name: 'xiaoguanjia.family.ts.net.',
      hostname: 'xiaoguanjia',
      os: 'macOS',
      authorized: true,
      connectedToControl: true,
      keyExpiryDisabled: true,
      expires: '0001-01-01T00:00:00Z',
      addresses: ['100.64.0.10'],
      tags: ['tag:server'],
      machineKey: 'mkey:secret',
      nodeKey: 'nodekey:secret',
      tailnetLockKey: 'nlpub:secret',
      clientConnectivity: { endpoints: ['1.2.3.4:1'] },
    };
    const rawExpiring: TailscaleRawDevice = {
      id: 'd2',
      name: 'dad-phone.family.ts.net.',
      hostname: 'dad-phone',
      user: 'dad@example.com',
      os: 'iOS',
      authorized: true,
      connectedToControl: true,
      keyExpiryDisabled: false,
      expires: '2026-11-29T08:00:00.000Z',
      addresses: ['100.64.0.21'],
    };
    const rawStale: TailscaleRawDevice = {
      id: 'd3',
      name: 'old-ipad.family.ts.net.',
      hostname: 'old-ipad',
      os: 'iPadOS',
      authorized: false,
      connectedToControl: false,
      isExternal: true,
      lastSeen: '2026-10-10T08:00:00.000Z',
      expires: '2027-02-01T08:00:00.000Z',
    };

    const details = sortDevices(
      [rawStale, rawExpiring, rawServer].map((raw) =>
        presentTailscaleDeviceDetail(raw, 'xiaoguanjia', 'Asia/Shanghai', now),
      ),
    );
    assert.deepEqual(
      details.map((d) => d.id),
      ['d1', 'd3', 'd2'],
      '排序：小管家节点优先，再待授权设备，再在线设备',
    );
    const serverDetail = details[0] as unknown as Record<string, unknown>;
    for (const forbidden of ['machineKey', 'nodeKey', 'tailnetLockKey', 'clientConnectivity']) {
      assert.equal(forbidden in serverDetail, false, `明细不含 ${forbidden}`);
    }
    const summaries = details.map(toDeviceSummary);
    assert.equal('addresses' in summaries[0], false, '摘要不含 addresses');
    assert.equal('tags' in summaries[0], false, '摘要不含 tags');

    const alerts = computeExternalAccessAlerts(summaries, 'Asia/Shanghai');
    assert.deepEqual(
      alerts.map((a) => [a.kind, a.deviceId]),
      [
        ['key_expiring', 'd2'],
        ['stale_offline', 'd3'],
      ],
    );
    const stats = computeExternalAccessSummary(summaries, alerts);
    assert.deepEqual(stats, {
      totalDevices: 3,
      onlineDevices: 2,
      unauthorizedDevices: 1,
      expiringSoonCount: 1,
      staleOfflineCount: 1,
      externalDevices: 1,
    });
  });

  console.log('4. Tailscale 控制面客户端契约（tailscale.client.ts + fake-tailscale.mjs）');
  const { startFakeTailscale } = (await importEsm(FAKE_TS_MODULE)) as {
    startFakeTailscale: () => Promise<FakeTailscaleServer>;
  };
  const fake = await startFakeTailscale();
  const savedTimeout = process.env.TAILSCALE_TIMEOUT_MS;
  try {
    clearTailscaleTokenCache();
    const oauthRoTarget: TailscaleTarget = {
      baseUrl: fake.url,
      tailnet: '-',
      credentialKind: 'oauth_client',
      oauthClientId: fake.oauthClientId,
      secret: fake.oauthClientSecret,
    };

    await check('OAuth 只读客户端：换令牌、缓存复用、401 自动刷新与只读探针 403 通过', async () => {
      const probe = await probeTailscaleReadOnly(oauthRoTarget);
      assert.equal(probe.available, true);
      assert.equal(probe.readOnlyVerified, true);
      assert.equal(probe.permissionLevel, 'read_only');
      assert.equal(probe.devices.length, 4);

      fake.resetRequests();
      const cachedFetch = await fetchTailscaleDevices(oauthRoTarget);
      assert.equal(cachedFetch.length, 4);
      assert.equal(
        fake.requests.filter((r) => r.path === '/api/v2/oauth/token').length,
        0,
        '命中内存 OAuth 令牌缓存时不重复换令牌',
      );

      // 模拟短期令牌失效：首次返回 401，客户端自动换新令牌后重试成功
      fake.resetRequests();
      fake.failNextBearerOnce = true;
      const single = await fetchTailscaleDevice(oauthRoTarget, 'dev-server-1');
      assert.equal(single?.hostname, 'xiaoguanjia');
      assert.equal(
        fake.requests.filter((r) => r.path === '/api/v2/oauth/token').length,
        1,
        '401 后自动重新换取 OAuth 令牌',
      );
      assert.equal(await fetchTailscaleDevice(oauthRoTarget, 'missing-id'), null);
    });

    const apiTarget = (secret: string, tailnet = '-'): TailscaleTarget => ({
      baseUrl: fake.url,
      tailnet,
      credentialKind: 'api_token',
      oauthClientId: null,
      secret,
    });

    await check('OAuth 读写客户端与 API 令牌只读/读写探针判定准确', async () => {
      const oauthRwProbe = await probeTailscaleReadOnly({
        baseUrl: fake.url,
        tailnet: '-',
        credentialKind: 'oauth_client',
        oauthClientId: fake.rwOauthClientId,
        secret: fake.rwOauthClientSecret,
      });
      assert.equal(oauthRwProbe.permissionLevel, 'read_write');
      assert.equal(oauthRwProbe.readOnlyVerified, false);

      const apiRoProbe = await probeTailscaleReadOnly(apiTarget(fake.apiToken, 'family.ts.net'));
      assert.equal(apiRoProbe.permissionLevel, 'read_only');
      assert.equal(apiRoProbe.readOnlyVerified, true);

      const apiRwProbe = await probeTailscaleReadOnly(apiTarget(fake.rwApiToken));
      assert.equal(apiRwProbe.permissionLevel, 'read_write');
      assert.equal(apiRwProbe.readOnlyVerified, false);
    });

    await check('3xx 跳转直接报错不跟随（防凭据泄露），超时触发 timeout 错误', async () => {
      fake.mode = 'redirect';
      await assert.rejects(
        fetchTailscaleDevices(apiTarget(fake.apiToken)),
        (error: unknown) => error instanceof TailscaleApiError && error.code === 'network',
      );

      process.env.TAILSCALE_TIMEOUT_MS = '150';
      fake.mode = 'hang';
      await assert.rejects(
        fetchTailscaleDevices(apiTarget(fake.apiToken)),
        (error: unknown) => error instanceof TailscaleApiError && error.code === 'timeout',
      );
      fake.mode = 'ok';
    });

    await check('只读探针遇到控制面 500/429 时降级为 unknown，401 走令牌刷新后重探', async () => {
      fake.probeStatusOverride = 500;
      try {
        const unknownProbe = await probeTailscaleReadOnly(apiTarget(fake.apiToken));
        assert.equal(unknownProbe.available, true);
        assert.equal(unknownProbe.permissionLevel, 'unknown');
        assert.equal(unknownProbe.readOnlyVerified, false);
      } finally {
        fake.probeStatusOverride = null;
      }

      // OAuth 令牌在探针阶段遇到 401 时也能自动刷新并完成只读判定
      fake.resetRequests();
      await fetchTailscaleDevices(oauthRoTarget);
      fake.failNextBearerOnce = true;
      const refreshedProbe = await probeTailscaleReadOnly(oauthRoTarget);
      assert.equal(refreshedProbe.permissionLevel, 'read_only');
      assert.equal(refreshedProbe.readOnlyVerified, true);
    });

    await check('tailscaleServerDefault() 正确读取 *_FILE、OAuth 优先与 ALLOWED_HOUSEHOLD_ID', () => {
      const keys = [
        'TAILSCALE_API_BASE_URL',
        'TAILSCALE_TAILNET',
        'TAILSCALE_PUBLIC_URL',
        'TAILSCALE_NODE_HOSTNAME',
        'TAILSCALE_OAUTH_CLIENT_ID',
        'TAILSCALE_OAUTH_CLIENT_ID_FILE',
        'TAILSCALE_OAUTH_CLIENT_SECRET',
        'TAILSCALE_OAUTH_CLIENT_SECRET_FILE',
        'TAILSCALE_API_TOKEN',
        'TAILSCALE_API_TOKEN_FILE',
        'TAILSCALE_ALLOWED_HOUSEHOLD_ID',
      ] as const;
      const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
      const idFile = join(tmpdir(), `ts-cid-${Date.now()}.txt`);
      const secretFile = join(tmpdir(), `ts-sec-${Date.now()}.txt`);
      const tokenFile = join(tmpdir(), `ts-tok-${Date.now()}.txt`);
      writeFileSync(idFile, 'kFileClientId01\n', 'utf8');
      writeFileSync(secretFile, 'tskey-client-file-secret\n', 'utf8');
      writeFileSync(tokenFile, 'tskey-api-file-token\n', 'utf8');
      try {
        for (const k of keys) delete process.env[k];
        assert.equal(tailscaleServerDefaultConfigured(), false);

        // 只有 secret 没有 clientId：不构成有效 OAuth，自动回落到 API 令牌或未配置
        process.env.TAILSCALE_OAUTH_CLIENT_SECRET_FILE = secretFile;
        assert.equal(tailscaleServerDefaultConfigured(), false);

        process.env.TAILSCALE_API_TOKEN_FILE = tokenFile;
        const apiFallback = tailscaleServerDefault();
        assert.equal(apiFallback.credentialKind, 'api_token');
        assert.equal(apiFallback.secret, 'tskey-api-file-token');

        // OAuth 齐备时优先于 API 令牌，并支持 ALLOWED_HOUSEHOLD_ID
        process.env.TAILSCALE_OAUTH_CLIENT_ID_FILE = idFile;
        process.env.TAILSCALE_ALLOWED_HOUSEHOLD_ID = '00000000-0000-4000-8000-000000000099';
        process.env.TAILSCALE_PUBLIC_URL = 'https://xiaoguanjia.family.ts.net/';
        const oauthPreferred = tailscaleServerDefault();
        assert.equal(oauthPreferred.credentialKind, 'oauth_client');
        assert.equal(oauthPreferred.oauthClientId, 'kFileClientId01');
        assert.equal(oauthPreferred.secret, 'tskey-client-file-secret');
        assert.equal(oauthPreferred.publicUrl, 'https://xiaoguanjia.family.ts.net');
        assert.equal(
          oauthPreferred.allowedHouseholdId,
          '00000000-0000-4000-8000-000000000099',
        );
        assert.equal(tailscaleServerDefaultConfigured(), true);
      } finally {
        for (const k of keys) {
          if (saved[k] === undefined) delete process.env[k];
          else process.env[k] = saved[k];
        }
        rmSync(idFile, { force: true });
        rmSync(secretFile, { force: true });
        rmSync(tokenFile, { force: true });
      }
    });
  } finally {
    if (savedTimeout === undefined) delete process.env.TAILSCALE_TIMEOUT_MS;
    else process.env.TAILSCALE_TIMEOUT_MS = savedTimeout;
    await fake.stop();
  }

  console.log(`外部访问单测与控制面契约测试全部通过（${passed} 条）`);
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
