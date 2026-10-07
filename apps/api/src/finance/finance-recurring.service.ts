import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  CreateFinanceRecurringBody,
  PayFinanceRecurringBody,
  UpdateFinanceRecurringBody,
} from '@family/contracts';
import { addDays, householdToday } from '@family/shared';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { assertCapability } from '../auth/capabilities';
import { JwtUser } from '../auth/jwt.guard';
import { Clock } from '../common/clock';
import {
  FinanceAccount,
  FinanceCategory,
  FinanceRecurring,
  FinanceTransaction,
  Household,
  Member,
} from '../entities';
import { FinanceService } from './finance.service';
import {
  firstOccurrenceOnOrAfter,
  monthlyAverage,
  nextOccurrenceAfter,
  postingCutoff,
  RECURRING_NOTICE_DAYS,
  recurringIdempotencyKey,
} from './finance-recurring.schedule';

function money(value: number | string) {
  return Math.round(Number(value) * 100) / 100;
}

/** 自动记账没有登录用户：以最早的在用家庭主人的名义落流水，显示名标明是自动记的。 */
export const RECURRING_ACTOR_SID = 'finance-recurring';
export const RECURRING_ACTOR_NAME = '自动记账';
/** 一次补跑最多补多少期（周付停了好几年也不会一口气卡住调度），剩下的下一轮接着补。 */
const MAX_CATCH_UP = 400;

/**
 * K3 周期账单（docs/finance-plan.md §2.4、§3-K3）。增删改与自动记账开关只有管理员（manage_finance）；
 * 「已付」是记账，成员也能点（record_finance）。每一期落的流水 sourceType = 'recurring'、
 * idempotencyKey = recurring:<id>:<那一期>，自动落、手点、补跑都只有一笔。
 */
@Injectable()
export class FinanceRecurringService {
  constructor(
    @InjectRepository(FinanceRecurring)
    private readonly rules: Repository<FinanceRecurring>,
    private readonly finance: FinanceService,
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  async list(user: JwtUser) {
    const today = await this.today(user.householdId);
    const rows = await this.rules.find({
      where: { householdId: user.householdId },
      relations: { account: true, category: true },
      order: { isActive: 'DESC', nextDueOn: 'ASC', createdAt: 'ASC' },
    });
    return rows.map((row) => this.present(row, today));
  }

  async create(body: CreateFinanceRecurringBody, user: JwtUser) {
    const today = await this.today(user.householdId);
    const id = await this.dataSource.transaction(async (manager) => {
      await this.requireReferences(manager, user.householdId, body.accountId, body.categoryId, body.type);
      const repository = manager.getRepository(FinanceRecurring);
      const saved = await repository.save(
        repository.create({
          householdId: user.householdId,
          title: body.title,
          type: body.type,
          amount: money(body.amount).toFixed(2),
          accountId: body.accountId,
          categoryId: body.categoryId,
          cadence: body.cadence,
          anchorOn: body.anchorOn,
          // 第一次应付日早于今天时不往回补：从不早于今天的那一期开始
          nextDueOn: firstOccurrenceOnOrAfter(body.anchorOn, body.cadence, today),
          autoPost: body.autoPost ?? false,
          lastPostedOn: null,
          isActive: true,
          version: 1,
          createdById: user.memberId,
          updatedById: user.memberId,
        }),
      );
      await recordActivity(manager, user, {
        module: 'finance',
        action: 'finance_recurring_created',
        summary: `${user.name}新增了周期账单「${saved.title}」`,
        targetPath: '/house/finance?view=recurring',
        metadata: { recurringId: saved.id, cadence: saved.cadence, autoPost: saved.autoPost },
      });
      return saved.id;
    });
    return this.findOne(id, user.householdId, today);
  }

  async update(id: string, body: UpdateFinanceRecurringBody, user: JwtUser) {
    const today = await this.today(user.householdId);
    await this.dataSource.transaction(async (manager) => {
      const rule = await this.lock(manager, id, user.householdId);
      if (rule.version !== body.expectedVersion) throw new ConflictException('这条周期账单已经被改过，请刷新后重试');
      const type = body.type ?? rule.type;
      const accountId = body.accountId ?? rule.accountId;
      const categoryId = body.categoryId ?? rule.categoryId;
      if (body.type !== undefined || body.accountId !== undefined || body.categoryId !== undefined) {
        await this.requireReferences(manager, user.householdId, accountId, categoryId, type);
      }
      if (body.title !== undefined) rule.title = body.title;
      if (body.amount !== undefined) rule.amount = money(body.amount).toFixed(2);
      if (body.autoPost !== undefined) rule.autoPost = body.autoPost;
      if (body.isActive !== undefined) rule.isActive = body.isActive;
      rule.type = type;
      rule.accountId = accountId;
      rule.categoryId = categoryId;
      const scheduleChanged =
        (body.cadence !== undefined && body.cadence !== rule.cadence) ||
        (body.anchorOn !== undefined && body.anchorOn !== rule.anchorOn);
      if (body.cadence !== undefined) rule.cadence = body.cadence;
      if (body.anchorOn !== undefined) rule.anchorOn = body.anchorOn;
      if (scheduleChanged || body.isActive === true) {
        // 换了周期 / 起始日、或者重新启用：从不早于今天、也不早于已落那一期之后的第一期重新算
        const from = rule.lastPostedOn && addDays(rule.lastPostedOn, 1) > today ? addDays(rule.lastPostedOn, 1) : today;
        rule.nextDueOn = firstOccurrenceOnOrAfter(rule.anchorOn, rule.cadence, from);
      }
      // 管理员改过这条（换账户、停用……）就算处理过自动记账失败了：清掉原因，调度下一轮再试
      rule.lastError = null;
      rule.lastErrorAt = null;
      rule.updatedById = user.memberId;
      rule.version += 1;
      // 关系对象是 lock() 不带的，save 只写列
      await manager.getRepository(FinanceRecurring).save(rule);
    });
    return this.findOne(id, user.householdId, today);
  }

  async remove(id: string, expectedVersion: number, user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      const rule = await this.lock(manager, id, user.householdId);
      if (rule.version !== expectedVersion) throw new ConflictException('这条周期账单已经被改过，请刷新后重试');
      await manager.getRepository(FinanceRecurring).delete({ id, householdId: user.householdId });
      await recordActivity(manager, user, {
        module: 'finance',
        action: 'finance_recurring_deleted',
        summary: `${user.name}删除了周期账单「${rule.title}」`,
        targetPath: '/house/finance?view=recurring',
        metadata: { recurringId: id },
      });
    });
    return { deleted: true as const, id };
  }

  /** 「已付」：给 body.dueOn 这一期落一笔（记账日是今天），推到下一期。同一期再点返回同一笔。 */
  async pay(id: string, body: PayFinanceRecurringBody, user: JwtUser) {
    const today = await this.today(user.householdId);
    const transactionId = await this.dataSource.transaction(async (manager) => {
      const rule = await this.lock(manager, id, user.householdId);
      const key = recurringIdempotencyKey(rule.id, body.dueOn);
      const existing = await manager.getRepository(FinanceTransaction).findOne({
        where: { householdId: user.householdId, idempotencyKey: key },
        select: { id: true },
      });
      if (existing) return existing.id;
      if (!rule.isActive) throw new ConflictException('这条周期账单已经停用了');
      if (rule.autoPost) throw new ConflictException('这条是自动记账，到期会自己记上，不用点「已付」');
      if (body.dueOn !== rule.nextDueOn) throw new ConflictException('这一期的状态变了，请刷新后再点');
      if (rule.nextDueOn > addDays(today, RECURRING_NOTICE_DAYS)) {
        throw new ConflictException(`还没到付款的时候：到期前 ${RECURRING_NOTICE_DAYS} 天才能点「已付」`);
      }
      const transaction = await this.post(manager, rule, rule.nextDueOn, today, user);
      await manager.getRepository(FinanceRecurring).save(rule);
      return transaction.id;
    });
    const [recurring, transaction] = await Promise.all([
      this.findOne(id, user.householdId, today),
      this.finance.getTransaction(transactionId, user.householdId),
    ]);
    return { recurring, transaction };
  }

  /**
   * 给 dueOn 这一期落一笔流水（走 FinanceService 的同一套校验、复式过账与动态），并把规则推到下一期。
   * 调用方持有规则的行锁；规则对象只改列，由调用方保存。
   */
  async post(manager: EntityManager, rule: FinanceRecurring, dueOn: string, occurredOn: string, actor: JwtUser) {
    const transaction = await this.finance.createWithinTransaction(
      {
        type: rule.type,
        amount: Number(rule.amount),
        accountId: rule.accountId,
        categoryId: rule.categoryId,
        toAccountId: null,
        title: rule.title,
        note: null,
        occurredOn,
        idempotencyKey: recurringIdempotencyKey(rule.id, dueOn),
      },
      actor,
      manager,
      { sourceType: 'recurring', sourceId: rule.id },
    );
    this.advance(rule, dueOn);
    return transaction;
  }

  /**
   * 调度用：把一条自动记账规则在 cutoff（含）之前到期的每一期都落下来，每期一条，按期推进。
   * 某一期的流水已经在了（上次落完没来得及推进、或者有人手点过）就只推进不重落。返回落了几期；规则被别的事务锁着时跳过。
   */
  async postDue(id: string, cutoff: string): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const rule = await manager
        .getRepository(FinanceRecurring)
        .createQueryBuilder('rule')
        .where('rule.id = :id', { id })
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getOne();
      if (!rule || !rule.isActive || !rule.autoPost || rule.nextDueOn > cutoff) return 0;
      const actor = await this.automationActor(manager, rule.householdId);
      if (!actor) throw new Error('家里没有在用的家庭主人');
      let posted = 0;
      for (let step = 0; step < MAX_CATCH_UP && rule.nextDueOn <= cutoff; step += 1) {
        const dueOn = rule.nextDueOn;
        const exists = await manager.getRepository(FinanceTransaction).exists({
          where: { householdId: rule.householdId, idempotencyKey: recurringIdempotencyKey(rule.id, dueOn) },
        });
        if (exists) {
          this.advance(rule, dueOn);
          continue;
        }
        // 自动落的记账日就是那一期的应付日
        await this.post(manager, rule, dueOn, dueOn, actor);
        posted += 1;
      }
      await manager.getRepository(FinanceRecurring).save(rule);
      return posted;
    });
  }

  private async automationActor(manager: EntityManager, householdId: string): Promise<JwtUser | null> {
    const owner = await manager.getRepository(Member).findOne({
      where: { householdId, role: 'owner', disabledAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
    if (!owner) return null;
    return {
      sub: '',
      accountId: '',
      memberId: owner.id,
      householdId,
      sid: RECURRING_ACTOR_SID,
      name: RECURRING_ACTOR_NAME,
      role: 'owner',
    };
  }

  /** 这一期已落：记下 lastPostedOn，推到严格晚于它的下一期。版本号随之加一（管理员手里的旧页面要刷新）。 */
  advance(rule: FinanceRecurring, dueOn: string) {
    rule.lastPostedOn = dueOn;
    rule.nextDueOn = nextOccurrenceAfter(rule.anchorOn, rule.cadence, dueOn);
    rule.version += 1;
  }

  private async lock(manager: EntityManager, id: string, householdId: string) {
    const rule = await manager
      .getRepository(FinanceRecurring)
      .createQueryBuilder('rule')
      .where('rule.id = :id AND rule.householdId = :householdId', { id, householdId })
      .setLock('pessimistic_write')
      .getOne();
    if (!rule) throw new NotFoundException('周期账单不存在');
    return rule;
  }

  private async requireReferences(
    manager: EntityManager,
    householdId: string,
    accountId: string,
    categoryId: string,
    type: FinanceRecurring['type'],
  ) {
    const account = await manager.getRepository(FinanceAccount).findOneBy({ id: accountId, householdId, isActive: true });
    if (!account) throw new NotFoundException('财务账户不存在或已停用');
    const category = await manager.getRepository(FinanceCategory).findOneBy({ id: categoryId, householdId, isActive: true });
    if (!category) throw new NotFoundException('所选收支分类不存在或已停用');
    if (category.kind !== type) {
      throw new BadRequestException(type === 'expense' ? '支出要选支出分类' : '收入要选收入分类');
    }
  }

  private async findOne(id: string, householdId: string, today: string) {
    const row = await this.rules.findOne({
      where: { id, householdId },
      relations: { account: true, category: true },
    });
    if (!row) throw new NotFoundException('周期账单不存在');
    return this.present(row, today);
  }

  /**
   * 自动记账落失败：记下给人看的原因（账户 / 分类停用说清楚，别的取错误消息），调度不再重试这条，进管理员的留意。
   */
  async recordFailure(id: string, error: unknown) {
    const rule = await this.rules.findOne({ where: { id }, relations: { account: true, category: true } });
    if (!rule) return null;
    const reason = !rule.account.isActive
      ? '账户已停用'
      : !rule.category.isActive
        ? '分类已停用'
        : (error instanceof Error ? error.message : String(error)) || '记账出错了';
    await this.rules.update({ id }, { lastError: reason.slice(0, 200), lastErrorAt: this.clock.now() });
    return reason;
  }

  /** 管理员「重试」：清掉失败原因，按调度同样的口径把到期的期落下来；还失败就记下新原因并 409。 */
  async retry(id: string, user: JwtUser) {
    assertCapability(user, 'manage_finance');
    const rule = await this.rules.findOneBy({ id, householdId: user.householdId });
    if (!rule) throw new NotFoundException('周期账单不存在');
    if (!rule.isActive || !rule.autoPost) throw new ConflictException('这条不是在用的自动记账，不用重试');
    await this.rules.update({ id }, { lastError: null, lastErrorAt: null });
    const household = await this.dataSource.getRepository(Household).findOneByOrFail({ id: user.householdId });
    let posted: number;
    try {
      posted = await this.postDue(id, postingCutoff(household.timezone || 'Asia/Shanghai', this.clock.now()));
    } catch (error) {
      const reason = await this.recordFailure(id, error);
      throw new ConflictException(`还是没记上：${reason}`);
    }
    return { recurring: await this.findOne(id, user.householdId, await this.today(user.householdId)), posted };
  }

  async today(householdId: string) {
    const household = await this.dataSource.getRepository(Household).findOneByOrFail({ id: householdId });
    return householdToday(household.timezone, this.clock.now());
  }

  present(row: FinanceRecurring, today: string) {
    const amount = money(row.amount);
    return {
      id: row.id,
      householdId: row.householdId,
      title: row.title,
      type: row.type,
      amount,
      monthlyAmount: monthlyAverage(amount, row.cadence),
      accountId: row.accountId,
      account: { id: row.account.id, name: row.account.name, type: row.account.type, isActive: row.account.isActive },
      categoryId: row.categoryId,
      category: { id: row.category.id, name: row.category.name, color: row.category.color, isActive: row.category.isActive },
      cadence: row.cadence,
      anchorOn: row.anchorOn,
      nextDueOn: row.nextDueOn,
      autoPost: row.autoPost,
      lastPostedOn: row.lastPostedOn,
      lastError: row.lastError,
      lastErrorAt: row.lastErrorAt,
      isActive: row.isActive,
      payable: row.isActive && !row.autoPost && row.nextDueOn <= addDays(today, RECURRING_NOTICE_DAYS),
      version: row.version,
      createdById: row.createdById,
      updatedById: row.updatedById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
