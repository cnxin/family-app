import { Injectable } from '@nestjs/common';

/** 插件自己提供的 hasData 判定：家里这个模块有没有数据。 */
export type ModuleHasDataProvider = (householdId: string) => Promise<boolean>;

/**
 * manifest 里 `module.hasData` 为 `{ kind: 'server', id }` 的插件（静态 SQL 表达不了，如智能家居要读环境变量），
 * 在自己的模块里按 id 注册判定函数；内核的 SystemModulesService 按 id 取用，不 import 插件的代码。
 */
@Injectable()
export class ModuleHasDataRegistry {
  private readonly providers = new Map<string, ModuleHasDataProvider>();

  register(id: string, provider: ModuleHasDataProvider) {
    if (this.providers.has(id)) throw new Error(`hasData 判定 ${id} 重复注册`);
    this.providers.set(id, provider);
  }

  get(id: string): ModuleHasDataProvider | undefined {
    return this.providers.get(id);
  }
}
