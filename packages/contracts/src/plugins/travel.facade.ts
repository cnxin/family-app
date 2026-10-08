// 出行门面（J4.1）：实现在 apps/api/src/travel/travel.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：小管家（get_travel_checklist）。
import type { PluginActor } from './kernel';

/** 一个行程和它的协作清单（小管家用到的字段）。 */
export interface TravelChecklistView {
  id: string;
  title: string;
  destination: string | null;
  startDate: string;
  endDate: string;
  status: string;
  items: {
    id: string;
    title: string;
    category: string;
    quantity: number;
    status: string;
    assignedMember?: { name: string } | null;
  }[];
}

export interface TravelFacade {
  /** 与 GET /travel/:id 同一个实现；不存在或看不到抛 404「出行计划不存在」。 */
  planChecklist(planId: string, actor: PluginActor): Promise<TravelChecklistView>;
}
