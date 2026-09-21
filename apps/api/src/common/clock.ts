import { Global, Injectable, Module } from '@nestjs/common';

/** 请求/调度中可覆写的时钟；业务只调用 now() 获取真实当前时刻。 */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}

@Global()
@Module({ providers: [Clock], exports: [Clock] })
export class ClockModule {}
