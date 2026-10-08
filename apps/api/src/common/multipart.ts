import { BadRequestException, HttpException, PayloadTooLargeException } from '@nestjs/common';
import type { MulterModuleOptions } from '@nestjs/platform-express';

type MultipartLimits = NonNullable<MulterModuleOptions['limits']>;

/**
 * multer 2.2+/2.3+ 新增、默认不开的字段名防护：GHSA-535w-7cp7-47q4 要求显式配置 fieldArrayIndexLimit，
 * fieldNestingDepth 兜 GHSA-72gw-mp4g-v24j 那类深嵌套（只查文本字段名，文件字段不查）。现有 multipart 客户端
 * （web、Plex、黑盒、e2e）都不用 a[b] / a[0] 写法。Nest 10 的 MulterOptions 类型里没有这两个键，靠展开 + as 绕过。
 */
const FIELD_NAME_GUARDS = { fieldNestingDepth: 2, fieldArrayIndexLimit: 20 };

/** 所有 multer 拦截点统一用它包 limits（scripts/multipart.check.ts 会扫 src 校验这一点）。调用方的值优先。 */
export function multipartLimits(limits: MultipartLimits): MultipartLimits {
  return { ...FIELD_NAME_GUARDS, ...limits } as MultipartLimits;
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
 * @nestjs/platform-express 10.4.22 的 transformException 按英文文案认 multer 错误。multer 2.4.0 改了 LIMIT_UNEXPECTED_FILE
 * 的文案，2.2 / 2.3 又加了新码，Nest 10 认不出就原样抛 → 500。这里按 code 兜底（同 Nest 12.1.2 的 multer.utils.ts）。
 * STREAM_DESTROYED 以及 Request aborted / closed 这类存储侧、连接侧错误保持 500。
 */
export function multerErrorToHttp(error: unknown): HttpException | null {
  if (!(error instanceof Error) || error.name !== 'MulterError') return null;
  const code = (error as Error & { code?: unknown }).code;
  if (code === 'LIMIT_FILE_SIZE') return new PayloadTooLargeException(error.message);
  if (typeof code === 'string' && BAD_REQUEST_CODES.has(code)) return new BadRequestException(error.message);
  return null;
}
