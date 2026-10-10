import { z } from 'zod';
import { boundedInteger, defineTool, MAX_RESULT_ITEMS, type AgentToolDeps } from './context';

/** J4 第四批：接下来要来的客人（要 manage_guests，manifest 声明）。 */
export const getUpcomingVisitsTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'get_upcoming_visits',
    description: '读取接下来的来访安排：从今天起 days 天内（默认 14，最多 60）哪天、谁来、谁接待、几个人回复会来、那天家里点过菜没有、访客点的菜还有几道没处理。回答「最近谁来家里」「客人来那天定菜了吗」前调用本工具。',
    kind: 'read',
    schema: z.object({
      days: z.number().int().min(1).max(60).optional(),
    }),
    async execute({ user }, input) {
      const days = boundedInteger(input.days, 14, 60, '天数');
      const visits = await deps.facades.get('guests').upcomingVisits(days, user);
      return visits.slice(0, MAX_RESULT_ITEMS).map((visit) => ({
        date: visit.date,
        startsAt: visit.startsAt,
        title: visit.title,
        host: visit.host,
        guests: visit.guests.slice(0, 10),
        attending: visit.attending,
        menuPlanned: visit.menuPlanned,
        pendingMealRequests: visit.pendingMealRequests,
        targetPath: '/house/guests',
      }));
    },
  });
