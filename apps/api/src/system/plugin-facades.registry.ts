import { Injectable } from '@nestjs/common';
import type { PluginFacadeKey, PluginFacades, PluginTransaction } from '@family/contracts';
import type { EntityManager } from 'typeorm';

/**
 * 门面注册表（J1b，docs/architecture.md §9）：插件之间「读」和「同步调用」的唯一通道。
 * 提供方在自己目录里实现 contracts/plugins/<key>.facade.ts 的接口，onModuleInit 时 register；
 * 消费方注入本注册表、用到时再 get（不在构造时取：提供方可能还没初始化），manifest 声明 dependsOn。
 * 消费方不 import 提供方目录的任何文件。
 */
@Injectable()
export class PluginFacadeRegistry {
  private readonly facades = new Map<string, unknown>();

  register<K extends PluginFacadeKey>(key: K, facade: PluginFacades[K]): void {
    if (this.facades.has(key)) throw new Error(`门面 ${String(key)} 重复注册`);
    this.facades.set(key, facade);
  }

  get<K extends PluginFacadeKey>(key: K): PluginFacades[K] {
    if (!this.facades.has(key)) throw new Error(`门面 ${String(key)} 没有注册（提供方插件没有加载？）`);
    return this.facades.get(key) as PluginFacades[K];
  }
}

/** 把 TypeORM 的事务交给门面（contracts 里是不透明的 PluginTransaction）。 */
export function toPluginTransaction(manager: EntityManager): PluginTransaction {
  return manager as unknown as PluginTransaction;
}

/** 门面实现里把不透明句柄还原成 EntityManager。 */
export function fromPluginTransaction(transaction: PluginTransaction): EntityManager {
  return transaction as unknown as EntityManager;
}
