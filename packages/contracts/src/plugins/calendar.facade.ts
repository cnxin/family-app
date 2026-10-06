// 日历门面（J1b）：实现在 apps/api/src/calendar/calendar.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：提醒（GET /reminder-sources 把日历上的条目列成「可以加提醒的事」）。
import type { CalendarEntry } from '../calendar';
import type { PluginActor } from './kernel';

/**
 * 消费方实际用到的日历条目字段；实现返回的就是 GET /calendar 那一套对象。
 * status 写成 string：自建日程（module calendar）的状态在服务里就是数据库里的字符串，比契约的枚举宽。
 */
export type CalendarEntryView = Pick<
  CalendarEntry,
  'module' | 'sourceId' | 'title' | 'summary' | 'date' | 'startsAt' | 'targetPath'
> & { status: string };

export interface CalendarFacade {
  /** 与日历列表同一个实现：一段日子里全家的日历条目（菜单、任务、来访、维护、出行……）。 */
  listEntries(start: string, end: string, actor: PluginActor): Promise<CalendarEntryView[]>;
}
