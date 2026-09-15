import {
  CallHandler,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  NestInterceptor,
} from '@nestjs/common';
import { contractIndex, contractKey } from '@family/contracts';
import { Observable, map } from 'rxjs';
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
