const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, options);
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  };
}

const liveRequestId = 'family-test-health-0001';
const live = await request('/health/live', {
  headers: { 'X-Request-ID': liveRequestId },
});
assert(
  live.status === 200 &&
    live.body.data.status === 'ok' &&
    live.headers.get('x-request-id') === liveRequestId,
  '存活检查可用并回传调用方提供的合法请求 ID',
);
assert(live.headers.get('cache-control') === 'no-store', '健康响应不被缓存');

const ready = await request('/health/ready', {
  headers: { 'X-Request-ID': 'bad' },
});
const generatedRequestId = ready.headers.get('x-request-id');
assert(
  ready.status === 200 &&
    ready.body.data.status === 'ok' &&
    UUID_PATTERN.test(generatedRequestId || ''),
  '就绪检查会替换不合法的请求 ID 并探测数据库',
);

const errorRequestId = 'family-test-client-error-0001';
const invalidLogin = await request('/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Request-ID': errorRequestId,
  },
  body: JSON.stringify({
    memberId: 'not-a-uuid',
    pin: 'body-sensitive-marker-2468',
  }),
});
assert(
  invalidLogin.status === 400 &&
    invalidLogin.headers.get('x-request-id') === errorRequestId &&
    invalidLogin.body.requestId === errorRequestId,
  '错误响应头和响应体使用同一个请求 ID',
);

await request('/members?probe=query-sensitive-marker-9081', {
  headers: { 'X-Request-ID': 'family-test-query-0001' },
});

await request('/dishes', {
  headers: {
    Authorization: 'Bearer header-sensitive-marker-1357',
    'X-Request-ID': 'family-test-header-0001',
  },
});

console.log('\n请求追踪与健康检查测试全部通过');
