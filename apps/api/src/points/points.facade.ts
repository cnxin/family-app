import type { PointsFacade } from '@family/contracts';
import { addDays, householdToday, startOfHouseholdDay } from '@family/shared';
import { DataSource, In } from 'typeorm';
import { Household, Member, PointsAccount, PointsLedger, RewardRedemption } from '../entities';

/** 家庭时区里这一周的周一（YYYY-MM-DD）。 */
function mondayOf(today: string) {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, -((weekday + 6) % 7));
}

/**
 * 积分门面的实现（J4 第四批，接口见 contracts/plugins/points.facade.ts），PointsModule 启动时注册。
 * 只读：不像 GET /points/accounts 那样给没开户的成员补账户（没账户按 0）。
 */
export function pointsFacade(db: DataSource): PointsFacade {
  return {
    async summary(memberId, actor) {
      const household = await db.getRepository(Household).findOneByOrFail({ id: actor.householdId });
      const weekStart = mondayOf(householdToday(household.timezone));
      const since = startOfHouseholdDay(household.timezone, weekStart);
      const members = await db.getRepository(Member).find({
        where: { householdId: actor.householdId, ...(memberId ? { id: memberId } : {}) },
        order: { createdAt: 'ASC' },
      });
      const active = members.filter((member) => !member.disabledAt);
      const ids = active.map((member) => member.id);
      const accounts = ids.length
        ? await db.getRepository(PointsAccount).find({ where: { householdId: actor.householdId, memberId: In(ids) } })
        : [];
      const earned: { memberId: string; earned: string }[] = ids.length
        ? await db
            .getRepository(PointsLedger)
            .createQueryBuilder('ledger')
            .select('ledger.memberId', 'memberId')
            .addSelect('COALESCE(SUM(ledger.delta), 0)', 'earned')
            .where('ledger.householdId = :householdId', { householdId: actor.householdId })
            .andWhere('ledger.memberId IN (:...ids)', { ids })
            .andWhere("ledger.type IN ('award', 'adjustment')")
            .andWhere('ledger.delta > 0')
            .andWhere('ledger.createdAt >= :since', { since })
            .groupBy('ledger.memberId')
            .getRawMany()
        : [];
      const balance = new Map(accounts.map((account) => [account.memberId, Number(account.balance)]));
      const week = new Map(earned.map((row) => [row.memberId, Number(row.earned)]));
      const pending = ids.length
        ? await db.getRepository(RewardRedemption).find({
            where: { householdId: actor.householdId, status: 'pending', memberId: In(ids) },
            relations: { member: true },
            order: { createdAt: 'ASC' },
            take: 20,
          })
        : [];
      return {
        weekStart,
        members: active
          .map((member) => ({
            memberId: member.id,
            name: member.name,
            balance: balance.get(member.id) ?? 0,
            earnedThisWeek: week.get(member.id) ?? 0,
          }))
          .sort((left, right) => right.balance - left.balance),
        pendingRedemptions: pending.map((redemption) => ({
          id: redemption.id,
          memberId: redemption.memberId,
          memberName: redemption.member?.name ?? '',
          rewardName: redemption.rewardName,
          cost: Number(redemption.cost),
          requestedAt: redemption.createdAt.toISOString(),
        })),
      };
    },
  };
}
