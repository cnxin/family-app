import { Injectable } from '@nestjs/common';
import {
  TRANSACTION_HOOK_NAMES,
  type PluginKey,
  type TransactionHookName,
  type TransactionHookPayloads,
} from '@family/contracts';
import type { EntityManager } from 'typeorm';

export type TransactionHookHandler<N extends TransactionHookName> = (
  payload: TransactionHookPayloads[N],
  manager: EntityManager,
) => Promise<void>;

/**
 * 事务内钩子（J1b，docs/architecture.md §9）：同一事务里要连带写别的插件的东西时用。
 * 发起方在自己的事务里 `await hooks.run(name, payload, manager)`；订阅方在 onModuleInit 里 `on(name, 自己的 key, 回调)`，
 * 回调拿同一个 manager 写自己的表。按注册顺序依次执行，任一回调抛错就原样向上抛，整个事务回滚。
 * 没有订阅方时 run 什么也不做（订阅方插件没加载 = 不连带写）。钩子名与 payload 类型只在 contracts 定义。
 */
@Injectable()
export class TransactionHookRegistry {
  /** 认得的钩子名；单测可以换成自己的名单。 */
  protected names: ReadonlySet<string> = new Set(TRANSACTION_HOOK_NAMES);
  private readonly handlers = new Map<string, { owner: string; handler: TransactionHookHandler<never> }[]>();

  on<N extends TransactionHookName>(name: N, owner: PluginKey, handler: TransactionHookHandler<N>): void {
    this.assertKnown(name);
    const list = this.handlers.get(name) ?? [];
    if (list.some((one) => one.owner === owner)) throw new Error(`插件 ${owner} 重复订阅钩子 ${String(name)}`);
    list.push({ owner, handler: handler as TransactionHookHandler<never> });
    this.handlers.set(name, list);
  }

  async run<N extends TransactionHookName>(name: N, payload: TransactionHookPayloads[N], manager: EntityManager): Promise<void> {
    this.assertKnown(name);
    for (const { handler } of this.handlers.get(name) ?? []) {
      await (handler as TransactionHookHandler<N>)(payload, manager);
    }
  }

  /** 谁订阅了这个钩子（按注册顺序）。 */
  subscribers(name: TransactionHookName): readonly string[] {
    return (this.handlers.get(name) ?? []).map((one) => one.owner);
  }

  private assertKnown(name: string) {
    if (!this.names.has(name)) throw new Error(`钩子 ${name} 不在 contracts 的 TRANSACTION_HOOK_NAMES 里`);
  }
}
