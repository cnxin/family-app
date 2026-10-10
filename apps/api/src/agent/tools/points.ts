import { z } from 'zod';
import { defineTool, requireHouseholdMember, type AgentToolDeps } from './context';

/** J4 第四批：积分余额、本周获得、待审批的兑换。 */
export const getPointsSummaryTool = (deps: AgentToolDeps) =>
  defineTool({
    name: 'get_points_summary',
    description: '读取家庭积分：每个成员的积分余额、本周（周一起）获得的积分、还在等审批的奖励兑换；memberId 只看这个成员。回答积分多少、谁的兑换没批前调用本工具。',
    kind: 'read',
    schema: z.object({
      memberId: z.string().uuid().optional(),
    }),
    async execute({ user }, input) {
      const memberId = typeof input.memberId === 'string' ? input.memberId : null;
      if (memberId) await requireHouseholdMember(deps, memberId, user);
      const summary = await deps.facades.get('points').summary(memberId, user);
      return {
        weekStart: summary.weekStart,
        members: summary.members.map((member) => ({
          name: member.name,
          balance: member.balance,
          earnedThisWeek: member.earnedThisWeek,
        })),
        pendingRedemptions: summary.pendingRedemptions.map((redemption) => ({
          member: redemption.memberName,
          reward: redemption.rewardName,
          cost: redemption.cost,
          requestedAt: redemption.requestedAt,
        })),
        targetPath: '/house/points',
      };
    },
  });
