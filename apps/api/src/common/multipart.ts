import { BadRequestException, HttpException, PayloadTooLargeException } from '@nestjs/common';
import type { MulterModuleOptions } from '@nestjs/platform-express';

/** Nest 12 起 limits 也可以是「按请求返回 limits 的函数」；这里只用对象形态。 */
type MultipartLimits = Exclude<NonNullable<MulterModuleOptions['limits']>, (...args: never[]) => unknown>;

/**
 * multer 2.2+/2.3+ 新增、默认不开的字段名防护：GHSA-535w-7cp7-47q4 要求显式配置 fieldArrayIndexLimit，
 * fieldNestingDepth 兜 GHSA-72gw-mp4g-v24j 那类深嵌套（只查文本字段名，文件字段不查）。现有 multipart 客户端
 * （web、Plex、黑盒、e2e）都不用 a[b] / a[0] 写法。Nest 12 的 platform-express 缺省时也会补默认值，这里显式写出我们要的值，不依赖框架默认。
 */
const FIELD_NAME_GUARDS = { fieldNestingDepth: 2, fieldArrayIndexLimit: 20 };

/** 所有 multer 拦截点统一用它包 limits（scripts/multipart.check.ts 会扫 src 校验这一点）。调用方的值优先。 */
export function multipartLimits(limits: MultipartLimits): MultipartLimits {
  return { ...FIELD_NAME_GUARDS, ...limits };
}

const BAD_REQUEST_CODES = new Set([
  'LIMIT_PART_COUNT',
  'LIMIT_FILE_COUNT',
  'LIMIT_FIELD_KEY',
  'LIMIT_FIELD_VALUE',
  'LIMIT_FIELD_COUNT',
  'LIMIT_UNEXPECTED_FILE',
  'MISSING_FIELD_NAME',
  'LIMIT_FIELD_NESTING',
  'LIMIT_FIELD_ARRAY_INDEX',
  'INVALID_FIELD_NAME',
]);

/**
 * 按 code 把 multer 错误映射成 HTTP 状态。这是给 @nestjs/platform-express 10 打的补丁（它按英文文案认错误，multer 2.4.0 改了
 * 文案、2.2 / 2.3 又加了新码，认不出就原样抛 → 500）。Nest 12 的 FileInterceptor 已经自己按 code 映射，走它的上传不会再落到这里；
 * 留着兜「不经 FileInterceptor 抛出的 MulterError」，单测照旧覆盖。
 * STREAM_DESTROYED 以及 Request aborted / closed 这类存储侧、连接侧错误保持 500。
 */
export function multerErrorToHttp(error: unknown): HttpException | null {
  if (!(error instanceof Error) || error.name !== 'MulterError') return null;
  const code = (error as Error & { code?: unknown }).code;
  if (code === 'LIMIT_FILE_SIZE') return new PayloadTooLargeException(error.message);
  if (typeof code === 'string' && BAD_REQUEST_CODES.has(code)) return new BadRequestException(error.message);
  return null;
}
