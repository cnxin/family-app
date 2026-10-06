import type { CalendarFacade } from '@family/contracts';
import type { CalendarService } from './calendar.module';

/**
 * 日历门面的实现（J1b）：提醒通过 PluginFacadeRegistry 取，不 import 日历目录。
 * 注册在 calendar.module.ts 的 CalendarFacadeProvider 里。
 */
export function calendarFacade(calendar: CalendarService): CalendarFacade {
  return {
    listEntries: (start, end, actor) => calendar.list(start, end, actor),
  };
}
