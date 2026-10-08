import type { MemoriesFacade } from '@family/contracts';
import type { MemoriesService } from './memories.module';

/** 回忆门面的实现（J4.1，接口见 contracts/plugins/memories.facade.ts），MemoriesModule 启动时注册。 */
export function memoriesFacade(memories: MemoriesService): MemoriesFacade {
  return {
    listRecent: (limit, actor) => memories.list({ status: 'active', limit }, actor),
  };
}
