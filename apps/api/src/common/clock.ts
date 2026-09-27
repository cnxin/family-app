import { AsyncLocalStorage } from 'node:async_hooks';
import { Global, Injectable, MiddlewareConsumer, Module, NestMiddleware, NestModule } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/** 可覆写时钟。生产环境永远取系统时钟；测试请求在隔离库中可冻结当前时刻。 */
@Injectable()
export class Clock {
  private readonly requestTime = new AsyncLocalStorage<Date>();

  now(): Date {
    return this.requestTime.getStore() ?? new Date();
  }

  runAt(now: Date, callback: () => void): void {
    this.requestTime.run(now, callback);
  }
}

@Injectable()
class IsolatedTestClockMiddleware implements NestMiddleware {
  constructor(private readonly clock: Clock) {}

  use(request: Request, _response: Response, next: NextFunction): void {
    const allowed = process.env.NODE_ENV === 'test' &&
      /^family_app_(?:web_)?test_[a-f0-9]+$/.test(process.env.DB_NAME ?? '');
    const raw = request.header('x-test-clock');
    if (!allowed || !raw || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(raw)) {
      next();
      return;
    }
    const instant = new Date(raw);
    if (Number.isNaN(instant.getTime())) {
      next();
      return;
    }
    this.clock.runAt(instant, next);
  }
}

@Global()
@Module({ providers: [Clock, IsolatedTestClockMiddleware], exports: [Clock] })
export class ClockModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(IsolatedTestClockMiddleware).forRoutes('*');
  }
}
