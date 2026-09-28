import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { DomainKey } from '@family/contracts';

/** 某个家庭的这些域有写入。只说「哪个域变了」，不带数据。 */
export interface HouseholdChange {
  householdId: string;
  domains: readonly DomainKey[];
  /** 发起写入的成员；后台任务、访客、webhook 触发时为空。 */
  actor?: string;
}

/**
 * 事件总线。业务模块依赖它发事件，它不依赖任何业务模块。
 * 单进程部署用进程内实现就够；将来多实例换成 Redis 之类，只换实现，不动调用方。
 */
export abstract class EventBus {
  abstract publish(change: HouseholdChange): void;
  abstract subscribe(listener: (change: HouseholdChange) => void): () => void;
}

@Injectable()
export class InProcessEventBus extends EventBus {
  private readonly emitter = new EventEmitter().setMaxListeners(0);

  publish(change: HouseholdChange): void {
    if (!change.householdId || change.domains.length === 0) return;
    this.emitter.emit('change', change);
  }

  subscribe(listener: (change: HouseholdChange) => void): () => void {
    this.emitter.on('change', listener);
    return () => this.emitter.off('change', listener);
  }
}
