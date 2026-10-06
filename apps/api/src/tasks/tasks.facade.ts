import type { TasksFacade } from '@family/contracts';
import type { TasksService } from './tasks.module';

/**
 * 任务门面的实现（J1b）：日历、智能家居通过 PluginFacadeRegistry 取，不 import 任务目录。
 * 注册在 tasks.module.ts 的 TasksFacadeProvider 里（放在服务定义之后，免得两个文件互相 import）。
 */
export function tasksFacade(tasks: TasksService): TasksFacade {
  return {
    listOccurrences: (start, end, actor) => tasks.list(start, end, actor),
  };
}
