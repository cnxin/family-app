// 积分门面（J4 第四批）：实现在 apps/api/src/points/points.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：小管家（读工具 get_points_summary）。
import type { PluginActor } from './kernel';

export interface PointsMemberView {
  memberId: string;
  name: string;
  balance: number;
  /** 本周（家庭时区周一 0 点起）获得的：奖励与加分调整里为正的那些 */
  earnedThisWeek: number;
}

export interface PointsRedemptionView {
  id: string;
  memberId: string;
  memberName: string;
  rewardName: string;
  cost: number;
  /** ISO 时间 */
  requestedAt: string;
}

export interface PointsSummaryView {
  /** 本周从哪天算起（YYYY-MM-DD） */
  weekStart: string;
  members: PointsMemberView[];
  pendingRedemptions: PointsRedemptionView[];
}

export interface PointsFacade {
  /** 只读：各成员余额（还没开户的按 0，不建账户）、本周获得、待审批的兑换；memberId 给了只看这个人。 */
  summary(memberId: string | null, actor: PluginActor): Promise<PointsSummaryView>;
}
