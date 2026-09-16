import {
  CallHandler,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  NestInterceptor,
} from '@nestjs/common';
import { contractIndex, contractKey } from '@family/contracts';
import { Observable, map, tap } from 'rxjs';
import { ObservedRequest, StructuredLogger } from './observability';

/**
 * 测试模式下的契约守卫：把处理函数的返回值按 `packages/contracts` 里对应端点的
 * response schema 校验，不符合就返回 500 `CONTRACT_VIOLATION`，让黑盒脚本立刻失败。
 *
 * 只在 NODE_ENV=test 或 CONTRACT_CHECK=1 时启用；生产环境零开销。
 * 没有契约的端点直接放行（覆盖进度见 docs/api-inventory.md 的"契约"列）。
 */
export function contractCheckEnabled() {
  return process.env.NODE_ENV === 'test' || process.env.CONTRACT_CHECK === '1';
}

@Injectable()
export class ContractsInterceptor implements NestInterceptor {
  constructor(private readonly logger: StructuredLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<ObservedRequest & { route?: { path?: string } }>();
    const routePath = request.route?.path;
    if (!routePath) return next.handle();
    const contract = contractIndex.get(contractKey(request.method, routePath));
    if (!contract) return next.handle();

    return next.handle().pipe(
      map((data) => {
        // 按 JSON 序列化后的形态校验（Date → ISO 字符串，undefined 字段消失），
        // 这才是客户端真正拿到的东西
        const serialized: unknown =
          data === undefined ? undefined : JSON.parse(JSON.stringify(data));
        const result = contract.response.safeParse(serialized);
        if (result.success) return data;
        const issues = result.error.issues.slice(0, 5).map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }));
        this.logger.write('error', 'contract_violation', {
          requestId: request.requestContext?.requestId,
          method: request.method,
          path: routePath,
          issues: issues
            .map((issue) => `${issue.path || '$'}: ${issue.message}`)
            .join('; '),
        });
        throw new InternalServerErrorException({
          error: 'CONTRACT_VIOLATION',
          message: `响应不符合契约 ${request.method} ${routePath}：${issues
            .map((issue) => `${issue.path || '$'} ${issue.message}`)
            .join('; ')}`,
        });
      }),
    );
  }
}

/** 请求侧契约检查的三种模式，见 `ContractsRequestInterceptor`。 */
export type ContractRequestCheckMode = 'off' | 'report' | 'enforce';

/**
 * 默认跟随响应侧（测试模式下 enforce），可用 `CONTRACT_REQUEST_CHECK` 覆盖：
 *   report  —— 只记日志，不影响请求结果，用来一次性收集全部不一致
 *   enforce —— 不一致就 500 `CONTRACT_REQUEST_VIOLATION`
 *   off     —— 完全关闭
 */
export function contractRequestCheckMode(): ContractRequestCheckMode {
  const configured = process.env.CONTRACT_REQUEST_CHECK;
  if (
    configured === 'off' ||
    configured === 'report' ||
    configured === 'enforce'
  ) {
    return configured;
  }
  return contractCheckEnabled() ? 'enforce' : 'off';
}


/**
 * 请求侧契约守卫：把客户端实际发来的 params / query / body 按契约校验。
 *
 * 只在处理函数**成功返回**之后才校验，这一点是刻意的：黑盒脚本里有大量故意发非法
 * 载荷、断言 400/409 的用例，它们本来就不该符合契约；只有 API 已经接受了的请求，
 * 契约还拒绝，才说明契约写窄了——而"契约比 API 窄"正是把 class-validator 换成
 * Zod 管道之前唯一需要排掉的风险（契约比 API 宽只会漏过，不会拒真）。
 *
 * 违规按 500 `CONTRACT_REQUEST_VIOLATION` 抛出而不是 400：400 会被那些期待校验失败
 * 的用例当成预期结果吞掉，契约错了反而显得是绿的。
 */
@Injectable()
export class ContractsRequestInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: StructuredLogger,
    private readonly mode: ContractRequestCheckMode = contractRequestCheckMode(),
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.mode === 'off') return next.handle();
    const request = context.switchToHttp().getRequest<
      ObservedRequest & {
        route?: { path?: string };
        params?: unknown;
        query?: unknown;
        body?: unknown;
      }
    >();
    const routePath = request.route?.path;
    if (!routePath) return next.handle();
    const contract = contractIndex.get(contractKey(request.method, routePath));
    if (!contract) return next.handle();
    if (!contract.params && !contract.query && !contract.body) {
      return next.handle();
    }
    return next.handle().pipe(
      tap(() => {
        // 请求数据在这里才读：multipart 的 body 由路由级 FileInterceptor（multer）
        // 解析，而全局拦截器的前置阶段跑在它之前，那时候 body 还是空的。
        const sent = {
          params: request.params,
          query: request.query,
          body: request.body,
        };
        const issues: string[] = [];
        for (const part of ['params', 'query', 'body'] as const) {
          const schema = contract[part];
          if (!schema) continue;
          const result = schema.safeParse(sent[part]);
          if (result.success) continue;
          for (const issue of result.error.issues.slice(0, 3)) {
            issues.push(
              `${part}.${issue.path.join('.') || '$'}: ${issue.message}`,
            );
          }
        }
        if (issues.length === 0) return;
        this.logger.write('error', 'contract_request_violation', {
          requestId: request.requestContext?.requestId,
          method: request.method,
          path: routePath,
          issues: issues.join('; '),
        });
        if (this.mode !== 'enforce') return;
        throw new InternalServerErrorException({
          error: 'CONTRACT_REQUEST_VIOLATION',
          message: `请求不符合契约 ${request.method} ${routePath}：${issues.join(
            '; ',
          )}`,
        });
      }),
    );
  }
}
