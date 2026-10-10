import type { GuestsFacade } from '@family/contracts';
import { addDays, householdToday } from '@family/shared';
import type { DataSource } from 'typeorm';
import { Household } from '../entities';
import type { GuestsService } from './guests.module';

/**
 * 访客门面的实现（J4 第四批，接口见 contracts/plugins/guests.facade.ts），GuestsModule 启动时注册。
 * 来访列表复用 GET /visits 的实现；「点过菜没有」与今天页「访客要来还没定菜」同一个口径（那天有带菜的菜单）。
 */
export function guestsFacade(guests: GuestsService, db: DataSource): GuestsFacade {
  return {
    async upcomingVisits(days, actor) {
      const household = await db.getRepository(Household).findOneByOrFail({ id: actor.householdId });
      const today = householdToday(household.timezone);
      const until = addDays(today, days);
      const visits = (await guests.listVisits(actor, 'scheduled'))
        .map((visit) => ({ visit, date: householdToday(household.timezone, new Date(visit.startsAt)) }))
        .filter(({ date }) => date >= today && date < until);
      const dates = [...new Set(visits.map(({ date }) => date))];
      const planned: { date: string }[] = dates.length
        ? await db.query(
            `SELECT DISTINCT m.date::text AS date
               FROM menus m
               JOIN menu_items mi ON mi."menuId" = m.id
              WHERE m."householdId" = $1 AND m.date = ANY($2::date[])`,
            [actor.householdId, dates],
          )
        : [];
      const plannedDates = new Set(planned.map((row) => row.date));
      return visits.map(({ visit, date }) => ({
        id: visit.id,
        title: visit.title,
        startsAt: new Date(visit.startsAt).toISOString(),
        endsAt: visit.endsAt ? new Date(visit.endsAt).toISOString() : null,
        date,
        host: visit.hostMember?.name ?? null,
        guests: visit.guests.map((entry) => entry.guest.name),
        attending: visit.guests.filter((entry) => entry.isAttending === true).length,
        menuPlanned: plannedDates.has(date),
        pendingMealRequests: visit.mealRequests.filter((request) => request.status === 'pending').length,
      }));
    },
  };
}
