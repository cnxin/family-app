import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { EventBus, InProcessEventBus } from './event-bus';
import { EventsController } from './events.controller';
import { EventsInterceptor } from './events.interceptor';
import { EventsService } from './events.service';

/** /events 事件通道。全局导出 EventBus 供业务模块显式发事件；本模块不依赖任何业务模块。 */
@Global()
@Module({
  controllers: [EventsController],
  providers: [
    { provide: EventBus, useClass: InProcessEventBus },
    EventsService,
    { provide: APP_INTERCEPTOR, useClass: EventsInterceptor },
  ],
  exports: [EventBus, EventsService],
})
export class EventsModule {}
