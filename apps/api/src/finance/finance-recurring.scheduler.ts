import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { addDays } from '@family/shared';
import { DataSource } from 'typeorm';
import { Clock } from '../common/clock';
import { EventBus } from '../events/event-bus';
import { postingCutoff } from './finance-recurring.schedule';
import { FinanceRecurringService } from './finance-recurring.service';

/**
 * 每天自动记账（docs/finance-plan.md §3-K3）：和助理例行任务一样用进程内定时轮询（默认每分钟，测试 100～200ms），
 * 家庭当地 06:00 起落当天到期的那一期；NAS 关机漏跑的几天，下一轮逐期补上，每期一条，靠幂等键不重复。
 * 非自动记账的不在这里落，到期前 3 天进留意，有人点「已付」才落。
 */
@Injectable()
export class FinanceRecurringScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('FinanceRecurring');
  private timer: NodeJS.Timeout | null = null;
  private dispatching = false;
  /** 同一条规则同一天落失败（比如账户被停用）只记一次警告，不每分钟刷屏；第二天或改好之后再试。 */
  private readonly failedOn = new Map<string, string>();

  constructor(
    private readonly recurring: FinanceRecurringService,
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
    private readonly bus: EventBus,
  ) {}

  onApplicationBootstrap() {
    const configured = Number(process.env.FINANCE_RECURRING_POLL_INTERVAL_MS || 60_000);
    const interval = Number.isFinite(configured) ? Math.max(100, Math.min(configured, 3_600_000)) : 60_000;
    void this.dispatchDue();
    this.timer = setInterval(() => void this.dispatchDue(), interval);
    this.timer.unref();
    this.logger.log(`finance_recurring_scheduler_started interval=${interval}ms`);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async dispatchDue() {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      const now = this.clock.now();
      // 粗筛：任何时区的 cutoff 都不会晚于 UTC 的明天；各家庭再按自己的时区判
      const candidates: { id: string; householdId: string; timezone: string | null }[] = await this.dataSource.query(
        `SELECT r.id, r."householdId", h.timezone
           FROM finance_recurring r
           JOIN households h ON h.id = r."householdId"
          WHERE r."isActive" AND r."autoPost" AND r."nextDueOn" <= $1::date
          ORDER BY r."nextDueOn", r.id
          LIMIT 200`,
        [addDays(now.toISOString().slice(0, 10), 1)],
      );
      const touched = new Set<string>();
      for (const row of candidates) {
        const cutoff = postingCutoff(row.timezone || 'Asia/Shanghai', now);
        if (this.failedOn.get(row.id) === cutoff) continue;
        try {
          if ((await this.recurring.postDue(row.id, cutoff)) > 0) touched.add(row.householdId);
          this.failedOn.delete(row.id);
        } catch (error) {
          this.failedOn.set(row.id, cutoff);
          this.logger.warn(
            `finance_recurring_post_failed recurring=${row.id} ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      // 调度没有经过 HTTP 拦截器：自己告诉家里人财务有变化
      for (const householdId of touched) this.bus.publish({ householdId, domains: ['finance'] });
    } catch (error) {
      this.logger.warn(`finance_recurring_dispatch_failed ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.dispatching = false;
    }
  }
}
