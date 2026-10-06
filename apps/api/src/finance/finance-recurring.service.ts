import {
  BadRequestException,
  ConflictException,
  Controller,
  Delete,
  Get,
  Injectable,
  NotFoundException,
  Patch,
  Post,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  createFinanceRecurringBody,
  deleteFinanceRecurringQuery,
  payFinanceRecurringBody,
  updateFinanceRecurringBody,
  uuid,
  type CreateFinanceRecurringBody,
  type PayFinanceRecurringBody,
  type UpdateFinanceRecurringBody,
} from '@family/contracts';
import { addDays, householdToday } from '@family/shared';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { Clock } from '../common/clock';
import { ZodBody, ZodParam, ZodQuery } from '../common/zod';
import {
  FinanceAccount,
  FinanceCategory,
  FinanceRecurring,
  FinanceTransaction,
  Household,
} from '../entities';
import { FinanceService } from './finance.service';
import {
  firstOccurrenceOnOrAfter,
  monthlyAverage,
  nextOccurrenceAfter,
  RECURRING_NOTICE_DAYS,
  recurringIdempotencyKey,
} from './finance-recurring.schedule';

function money(value: number | string) {
  return Math.round(Number(value) * 100) / 100;
}

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

@Controller('finance/recurring')
@RequireCapabilities('view_finance')
export class FinanceRecurringController {
  constructor(private readonly service: FinanceRecurringService) {}

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.service.list(user);
  }

  @Post()
  @RequireCapabilities('manage_finance')
  create(@ZodBody(createFinanceRecurringBody) body: CreateFinanceRecurringBody, @CurrentUser() user: JwtUser) {
    return this.service.create(body, user);
  }

  @Patch(':id')
  @RequireCapabilities('manage_finance')
  update(
    @ZodParam('id', uuid) id: string,
    @ZodBody(updateFinanceRecurringBody) body: UpdateFinanceRecurringBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.update(id, body, user);
  }

  @Delete(':id')
  @RequireCapabilities('manage_finance')
  remove(
    @ZodParam('id', uuid) id: string,
    @ZodQuery(deleteFinanceRecurringQuery) query: { expectedVersion: number },
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.remove(id, query.expectedVersion, user);
  }

  @Post(':id/pay')
  @RequireCapabilities('record_finance')
  pay(
    @ZodParam('id', uuid) id: string,
    @ZodBody(payFinanceRecurringBody) body: PayFinanceRecurringBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.pay(id, body, user);
  }
}
