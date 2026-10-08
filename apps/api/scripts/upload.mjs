// C2 批 1 黑盒：通用图片上传 POST /upload（apps/api/src/upload/upload.module.ts）。
// 要登录（全局 JwtAuthGuard，守卫在 multer 之前，未登录不解析请求体）；只收白名单里的图片类型，扩展名按类型定；≤ 10 MB；
// diskStorage 落到 UPLOAD_DIR（run-api-tests 给的是临时目录，结束整目录删），经 /uploads/<名> 公开可取。
// multer 2.4.0 起 LIMIT_UNEXPECTED_FILE 文案变了、多了字段名错误码，Nest 10 认不出会漏成 500，由 common/multipart.ts 按 code 兜底。
// 这里钉住：都是 4xx、被拒或中途断开的上传不在磁盘上留文件。单独跑要给和 API 相同的 UPLOAD_DIR。
// 注意：别在「超大数组下标」字段后面再跟同名的非数字下标字段（如 meta[x]）。那是 GHSA-535w 的触发方式，
// 反向验证（去掉 multipartLimits）时会把 API 卡死。
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readdir, unlink } from 'node:fs/promises';
import http from 'node:http';
import { join, resolve } from 'node:path';

const BASE = process.env.API_URL || 'http://127.0.0.1:3100';
const PASSWORD = process.env.SEED_ACCOUNT_PASSWORD || 'family1234';
const MAX_BYTES = 10 * 1024 * 1024;
const uploadDir = process.env.UPLOAD_DIR ? resolve(process.env.UPLOAD_DIR) : resolve(process.cwd(), 'uploads');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const RUN = randomUUID().slice(0, 8);

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

const wait = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function login(loginName) {
  const response = await request('/auth/login', null, 'POST', { loginName, password: PASSWORD });
  if (response.status !== 201) throw new Error(`${loginName} 登录失败 ${response.status}`);
  return response.body.data.accessToken;
}

/** multipart 上传：fields 是先于文件的文本字段；file 为 null 就是「没带文件」 */
async function upload(token, { file = { bytes: PNG, type: 'image/png', name: 'photo.png' }, field = 'file', fields = [], requestId } = {}) {
  const form = new FormData();
  for (const [key, value] of fields) form.append(key, value);
  if (file) form.append(field, new Blob([file.bytes], { type: file.type }), file.name);
  const response = await fetch(`${BASE}/upload`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(requestId ? { 'x-request-id': requestId } : {}),
    },
    body: form,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function uploadedNames() {
  try {
    return (await readdir(uploadDir, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function newFiles(before) {
  return (await uploadedNames()).filter((name) => !before.includes(name));
}

/** 这些请求 ID 有没有在 API 日志里记成未处理异常。runner 是异步 append 的，先等一下；不在 runner 下跑时没有日志文件，按 0 算 */
async function unhandledCount(requestIdPrefix) {
  if (!process.env.API_LOG_FILE) return 0;
  await wait(100);
  return readFileSync(process.env.API_LOG_FILE, 'utf8')
    .split('\n')
    .filter((line) => line.includes('"event":"unhandled_exception"') && line.includes(`"requestId":"${requestIdPrefix}`)).length;
}

/** 发一半就断：边发边等 multer 把文件建到磁盘上（避开 GHSA-3pph 的竞态窗口），然后 destroy，看半截文件会不会被删 */
async function abortedUpload(token, before) {
  const boundary = `----family-upload-${randomUUID()}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="aborted.png"\r\nContent-Type: image/png\r\n\r\n`,
  );
  const declared = 4 * 1024 * 1024;
  const outgoing = http.request(new URL(`${BASE}/upload`), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(head.length + declared),
    },
  });
  outgoing.on('error', () => {}); // 主动断开必然 socket hang up / ECONNRESET
  outgoing.write(head);
  let sent = 0;
  let appeared = false;
  for (let attempt = 0; attempt < 60 && !appeared; attempt += 1) {
    if (sent + 64 * 1024 <= declared) {
      outgoing.write(Buffer.alloc(64 * 1024, 0x20));
      sent += 64 * 1024;
    }
    await wait(50);
    appeared = (await newFiles(before)).length > 0;
  }
  outgoing.destroy();
  let leftovers = [];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await wait(50);
    leftovers = await newFiles(before);
    if (!leftovers.length) break;
  }
  return { appeared, leftovers };
}

const cleanupFiles = [];
const keep = (url) => {
  const name = String(url ?? '').replace(/^\/uploads\//, '');
  if (name) cleanupFiles.push(join(uploadDir, name));
  return name;
};

try {
  const token = await login('妈妈'); // 端点只要登录，普通成员即可

  console.log('1. 登录后上传：201，UUID 文件名落在 UPLOAD_DIR，公开路径取回原字节');
  const before = await uploadedNames();
  const ok = await upload(token);
  const fileName = keep(ok.body?.data?.url);
  const served = await fetch(`${BASE}/uploads/${fileName}`);
  const servedBytes = Buffer.from(await served.arrayBuffer());
  assert(
    ok.status === 201 &&
      /^\/uploads\/[0-9a-f-]{36}\.png$/.test(ok.body.data.url) &&
      (await newFiles(before)).includes(fileName) &&
      served.status === 200 &&
      servedBytes.equals(PNG),
    '成员登录后上传图片 201，存成 UUID 文件名、公开路径取回原字节',
  );

  console.log('2. 未登录 401：守卫在 multer 之前，请求体不解析、不落盘');
  const beforeAnonymous = await uploadedNames();
  const anonymous = await upload(null);
  assert(
    anonymous.status === 401 && anonymous.body.error.message === '未登录' && (await newFiles(beforeAnonymous)).length === 0,
    '不带令牌上传 401（未登录），目录里没有多出文件',
  );

  console.log('3. 扩展名按声明的类型定，不用客户端文件名：冒充 PNG 的 HTML 存成 .png、按图片返回；svg 不收');
  const beforeDisguise = await uploadedNames();
  const disguised = await upload(token, {
    file: { bytes: Buffer.from('<script>alert(1)</script>'), type: 'image/png', name: 'x.html' },
  });
  const disguisedName = keep(disguised.body?.data?.url);
  const disguisedServed = await fetch(`${BASE}/uploads/${disguisedName}`);
  await disguisedServed.arrayBuffer();
  const svg = await upload(token, {
    file: { bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), type: 'image/svg+xml', name: 'x.svg' },
  });
  const jpeg = await upload(token, { file: { bytes: PNG, type: 'image/jpeg', name: 'no-extension' } });
  keep(jpeg.body?.data?.url);
  assert(
    disguised.status === 201 &&
      /\.png$/.test(disguised.body.data.url) &&
      (disguisedServed.headers.get('content-type') ?? '').startsWith('image/png') &&
      svg.status === 400 &&
      svg.body.error.message === '只支持图片文件' &&
      jpeg.status === 201 &&
      /\.jpg$/.test(jpeg.body.data.url) &&
      (await newFiles(beforeDisguise)).length === 2,
    'x.html 声明成 image/png 存成 .png、以 image/png 返回；image/svg+xml 400；没扩展名的 JPEG 存成 .jpg',
  );

  console.log('4. 超过 10 MB 413、不留半截文件；刚好 10 MB 收（multer ≥ 2.3 的边界，也是 Nest 那份 multer 已被 override 的端到端探针）');
  const beforeLimit = await uploadedNames();
  const tooBig = await upload(token, {
    file: { bytes: Buffer.alloc(MAX_BYTES + 1, 0x20), type: 'image/png', name: 'big.png' },
    requestId: `upload-c2-${RUN}-too-big`,
  });
  const leftAfterTooBig = await newFiles(beforeLimit);
  const exact = await upload(token, { file: { bytes: Buffer.alloc(MAX_BYTES, 0x20), type: 'image/png', name: 'exact.png' } });
  keep(exact.body?.data?.url);
  assert(
    tooBig.status === 413 && tooBig.body.error.message === 'File too large' && leftAfterTooBig.length === 0 && exact.status === 201,
    '10 MB + 1 字节 413（File too large）且磁盘上没留半截；刚好 10 MB 201',
  );

  console.log('5. 其他 multipart 错误都是 4xx 不是 500：非图片、没带文件、字段名不对、数组下标超限、嵌套超深');
  const beforeErrors = await uploadedNames();
  const notImage = await upload(token, { file: { bytes: Buffer.from('plain text'), type: 'text/plain', name: 'a.txt' } });
  const noFile = await upload(token, { file: null, fields: [['note', 'x']] });
  const wrongField = await upload(token, { field: 'image', requestId: `upload-c2-${RUN}-wrong-field` });
  // 只发一个超大下标字段，后面不跟 meta[x]（见文件头注释）
  const arrayIndex = await upload(token, { fields: [['meta[4294967294]', 'x']], requestId: `upload-c2-${RUN}-array-index` });
  const nested = await upload(token, { fields: [['a[b][c][d]', 'x']], requestId: `upload-c2-${RUN}-nesting` });
  const health = await fetch(`${BASE}/health/ready`);
  assert(
    notImage.status === 400 &&
      notImage.body.error.message === '只支持图片文件' &&
      noFile.status === 400 &&
      noFile.body.error.message === '没有收到文件' &&
      wrongField.status === 400 &&
      arrayIndex.status === 400 &&
      nested.status === 400 &&
      (await newFiles(beforeErrors)).length === 0 &&
      health.status === 200 &&
      (await unhandledCount(`upload-c2-${RUN}`)) === 0,
    '非图片 / 没带文件 / 字段名不是 file / 数组下标超限 / 嵌套超深都 400，没落盘、没有未处理异常、服务仍就绪',
  );

  console.log('6. 上传中途断开：已经落盘的半截文件被 multer 删掉（GHSA-3pph / CVE-2026-88932；更早还有 GHSA-3p4h / CVE-2026-5038）');
  const beforeAbort = await uploadedNames();
  const aborted = await abortedUpload(token, beforeAbort);
  aborted.leftovers.forEach((name) => cleanupFiles.push(join(uploadDir, name)));
  const healthAfterAbort = await fetch(`${BASE}/health/ready`);
  assert(
    aborted.appeared && aborted.leftovers.length === 0 && healthAfterAbort.status === 200,
    '中途断开的上传先落了盘、断开后 3 秒内被清掉，服务仍就绪',
  );

  console.log('\n通用图片上传回归测试全部通过');
} finally {
  await Promise.all(cleanupFiles.map((path) => unlink(path).catch(() => undefined)));
}
