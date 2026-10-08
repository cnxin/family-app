import { BadRequestException } from '@nestjs/common';
import { addDays, todayInShanghai } from '@family/shared';
import { z } from 'zod';
import {
  boundedInteger,
  dateOnly,
  defineTool,
  limited,
  MAX_EXTENDED_RESULT_ITEMS,
  requireHouseholdMember,
  type AgentToolDeps,
} from './context';

export const getTasksTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'get_tasks',
    description: '查询全家所有成员最多 32 天的家庭任务和完成状态；用户询问全家或家庭任务时使用，询问本人任务时应使用 get_member_tasks',
    kind: 'read',
    schema: z.object({
      start: z.string().optional(),
      end: z.string().optional(),
      includeCompleted: z.boolean().optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    async execute({ user }, input) {
      const start = dateOnly(input.start, todayInShanghai());
      const end = dateOnly(input.end, addDays(start, 6));
      const days = Math.round(
        (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
          86_400_000,
      );
      if (days < 0 || days > 31) {
        throw new BadRequestException('智能体任务单次最多查询 32 天');
      }
      const includeCompleted = input.includeCompleted === true;
      const rows = await deps.facades.get('tasks').listOccurrences(start, end, user);
      return rows
        .filter((row) => includeCompleted || row.status === 'pending')
        .slice(0, limited(input.limit))
        .map((row) => ({
          id: row.id,
          taskId: row.taskId,
          title: row.task.title,
          dueDate: row.dueDate,
          status: row.status,
          assigneeName: row.assignee?.name ?? row.task.defaultAssignee?.name ?? null,
          rewardPoints: row.task.rewardPoints,
          targetPath: `/tasks?date=${row.dueDate}&taskId=${row.taskId}`,
        }));
    },
  });

export const getMemberTasksTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'get_member_tasks',
    description: '查询当前成员本人（默认）或指定同家庭成员的待办/已完成任务；用户说“我的任务”时必须使用本工具，不应使用 get_tasks',
    kind: 'read',
    schema: z.object({
      memberId: z.string().uuid().optional(),
      status: z.enum(['pending', 'completed', 'all']).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    async execute({ user }, input) {
      const memberId =
        typeof input.memberId === 'string' ? input.memberId : user.memberId;
      const member = await requireHouseholdMember(deps, memberId, user);
      const status = input.status ?? 'pending';
      if (!['pending', 'completed', 'all'].includes(String(status))) {
        throw new BadRequestException('不支持的任务状态');
      }
      const limit = boundedInteger(
        input.limit,
        20,
        MAX_EXTENDED_RESULT_ITEMS,
        '返回条数',
      );
      const start = addDays(todayInShanghai(), -90);
      const end = addDays(todayInShanghai(), 90);
      const rows = await deps.facades.get('tasks').listOccurrences(start, end, user);
      const matched = rows.filter((row) => {
        if (row.assigneeId !== member.id) return false;
        if (status === 'pending') return row.status === 'pending';
        if (status === 'completed') return row.status === 'done';
        return true;
      });
      return {
        tasks: matched.slice(0, limit).map((row) => ({
          id: row.id,
          taskId: row.taskId,
          title: row.task.title,
          dueDate: row.dueDate,
          status: row.status === 'done' ? 'completed' : row.status,
          priority: row.task.rewardPoints > 0 ? 'rewarded' : 'normal',
          assignedToMemberId: member.id,
          assignedMemberName: member.name,
          targetPath: `/tasks?date=${row.dueDate}&taskId=${row.taskId}`,
          untrustedContent: true,
        })),
        total: matched.length,
      };
    },
  });

export const proposeTaskTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'propose_task',
    description: '生成家庭任务提案，等待成员在 Family App 内确认',
    kind: 'propose',
    schema: z.object({
      title: z.string().min(1).max(120),
      note: z.string().max(1000).nullable().optional(),
      startsOn: z.string(),
      recurrence: z.enum(['once', 'daily', 'weekly', 'monthly']).optional(),
      repeatInterval: z.number().int().min(1).max(365).optional(),
      endsOn: z.string().nullable().optional(),
      defaultAssigneeId: z.string().uuid().nullable().optional(),
      rewardPoints: z.number().int().min(0).max(10_000).optional(),
    }),
    async execute(ctx, input) {
      const presented = await deps.proposals.createFromRun('propose_task', input, ctx.run, ctx.user);
      ctx.onProposal?.(presented);
      return ctx.receipt(presented.id);
    },
  });
