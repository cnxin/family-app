// 访客门面（J4 第四批）：实现在 apps/api/src/guests/guests.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：小管家（读工具 get_upcoming_visits，要 manage_guests）。
import type { PluginActor } from './kernel';

export interface UpcomingVisitView {
  id: string;
  title: string;
  /** ISO 时间 */
  startsAt: string;
  endsAt: string | null;
  /** 来访那天（家庭时区，YYYY-MM-DD） */
  date: string;
  host: string | null;
  /** 受邀访客的称呼 */
  guests: string[];
  /** 回复了会来的人数 */
  attending: number;
  /** 来访那天家里点过菜没有（与今天页「访客要来还没定菜」同一个口径） */
  menuPlanned: boolean;
  /** 访客点的菜里还没处理的 */
  pendingMealRequests: number;
}

export interface GuestsFacade {
  /** 只读：今天起 days 天内、还在安排中的来访，按开始时间排。 */
  upcomingVisits(days: number, actor: PluginActor): Promise<UpcomingVisitView[]>;
}
