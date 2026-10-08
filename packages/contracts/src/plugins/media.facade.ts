// 观影门面（J4.1）：实现在 apps/api/src/media/media.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：小管家（get_watch_candidates）。
import type { PluginActor } from './kernel';

/** 片单里的一条（小管家用到的字段）。 */
export interface WatchEntryView {
  id: string;
  status: string;
  scheduledFor: string | null;
  mediaTitle: { title: string; type: string; year: number | null };
}

export interface MediaFacade {
  /** 与 GET /media?status=all 同一个实现：最近更新的在前，最多 100 条。 */
  listWatchlist(actor: PluginActor): Promise<WatchEntryView[]>;
}
