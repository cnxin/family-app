// 回忆门面（J4.1）：实现在 apps/api/src/memories/memories.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：小管家（get_recent_memories）。
import type { PluginActor } from './kernel';

/** 一条家庭回忆的非敏感字段（小管家用到的）。 */
export interface MemoryEntryView {
  id: string;
  title: string;
  happenedOn: string;
  category: string;
  tags: string[];
}

export interface MemoriesFacade {
  /** 与 GET /memories?status=active&limit 同一个实现：最近的回忆。 */
  listRecent(limit: number, actor: PluginActor): Promise<MemoryEntryView[]>;
}
