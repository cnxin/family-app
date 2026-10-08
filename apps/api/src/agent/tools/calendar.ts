import { BadRequestException } from '@nestjs/common';
import { addDays, todayInShanghai } from '@family/shared';
import { z } from 'zod';
import { dateOnly, defineTool, MAX_RESULT_ITEMS, type AgentToolDeps } from './context';

export const getCalendarTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'get_calendar',
    description: '读取最多 32 天的家庭日历',
    kind: 'read',
    schema: z.object({
      start: z.string().optional(),
      end: z.string().optional(),
    }),
    async execute({ user }, input) {
      const start = dateOnly(input.start, todayInShanghai());
      const end = dateOnly(input.end, addDays(start, 6));
      const days = Math.round(
        (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
          86_400_000,
      );
      if (days < 0 || days > 31) {
        throw new BadRequestException('智能体日历单次最多查询 32 天');
      }
      const entries = await deps.facades.get('calendar').listEntries(start, end, user);
      return entries.slice(0, MAX_RESULT_ITEMS).map((entry) => ({
        module: entry.module,
        date: entry.date,
        title: entry.title,
        status: entry.status,
        summary: entry.summary ? String(entry.summary).slice(0, 200) : null,
        targetPath: entry.targetPath,
      }));
    },
  });
