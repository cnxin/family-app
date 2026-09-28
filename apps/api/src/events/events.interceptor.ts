import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { eventRouteFor } from '@family/contracts';
import type { JwtUser } from '../auth/jwt.guard';
import { EventBus } from './event-bus';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * 登录用户的写请求成功后，按「路由模板 → 域」映射表（packages/contracts EVENT_ROUTES）发 changed。
 * 访客公开页、webhook、内部通道没有登录用户，映射表里标 emit: 'explicit'，由业务服务自己发。
 */
@Injectable()
export class EventsInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Events');

  constructor(private readonly bus: EventBus) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<Request & { user?: JwtUser }>();
    if (!WRITE_METHODS.has(request.method)) return next.handle();
    return next.handle().pipe(
      tap(() => {
        const template = (request.route as { path?: string } | undefined)?.path;
        const user = request.user;
        if (!template || !user) return;
        const route = eventRouteFor(template);
        if (route === null) {
          // CI 的 check-event-routes 会拦住；运行时只记一笔，不影响请求
          this.logger.warn(`events_route_unmapped ${request.method} ${template}`);
          return;
        }
        if ('exempt' in route || route.emit === 'explicit') return;
        this.bus.publish({ householdId: user.householdId, domains: route.domains, actor: user.memberId });
      }),
    );
  }
}
