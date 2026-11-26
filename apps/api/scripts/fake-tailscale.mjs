// 假的 Tailscale 控制面 API v2（黑盒、契约与 Playwright E2E 共用，隔离测试库通过 127.0.0.1 访问）。
// 支持：
// - POST /api/v2/oauth/token（OAuth client_credentials 换取短期令牌，区分只读 / 读写客户端）
// - GET  /api/v2/tailnet/:tailnet/devices（返回含敏感原始字段的设备列表，供验证白名单裁剪）
// - GET  /api/v2/device/:id（单台设备明细，不存在返回 404）
// - POST /api/v2/device/0/authorized（阶段 1 只读核验探针：只读凭据返回 403，读写凭据返回 404）
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

export function createSampleTailscaleDevices(now = new Date()) {
  const daysFromNow = (days) => new Date(now.getTime() + days * 86_400_000).toISOString();
  const minutesAgo = (minutes) => new Date(now.getTime() - minutes * 60_000).toISOString();

  return [
    {
      id: 'dev-server-1',
      name: 'xiaoguanjia.family.ts.net.',
      hostname: 'xiaoguanjia',
      user: 'tagged-devices',
      os: 'macOS',
      clientVersion: '1.80.3',
      updateAvailable: false,
      authorized: true,
      connectedToControl: true,
      isExternal: false,
      lastSeen: minutesAgo(1),
      expires: '0001-01-01T00:00:00Z',
      keyExpiryDisabled: true,
      addresses: ['100.64.0.10', 'fd7a:115c:a1e0::10'],
      tags: ['tag:server'],
      blocksIncomingConnections: false,
      created: daysFromNow(-120),
      // 故意塞入方案 §5.3 禁止返回的敏感底层字段，用于断言白名单序列化绝不泄露
      machineKey: 'mkey:must-never-leak-001',
      nodeKey: 'nodekey:must-never-leak-002',
      tailnetLockKey: 'nlpub:must-never-leak-003',
      clientConnectivity: { endpoints: ['203.0.113.10:41641'] },
    },
    {
      id: 'dev-dad-phone',
      name: 'dad-iphone.family.ts.net.',
      hostname: 'dad-iphone',
      user: 'dad@example.com',
      os: 'iOS',
      clientVersion: '1.80.1',
      updateAvailable: false,
      authorized: true,
      connectedToControl: true,
      isExternal: false,
      lastSeen: minutesAgo(2),
      expires: daysFromNow(5),
      keyExpiryDisabled: false,
      addresses: ['100.64.0.21', 'fd7a:115c:a1e0::21'],
      tags: [],
      blocksIncomingConnections: true,
      created: daysFromNow(-90),
      machineKey: 'mkey:must-never-leak-phone',
    },
    {
      id: 'dev-old-ipad',
      name: 'old-ipad.family.ts.net.',
      hostname: 'old-ipad',
      user: 'mom@example.com',
      os: 'iPadOS',
      clientVersion: '1.76.0',
      updateAvailable: true,
      authorized: true,
      connectedToControl: false,
      isExternal: false,
      lastSeen: daysFromNow(-45),
      expires: daysFromNow(60),
      keyExpiryDisabled: false,
      addresses: ['100.64.0.35'],
      tags: [],
      blocksIncomingConnections: false,
      created: daysFromNow(-200),
    },
    {
      id: 'dev-guest-mac',
      name: 'guest-mac.family.ts.net.',
      hostname: 'guest-mac',
      user: 'guest@example.com',
      os: 'macOS',
      clientVersion: '1.78.2',
      updateAvailable: true,
      authorized: false,
      connectedToControl: false,
      isExternal: true,
      lastSeen: daysFromNow(-3),
      expires: daysFromNow(40),
      keyExpiryDisabled: false,
      addresses: ['100.64.0.99'],
      tags: ['tag:guest'],
      blocksIncomingConnections: false,
      created: daysFromNow(-10),
    },
  ];
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function writeJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

export async function startFakeTailscale(options = {}) {
  const oauthClientId = options.oauthClientId ?? 'kTestOAuthClient001';
  const oauthClientSecret = options.oauthClientSecret ?? 'tskey-client-kTestOAuthClient001-readonlysecret';
  const rwOauthClientId = options.rwOauthClientId ?? 'kTestOAuthWrite002';
  const rwOauthClientSecret = options.rwOauthClientSecret ?? 'tskey-client-kTestOAuthWrite002-readwritesecret';
  const apiToken = options.apiToken ?? 'tskey-api-kTestReadOnlyToken-1234567890';
  const rwApiToken = options.rwApiToken ?? 'tskey-api-kTestReadWriteToken-9876543210';
  const allowedTailnets = new Set(options.allowedTailnets ?? ['-', 'family.ts.net']);

  const issuedTokens = new Map();
  let server = null;
  let boundPort = options.port ?? 0;

  const state = {
    url: '',
    mode: 'ok',
    probeStatusOverride: null,
    failNextBearerOnce: false,
    oauthClientId,
    oauthClientSecret,
    rwOauthClientId,
    rwOauthClientSecret,
    apiToken,
    rwApiToken,
    credentials: {
      oauthClientId,
      oauthClientSecret,
      rwOauthClientId,
      rwOauthClientSecret,
      apiToken,
      rwApiToken,
    },
    devices: options.devices ?? createSampleTailscaleDevices(),
    requests: [],
    setDevices(next) {
      state.devices = next;
    },
    resetRequests() {
      state.requests.length = 0;
    },
    async start() {
      if (server) return;
      server = createServer(async (req, res) => {
        try {
        const parsed = new URL(req.url || '/', 'http://127.0.0.1');
        const method = req.method || 'GET';

        if (state.mode === 'hang' || state.mode === 'timeout') {
          state.requests.push({ method, path: parsed.pathname, authKind: 'hang' });
          return;
        }
        if (state.mode === 'redirect') {
          state.requests.push({ method, path: parsed.pathname, authKind: 'redirect' });
          res.writeHead(302, { Location: 'https://evil.example/leak' });
          res.end();
          return;
        }
        if (state.mode === 'error') {
          state.requests.push({ method, path: parsed.pathname, authKind: 'error' });
          writeJson(res, 500, { message: 'mock control plane failure' });
          return;
        }

        if (method === 'POST' && parsed.pathname === '/api/v2/oauth/token') {
          const raw = await readBody(req);
          const form = new URLSearchParams(raw);
          const cid = form.get('client_id');
          const csec = form.get('client_secret');
          const grant = form.get('grant_type');
          state.requests.push({ method, path: parsed.pathname, authKind: 'oauth_exchange' });
          if (grant !== 'client_credentials') {
            writeJson(res, 400, { message: 'invalid grant_type' });
            return;
          }
          if (cid === oauthClientId && csec === oauthClientSecret) {
            const issued = `ts-oauth-ro-${randomUUID()}`;
            issuedTokens.set(issued, { permission: 'read_only' });
            writeJson(res, 200, { access_token: issued, token_type: 'Bearer', expires_in: 3600 });
            return;
          }
          if (cid === rwOauthClientId && csec === rwOauthClientSecret) {
            const issued = `ts-oauth-rw-${randomUUID()}`;
            issuedTokens.set(issued, { permission: 'read_write' });
            writeJson(res, 200, { access_token: issued, token_type: 'Bearer', expires_in: 3600 });
            return;
          }
          writeJson(res, 401, { message: 'invalid client credentials' });
          return;
        }

        const header = req.headers.authorization || '';
        const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
        let auth = null;
        if (bearer === apiToken) auth = { permission: 'read_only', kind: 'api_token' };
        else if (bearer === rwApiToken) auth = { permission: 'read_write', kind: 'api_token' };
        else if (issuedTokens.has(bearer)) auth = { ...issuedTokens.get(bearer), kind: 'oauth' };

        state.requests.push({ method, path: parsed.pathname, authKind: auth?.kind ?? 'none' });

        if (!auth) {
          writeJson(res, 401, { message: 'unauthorized' });
          return;
        }
        if (state.failNextBearerOnce) {
          state.failNextBearerOnce = false;
          issuedTokens.delete(bearer);
          writeJson(res, 401, { message: 'expired oauth session' });
          return;
        }

        const devicesMatch = parsed.pathname.match(/^\/api\/v2\/tailnet\/([^/]+)\/devices$/);
        if (method === 'GET' && devicesMatch) {
          const tailnet = decodeURIComponent(devicesMatch[1]);
          if (!allowedTailnets.has(tailnet)) {
            writeJson(res, 404, { message: 'tailnet not found' });
            return;
          }
          writeJson(res, 200, { devices: state.devices });
          return;
        }

        if (method === 'POST' && parsed.pathname === '/api/v2/device/0/authorized') {
          await readBody(req);
          if (state.probeStatusOverride !== null) {
            writeJson(res, state.probeStatusOverride, { message: 'override probe status' });
            return;
          }
          if (auth.permission === 'read_only') {
            writeJson(res, 403, { message: 'missing write scope' });
            return;
          }
          writeJson(res, 404, { message: 'device 0 not found' });
          return;
        }

        const singleMatch = parsed.pathname.match(/^\/api\/v2\/device\/([^/]+)$/);
        if (method === 'GET' && singleMatch) {
          const deviceId = decodeURIComponent(singleMatch[1]);
          const found = state.devices.find((item) => item.id === deviceId);
          if (!found) {
            writeJson(res, 404, { message: 'device not found' });
            return;
          }
          writeJson(res, 200, found);
          return;
        }

        writeJson(res, 404, { message: 'not found' });
        } catch {
          if (!res.headersSent) writeJson(res, 500, { message: 'mock server error' });
          else res.end();
        }
      });

      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(boundPort, '127.0.0.1', () => {
          const address = server.address();
          boundPort = address.port;
          state.url = `http://127.0.0.1:${boundPort}`;
          resolve();
        });
      });
    },
    async stop() {
      if (!server) return;
      const closing = server;
      server = null;
      closing.closeAllConnections?.();
      await new Promise((resolve) => closing.close(() => resolve()));
    },
  };

  await state.start();
  return state;
}
