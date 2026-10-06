import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { DomainKey, PluginEventName, PluginEventPayloads } from '@family/contracts';

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
  /**
   * 插件事件（J1b，docs/architecture.md §9）：事务提交后发，订阅方异步执行、出错只记日志，发起方不等也不受影响。
   * 事件名与 payload 只在 contracts（PluginEventPayloads）定义；订阅方不 import 发起方的目录。
   */
  abstract emit<N extends PluginEventName>(name: N, payload: PluginEventPayloads[N]): void;
  abstract on<N extends PluginEventName>(
    name: N,
    listener: (payload: PluginEventPayloads[N]) => Promise<void> | void,
  ): () => void;
}

@Injectable()
export class InProcessEventBus extends EventBus {
  private readonly emitter = new EventEmitter().setMaxListeners(0);
  private readonly logger = new Logger('EventBus');
  private readonly pluginListeners = new Map<string, Set<(payload: never) => Promise<void> | void>>();

  publish(change: HouseholdChange): void {
    if (!change.householdId || change.domains.length === 0) return;
    this.emitter.emit('change', change);
  }

  subscribe(listener: (change: HouseholdChange) => void): () => void {
    this.emitter.on('change', listener);
    return () => this.emitter.off('change', listener);
  }

  // 插件事件沿用原来任务模块 TaskEvents 的语义：每个监听方各自 setImmediate 异步跑，出错只记一句警告
  emit<N extends PluginEventName>(name: N, payload: PluginEventPayloads[N]): void {
    for (const listener of this.pluginListeners.get(name) ?? []) {
      setImmediate(() => {
        Promise.resolve()
          .then(() => (listener as (payload: PluginEventPayloads[N]) => Promise<void> | void)(payload))
          .catch((error) =>
            this.logger.warn(
              `plugin_event_listener_failed event=${name} ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
      });
    }
  }

  on<N extends PluginEventName>(
    name: N,
    listener: (payload: PluginEventPayloads[N]) => Promise<void> | void,
  ): () => void {
    const listeners = this.pluginListeners.get(name) ?? new Set();
    listeners.add(listener as (payload: never) => Promise<void> | void);
    this.pluginListeners.set(name, listeners);
    return () => listeners.delete(listener as (payload: never) => Promise<void> | void);
  }
}
