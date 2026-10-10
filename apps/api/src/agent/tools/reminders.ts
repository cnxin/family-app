import { addDays, startOfHouseholdDay, todayInShanghai } from '@family/shared';
import { z } from 'zod';
import { defineTool, MAX_RESULT_ITEMS, requireHouseholdMember, type AgentToolDeps } from './context';

const localTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** J4 第四批：今天或接下来 7 天要提醒的事（不含已取消），可按被提醒的成员筛。 */
export const getRemindersTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'get_reminders',
    description: '读取家庭提醒：今天（range=today）或从今天起 7 天（range=week）要提醒、已经提醒过的事，含提醒时间、挂在哪个模块的事项上、提醒谁；memberId 只看提醒这个成员的。回答「有什么提醒」「几点提醒」前调用本工具。',
    kind: 'read',
    schema: z.object({
      range: z.enum(['today', 'week']).optional(),
      memberId: z.string().uuid().optional(),
    }),
    async execute({ user }, input) {
      const memberId = typeof input.memberId === 'string' ? input.memberId : null;
      if (memberId) await requireHouseholdMember(deps, memberId, user);
      const today = todayInShanghai();
      const from = startOfHouseholdDay('Asia/Shanghai', today);
      const to = startOfHouseholdDay('Asia/Shanghai', addDays(today, input.range === 'week' ? 7 : 1));
      const rows = await deps.facades.get('reminders').listWindow(from.toISOString(), to.toISOString(), user);
      return rows
        .filter((row) => !memberId || row.recipients.some((recipient) => recipient.id === memberId))
        .slice(0, MAX_RESULT_ITEMS)
        .map((row) => ({
          title: row.title ?? '（关联的事项已经不在了）',
          remindAt: row.remindAt,
          localTime: localTime.format(new Date(row.remindAt)),
          status: row.status,
          sourceModule: row.sourceModule,
          recipients: row.recipients.map((recipient) => recipient.name),
          targetPath: row.targetPath,
        }));
    },
  });

export const proposeReminderTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'propose_reminder',
    description: '为现有家庭事项生成提醒提案',
    kind: 'propose',
    schema: z.object({
      sourceModule: z.enum([
        'menu',
        'task',
        'calendar',
        'poll',
        'maintenance',
        'travel',
      ]),
      sourceId: z.string().uuid(),
      occurrenceDate: z.string().nullable().optional(),
      remindAt: z.string(),
      recipientIds: z.array(z.string().uuid()).min(1).max(20),
    }),
    async execute(ctx, input) {
      const presented = await deps.proposals.createFromRun('propose_reminder', input, ctx.run, ctx.user);
      ctx.onProposal?.(presented);
      return ctx.receipt(presented.id);
    },
  });
