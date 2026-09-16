import { BadRequestException, Body, Param, PipeTransform, Query } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * 用 `packages/contracts` 里的 schema 校验请求，替代 class-validator 的 DTO。
 *
 * 为什么能平替：全局 `ValidationPipe` 开的是 `{ whitelist: true, transform: true }`，
 * whitelist 丢掉未声明字段——Zod 的 `z.object` 默认同样丢；`@IsOptional()` 同时放过
 * undefined 和 null——对应 `.nullish()`。所以逐个端点换过去时，**只要契约和 DTO 的约束
 * 一一对上**，行为不变；对不上的地方要先补契约（比如 `voteBody` 补的去重约束原本是
 * `@ArrayUnique()`），不能默认契约是对的。
 *
 * 错误形状也保持不变：`BadRequestException(string)` 经 `AllExceptionsFilter` 出来仍是
 * `{ error: { code: 'Bad Request', message } }`，和 class-validator 那条路一致。
 *
 * 被换掉的参数类型是 `z.infer` 出来的类型别名（编译期擦除、metatype 是 Object），
 * 全局 ValidationPipe 对它直接放行，不会跑两遍校验。
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new BadRequestException(
      result.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.') || '$'} ${issue.message}`)
        .join('; '),
    );
  }
}

/** `@ZodBody(createPollBody) body: CreatePollBody` */
export const ZodBody = <T>(schema: ZodType<T>) =>
  Body(new ZodValidationPipe(schema));

/** `@ZodQuery(pollListQuery) query: PollListQuery` */
export const ZodQuery = <T>(schema: ZodType<T>) =>
  Query(new ZodValidationPipe(schema));

/** 单个路径参数：`@ZodParam('id', uuid) id: string` */
export const ZodParam = <T>(name: string, schema: ZodType<T>) =>
  Param(name, new ZodValidationPipe(schema));
