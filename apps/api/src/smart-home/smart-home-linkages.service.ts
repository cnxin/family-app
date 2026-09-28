import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull, In } from 'typeorm';
import type { DomainKey, SmartHomeRules, SmartHomeWebhookBody } from '@family/contracts';
import { householdToday } from '@family/shared';
import { JwtUser } from '../auth/jwt.guard';
import { Clock } from '../common/clock';
import { Member, Notification, ShoppingItem } from '../entities';
import { RemindersService } from '../reminders/reminders.module';
import { ShoppingService } from '../shopping/shopping.module';
import { TasksService } from '../tasks/tasks.module';

export interface LinkageOutcome {
  status: 'processed' | 'ignored';
  result: string;
  /** 联动写了哪些域；webhook 没有登录用户、拦截器不发事件，由调用方显式发 */
  domains: DomainKey[];
}

const LAUNDRY_TASK = '晾衣服';
const FILTER_TASK = '换净水器滤芯';
const FILTER_ITEM = '净水器滤芯';

/**
 * E3 首批三条联动（pre-trial-plan H3）。写死在服务端，设置页只能开关；不做通用规则引擎。
 * 产生的对象一律走各域现有的服务，以家庭主人的名义、显示名「智能家居联动」。
 */
@Injectable()
export class SmartHomeLinkagesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
    private readonly tasks: TasksService,
    private readonly shopping: ShoppingService,
    private readonly reminders: RemindersService,
  ) {}

  async run(householdId: string, body: SmartHomeWebhookBody, rules: SmartHomeRules): Promise<LinkageOutcome> {
    if (body.event === 'ping') return { status: 'processed', result: '连通了', domains: [] };
    const rule = { laundry_done: rules.laundry, vacuum_done: rules.vacuum, filter_low: rules.filter }[body.event];
    if (!rule.enabled) return { status: 'ignored', result: '这条联动在设置里关着', domains: [] };
    const actor = await this.actor(householdId);
    if (!actor) return { status: 'ignored', result: '家里没有在用的家庭主人', domains: [] };
    const today = await this.today(householdId);
    if (body.event === 'laundry_done') return this.laundryDone(actor, today, body.appliance);
    if (body.event === 'vacuum_done') return this.vacuumDone(actor, today);
    return this.filterLow(actor, today, body.value);
  }

  /** 洗完 / 烘完：通知全家 + 今天一件「晾衣服」（今天已有没做的就不重复建）。 */
  private async laundryDone(actor: JwtUser, today: string, appliance?: 'washer' | 'dryer'): Promise<LinkageOutcome> {
    const label = appliance === 'dryer' ? '烘干机' : appliance === 'washer' ? '洗衣机' : '洗衣';
    const existing = await this.pendingToday(actor, today, (title) => title === LAUNDRY_TASK);
    return this.dataSource.transaction(async (manager) => {
      const taskId =
        existing[0]?.taskId ??
        (await this.tasks.createWithinTransaction({ title: LAUNDRY_TASK, startsOn: today }, actor, manager));
      const notified = await this.notifyAll(manager, actor.householdId, {
        type: 'smart_home_laundry_done',
        title: `${label}完成了，记得晾衣服`,
        sourceId: taskId,
        targetPath: `/schedule/tasks?date=${today}&taskId=${taskId}`,
      });
      return {
        status: 'processed',
        result: `${existing.length ? `今天已有「${LAUNDRY_TASK}」` : `建了家务「${LAUNDRY_TASK}」`}，通知了 ${notified} 人`,
        domains: ['tasks', 'calendar', 'notifications'],
      };
    });
  }

  /** 扫完：今天名字里有「扫地」、还没做的家务都打勾；没有就什么都不做。 */
  private async vacuumDone(actor: JwtUser, today: string): Promise<LinkageOutcome> {
    const targets = await this.pendingToday(actor, today, (title) => title.includes('扫地'));
    if (!targets.length) return { status: 'ignored', result: '今天没有待做的「扫地」家务', domains: [] };
    for (const target of targets) {
      await this.tasks.updateOccurrence(target.taskId, today, { status: 'done' }, actor);
    }
    return {
      status: 'processed',
      result: `打勾了 ${targets.map((target) => `「${target.title}」`).join('、')}`,
      domains: ['tasks', 'calendar', 'points', 'notifications'],
    };
  }

  /** 滤芯低：今天一件「换净水器滤芯」+ 马上提醒管理员；购物清单里没有没买的滤芯就加一个。 */
  private async filterLow(actor: JwtUser, today: string, value?: number): Promise<LinkageOutcome> {
    const existing = await this.pendingToday(actor, today, (title) => title === FILTER_TASK);
    return this.dataSource.transaction(async (manager) => {
      const done: string[] = [];
      if (!existing.length) {
        const taskId = await this.tasks.createWithinTransaction(
          {
            title: FILTER_TASK,
            startsOn: today,
            note: value == null ? 'Home Assistant 报滤芯快到期了' : `Home Assistant 报滤芯剩 ${value}%`,
          },
          actor,
          manager,
        );
        const recipientIds = await this.activeMemberIds(manager, actor.householdId, ['owner', 'admin']);
        await this.reminders.createWithinTransaction(
          {
            sourceModule: 'task',
            sourceId: taskId,
            occurrenceDate: today,
            // 提醒必须晚于「现在」；一分钟后由提醒派发发出
            remindAt: new Date(Date.now() + 60_000).toISOString(),
            recipientIds,
          },
          actor,
          manager,
        );
        done.push(`建了家务「${FILTER_TASK}」并提醒 ${recipientIds.length} 位管理员`);
      } else {
        done.push(`今天已有「${FILTER_TASK}」`);
      }
      const onList = await manager.getRepository(ShoppingItem).count({
        where: { householdId: actor.householdId, customName: FILTER_ITEM, checked: false },
      });
      if (!onList) {
        await this.shopping.addManualWithinTransaction(
          { date: today, customName: FILTER_ITEM, totalQty: 1, unit: '个' },
          actor.householdId,
          manager,
        );
        done.push(`把「${FILTER_ITEM}」加进了购物清单`);
      } else {
        done.push('购物清单里已经有了');
      }
      return {
        status: 'processed',
        result: done.join('；'),
        domains: ['tasks', 'calendar', 'reminders', 'shopping', 'notifications'],
      };
    });
  }

  private async pendingToday(actor: JwtUser, today: string, match: (title: string) => boolean) {
    const occurrences = await this.tasks.list(today, today, actor);
    return occurrences
      .filter((occurrence) => occurrence.status === 'pending' && match(occurrence.task.title))
      .map((occurrence) => ({ taskId: occurrence.taskId, title: occurrence.task.title }));
  }

  private async notifyAll(
    manager: EntityManager,
    householdId: string,
    input: { type: string; title: string; sourceId: string; targetPath: string },
  ) {
    const recipients = await this.activeMemberIds(manager, householdId);
    const notifications = manager.getRepository(Notification);
    await notifications.save(
      recipients.map((recipientId) =>
        notifications.create({
          householdId,
          recipientId,
          module: 'task',
          type: input.type,
          sourceId: input.sourceId,
          title: input.title.slice(0, 160),
          body: null,
          targetPath: input.targetPath,
        }),
      ),
    );
    return recipients.length;
  }

  private async activeMemberIds(manager: EntityManager, householdId: string, roles?: Member['role'][]) {
    const members = await manager.getRepository(Member).find({
      where: { householdId, disabledAt: IsNull(), ...(roles ? { role: In(roles) } : {}) },
      select: { id: true },
      order: { createdAt: 'ASC' },
    });
    return members.map((member) => member.id);
  }

  /** 以最早的在用家庭主人的名义执行（webhook 没有登录用户），显示名标明是联动做的。 */
  private async actor(householdId: string): Promise<JwtUser | null> {
    const owner = await this.dataSource.getRepository(Member).findOne({
      where: { householdId, role: 'owner', disabledAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
    if (!owner) return null;
    return { sub: '', accountId: '', memberId: owner.id, householdId, sid: '', name: '智能家居联动', role: 'owner' };
  }

  private async today(householdId: string) {
    const [row]: { timezone: string | null }[] = await this.dataSource.query(
      'SELECT timezone FROM households WHERE id = $1',
      [householdId],
    );
    return householdToday(row?.timezone || 'Asia/Shanghai', this.clock.now());
  }
}
