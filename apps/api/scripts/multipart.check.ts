// C2 单测（同 finance-import.check.ts：ts-node + node:assert，不碰数据库）：multer 错误按 code 映射成 400 / 413、
// 拦截点 limits 带字段名防护且一个不漏、Nest 实际加载的那份 multer ≥ 2.4.0（pnpm-workspace.yaml 的 override 生效）。
// run-api-tests.mjs 全量模式里执行；单独跑（apps/api 下）：node -r ts-node/register scripts/multipart.check.ts
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import multer, { MulterError } from 'multer';
import { multerErrorToHttp, multipartLimits } from '../src/common/multipart';

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
/** @types/multer 1.4.x 的 ErrorCode 还没有 2.2+ / 2.3+ 新增的码 */
const code = (value: string) => value as never;
/** Nest 的 FileInterceptor 在 platform-express 自己的目录里 require('multer')：override 没生效时它还是 2.0.2 */
const nestRequire = createRequire(require.resolve('@nestjs/platform-express'));
const nestMulter = nestRequire('multer') as typeof multer;

check('LIMIT_FILE_SIZE → 413', () => {
  assert.ok(multerErrorToHttp(new MulterError('LIMIT_FILE_SIZE', 'file')) instanceof PayloadTooLargeException);
});
check('LIMIT_UNEXPECTED_FILE（2.4.0 起文案是 Unexpected file field）→ 400', () => {
  assert.ok(multerErrorToHttp(new MulterError('LIMIT_UNEXPECTED_FILE', 'image')) instanceof BadRequestException);
});
check('新增的字段名错误码 → 400', () => {
  for (const one of ['LIMIT_FIELD_NESTING', 'LIMIT_FIELD_ARRAY_INDEX', 'INVALID_FIELD_NAME']) {
    assert.equal(multerErrorToHttp(new MulterError(code(one), 'a'))?.getStatus(), 400, one);
  }
});
check('STREAM_DESTROYED 与非 multer 错误不映射（照旧 500）', () => {
  assert.equal(multerErrorToHttp(new MulterError(code('STREAM_DESTROYED'))), null);
  assert.equal(multerErrorToHttp(new Error('File too large')), null);
  assert.equal(multerErrorToHttp('File too large'), null);
});
check('multipartLimits 补上字段名防护、调用方的值优先', () => {
  const limits = multipartLimits({ fileSize: 5, files: 1 }) as Record<string, number>;
  assert.equal(limits.fileSize, 5);
  assert.equal(limits.files, 1);
  assert.ok(Number.isInteger(limits.fieldNestingDepth) && Number.isInteger(limits.fieldArrayIndexLimit));
});
check('Nest 加载的 multer ≥ 2.4.0、和 api 直接依赖是同一份（override 生效）', () => {
  const version = (nestRequire('multer/package.json') as { version: string }).version;
  const [major, minor] = version.split('.').map(Number);
  assert.ok(major > 2 || (major === 2 && minor >= 4), `Nest 用的 multer 是 ${version}`);
  assert.equal(nestRequire.resolve('multer'), require.resolve('multer'));
});
check('Nest 那份 multer 构造时校验 limits（2.4.0 行为），六处的值都能构造', () => {
  assert.doesNotThrow(() =>
    nestMulter({ limits: multipartLimits({ fileSize: 10 * 1024 * 1024, fields: 12, fieldSize: 128 * 1024, files: 1 }) }),
  );
  assert.throws(() => nestMulter({ limits: { fileSize: 1.5 } }), /non-negative integer/);
});
check('src 里每个 multer 拦截点都用 multipartLimits 包了 limits', () => {
  const src = join(__dirname, '../src');
  const offenders: string[] = [];
  for (const entry of readdirSync(src, { recursive: true, encoding: 'utf8' })) {
    if (!entry.endsWith('.ts') || entry.endsWith(join('common', 'multipart.ts'))) continue;
    const source = readFileSync(join(src, entry), 'utf8');
    const interceptors = source.match(/\b(?:File|Files|AnyFiles|FileFields|NoFiles)Interceptor\(/g)?.length ?? 0;
    const wrapped = source.match(/\bmultipartLimits\(/g)?.length ?? 0;
    if (interceptors !== wrapped) offenders.push(`${entry}：${interceptors} 个拦截器、${wrapped} 处 multipartLimits`);
  }
  assert.deepEqual(offenders, []);
});

console.log(`multipart 单测全部通过（${passed} 条）`);
