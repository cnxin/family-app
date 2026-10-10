import {
  BadRequestException,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  Patch,
  Post,
} from '@nestjs/common';
import {
  batchFinanceTransactionsBody,
  updateFinanceTransactionBody,
  uuid,
  type BatchFinanceTransactionsBody,
  type UpdateFinanceTransactionBody,
} from '@family/contracts';
import { DataSource, EntityManager } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { hasCapability, RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { Clock } from '../common/clock';
import { ZodBody, ZodParam } from '../common/zod';
import { FinanceAccount, FinanceCategory, FinancePosting, FinanceTransaction } from '../entities';
import { learnMerchantRule } from './finance-merchant-rules';
import { RECURRING_ACTOR_NAME } from './finance-recurring.service';
import { amount, assertDate, FinanceService } from './finance.service';
import { normalizeMerchant } from './import/merchant-rules';

type MoneyFields = { type: 'expense' | 'income' | 'transfer'; amount: number; accountId: string; toAccountId: string | null };

const BATCH_LABELS = { category: '改了分类', account: '改了账户', delete: '删除了' } as const;

/** 周期账单自动落的（不是谁手点「已付」的）只有管理员能动。 */
function autoPosted(row: FinanceTransaction) {
  return row.sourceType === 'recurring' && row.actorName === RECURRING_ACTOR_NAME;
}

/**
 * K5 流水编辑（docs/finance-plan.md §3-K5）：
 * - 名称 / 分类 / 备注 / 日期 / 商户原地改，不碰分录；
 * - 金额 / 账户 / 转入账户 / 收支方向有变化：冲销原笔 + 按新值另记一笔（单号、来源、记账人跟到新笔上），原笔 supersededById 指向新笔；
 * - 删除：冲销 + deletedAt。
 * 成员（record_finance）只能动自己记的，管理员（manage_finance）都能动；周期账单自动落的只有管理员能动。
 */
@Injectable()
export class FinanceEditService {
  constructor(
    private readonly finance: FinanceService,
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  async update(id: string, body: UpdateFinanceTransactionBody, user: JwtUser) {
    if (!Object.values(body).some((value) => value !== undefined)) throw new BadRequestException('没有要改的内容');
    const result = await this.dataSource.transaction(async (manager) => {
      const row = await this.lock(manager, id, user.householdId);
      const resultId = await this.apply(manager, row, body, user);
      await recordActivity(manager, user, {
        module: 'finance',
        action: 'finance_transaction_updated',
        summary: `${user.name}修改了流水「${(body.title ?? row.title).trim()}」`,
        targetPath: '/finance',
        metadata: { transactionId: resultId, ...(resultId !== row.id ? { supersededId: row.id } : {}) },
      });
      const categoryChanged = body.categoryId != null && body.categoryId !== row.categoryId;
      const after = await manager.getRepository(FinanceTransaction).findOneByOrFail({ id: resultId });
      return { resultId, sameMerchantIds: categoryChanged ? await this.learn(manager, after, user) : [] };
    });
    const transaction = await this.finance.getTransaction(result.resultId, user.householdId);
    return { ...transaction, sameMerchantPending: result.sameMerchantIds.length, sameMerchantIds: result.sameMerchantIds };
  }

  async remove(id: string, user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      const row = await this.lock(manager, id, user.householdId);
      await this.deleteRow(manager, row, user);
      await recordActivity(manager, user, {
        module: 'finance',
        action: 'finance_transaction_deleted',
        summary: `${user.name}删除了流水「${row.title}」`,
        targetPath: '/finance',
        metadata: { transactionId: row.id },
      });
    });
    return this.finance.getTransaction(id, user.householdId);
  }

  /** 批量：逐条各开一个事务、逐条按权限；不够权限 / 状态不对的记进 skipped，不影响别的。已经是目标分类 / 账户的算完成。 */
  async batch(body: BatchFinanceTransactionsBody, user: JwtUser) {
    let category: FinanceCategory | null = null;
    if (body.action === 'category') {
      if (!body.categoryId) throw new BadRequestException('改分类要选一个分类');
      category = await this.category(this.dataSource.manager, body.categoryId, null, user.householdId);
    }
    if (body.action === 'account') {
      if (!body.accountId) throw new BadRequestException('改账户要选一个账户');
      const account = await this.dataSource.getRepository(FinanceAccount).findOneBy({
        id: body.accountId, householdId: user.householdId, isActive: true,
      });
      if (!account) throw new NotFoundException('财务账户不存在或已停用');
    }
    let done = 0;
    const skipped: { id: string; reason: string }[] = [];
    for (const id of [...new Set(body.ids)]) {
      try {
        await this.dataSource.transaction(async (manager) => {
          const row = await this.lock(manager, id, user.householdId);
          if (body.action === 'delete') return this.deleteRow(manager, row, user);
          if (body.action === 'account') return this.apply(manager, row, { accountId: body.accountId }, user);
          await this.assertEditable(manager, row, user);
          if (row.type !== category!.kind) {
            throw new BadRequestException(row.type === 'transfer' ? '转账没有分类' : '收支和分类对不上');
          }
          if (row.categoryId !== category!.id) await this.updateInPlace(manager, row, { categoryId: category!.id }, user);
        });
        done += 1;
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        skipped.push({ id, reason: error.message });
      }
    }
    if (done > 0) {
      await this.dataSource.transaction((manager) =>
        recordActivity(manager, user, {
          module: 'finance',
          action: 'finance_transactions_batch',
          summary: `${user.name}批量${BATCH_LABELS[body.action]} ${done} 笔流水`,
          targetPath: '/finance',
          metadata: { action: body.action, done, skipped: skipped.length },
        }),
      );
    }
    return { done, skipped };
  }

  /** 改一笔，返回改完后的那笔 id（动钱时是新笔）。 */
  private async apply(manager: EntityManager, row: FinanceTransaction, changes: UpdateFinanceTransactionBody, user: JwtUser) {
    await this.assertEditable(manager, row, user);
    const current = this.moneyFields(row);
    const type = changes.type ?? current.type;
    const next: MoneyFields = {
      type,
      amount: changes.amount ?? current.amount,
      accountId: changes.accountId ?? current.accountId,
      toAccountId: type !== 'transfer' ? null : changes.toAccountId !== undefined ? changes.toAccountId : current.toAccountId,
    };
    const moneyChanged =
      next.type !== current.type ||
      Math.round(next.amount * 100) !== Math.round(current.amount * 100) ||
      next.accountId !== current.accountId ||
      next.toAccountId !== current.toAccountId;
    if (!moneyChanged) {
      await this.updateInPlace(manager, row, changes, user);
      return row.id;
    }
    return this.supersede(manager, row, next, changes, user);
  }

  private async updateInPlace(manager: EntityManager, row: FinanceTransaction, changes: UpdateFinanceTransactionBody, user: JwtUser) {
    const patch: Partial<Pick<FinanceTransaction, 'title' | 'note' | 'occurredOn' | 'merchant' | 'categoryId'>> = {};
    if (changes.title !== undefined) patch.title = changes.title.trim();
    if (changes.note !== undefined) patch.note = changes.note?.trim() || null;
    if (changes.merchant !== undefined) patch.merchant = changes.merchant?.trim() || null;
    if (changes.occurredOn !== undefined) {
      assertDate(changes.occurredOn);
      patch.occurredOn = changes.occurredOn;
    }
    if (changes.categoryId !== undefined) {
      if (row.type === 'transfer') {
        if (changes.categoryId) throw new BadRequestException('账户间转账不使用收支分类');
      } else {
        if (!changes.categoryId) throw new BadRequestException('收入和支出必须选择分类');
        patch.categoryId = (await this.category(manager, changes.categoryId, row.type as 'expense' | 'income', user.householdId)).id;
      }
    }
    if (Object.keys(patch).length) await manager.getRepository(FinanceTransaction).update({ id: row.id }, patch);
  }

  private async supersede(
    manager: EntityManager,
    row: FinanceTransaction,
    next: MoneyFields,
    changes: UpdateFinanceTransactionBody,
    user: JwtUser,
  ) {
    let categoryId: string | null = null;
    if (next.type === 'transfer') {
      if (changes.categoryId) throw new BadRequestException('账户间转账不使用收支分类');
    } else {
      categoryId = changes.categoryId !== undefined ? changes.categoryId ?? null : next.type === row.type ? row.categoryId : null;
      if (!categoryId) throw new BadRequestException('改成收入 / 支出要选一个分类');
    }
    const repository = manager.getRepository(FinanceTransaction);
    await this.finance.insertReversal(manager, row, user, { idempotencyKey: `edit:${row.id}:reversal`, occurredOn: row.occurredOn });
    // 单号跟到新笔上（家庭 + 来源 + 单号唯一，先从原笔上拿掉）：同一份账单再导一次照样认得出
    if (row.externalId) await repository.update({ id: row.id }, { externalId: null });
    const { id } = await this.finance.insertWithinTransaction(
      {
        type: next.type,
        amount: Number(amount(next.amount)),
        accountId: next.accountId,
        toAccountId: next.toAccountId,
        categoryId,
        title: (changes.title ?? row.title).trim(),
        note: changes.note !== undefined ? changes.note?.trim() || null : row.note,
        occurredOn: changes.occurredOn ?? row.occurredOn,
        idempotencyKey: `edit:${row.id}`,
      },
      user,
      manager,
      {
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        externalId: row.externalId,
        merchant: changes.merchant !== undefined ? changes.merchant?.trim() || null : row.merchant,
        // K2：截图跟到新笔上
        attachmentPath: row.attachmentPath,
        actor: { memberId: row.actorId, name: row.actorName },
        // 新笔排在原笔原来的位置（列表按日期、记录时间排）
        createdAt: row.createdAt,
      },
    );
    await repository.update({ id: row.id }, { supersededById: id });
    return id;
  }

  private async deleteRow(manager: EntityManager, row: FinanceTransaction, user: JwtUser) {
    await this.assertEditable(manager, row, user);
    await this.finance.insertReversal(manager, row, user, { idempotencyKey: `delete:${row.id}`, occurredOn: row.occurredOn });
    await manager.getRepository(FinanceTransaction).update({ id: row.id }, { deletedAt: this.clock.now() });
  }

  /**
   * 改了分类的那笔有商户：记成规则（和导入预览同一张表），再找同商户、同收支、分类不一样、没删没改、这个人能改的别的笔。
   */
  private async learn(manager: EntityManager, row: FinanceTransaction, user: JwtUser) {
    if (row.type === 'transfer' || row.type === 'reversal' || !row.merchant || !row.categoryId) return [];
    const pattern = normalizeMerchant(row.merchant).slice(0, 120);
    if (!pattern) return [];
    await learnMerchantRule(manager, { householdId: user.householdId, pattern, kind: row.type, categoryId: row.categoryId });
    const manage = hasCapability(user, 'manage_finance');
    const rows: { id: string; merchant: string }[] = await manager.query(
      `SELECT t.id, t.merchant
         FROM finance_transactions t
        WHERE t."householdId" = $1 AND t.type = $2 AND t.merchant IS NOT NULL AND t.id <> $3
          AND t."categoryId" <> $4 AND t."deletedAt" IS NULL AND t."supersededById" IS NULL
          AND NOT EXISTS (SELECT 1 FROM finance_transactions r WHERE r."reversalOfId" = t.id)
          ${manage ? '' : `AND t."actorId" = $5 AND NOT (t."sourceType" = 'recurring' AND t."actorName" = $6)`}
        ORDER BY t."occurredOn" DESC, t."createdAt" DESC`,
      manage
        ? [user.householdId, row.type, row.id, row.categoryId]
        : [user.householdId, row.type, row.id, row.categoryId, user.memberId, RECURRING_ACTOR_NAME],
    );
    return rows.filter((one) => normalizeMerchant(one.merchant).slice(0, 120) === pattern).map((one) => one.id);
  }

  /** 锁住一笔（本家庭的），连分录一起取。 */
  private async lock(manager: EntityManager, id: string, householdId: string) {
    const row = await manager
      .getRepository(FinanceTransaction)
      .createQueryBuilder('transaction')
      .where('transaction.id = :id AND transaction.householdId = :householdId', { id, householdId })
      .setLock('pessimistic_write')
      .getOne();
    if (!row) throw new NotFoundException('财务流水不存在');
    row.postings = await manager.getRepository(FinancePosting).find({ where: { transactionId: row.id }, order: { createdAt: 'ASC' } });
    return row;
  }

  private async assertEditable(manager: EntityManager, row: FinanceTransaction, user: JwtUser) {
    const manage = hasCapability(user, 'manage_finance');
    if (!manage) {
      if (autoPosted(row)) throw new ForbiddenException('周期账单自动记的只有管理员能改');
      if (row.actorId !== user.memberId) throw new ForbiddenException('只能改自己记的流水');
    }
    if (row.type === 'reversal') throw new BadRequestException('撤销流水不能改');
    if (row.deletedAt) throw new ConflictException('这笔已经删了');
    if (row.supersededById) throw new ConflictException('这笔已经改过了，改新的那笔');
    if (await manager.getRepository(FinanceTransaction).exists({ where: { reversalOfId: row.id } })) {
      throw new ConflictException('这笔已经撤销了');
    }
  }

  private async category(manager: EntityManager, id: string, kind: 'expense' | 'income' | null, householdId: string) {
    const category = await manager.getRepository(FinanceCategory).findOneBy({
      id, householdId, isActive: true, ...(kind ? { kind } : {}),
    });
    if (!category) throw new NotFoundException('所选收支分类不存在或已停用');
    return category;
  }

  /** 从分录读出这笔现在的钱：支出 / 收入一条分录；转账负的是转出、正的是转入。 */
  private moneyFields(row: FinanceTransaction): MoneyFields {
    const from = row.postings.find((posting) => Number(posting.delta) < 0);
    const to = row.postings.find((posting) => Number(posting.delta) > 0);
    const type = row.type as MoneyFields['type'];
    return {
      type,
      amount: Number(row.amount),
      accountId: (type === 'income' ? to : from)!.accountId,
      toAccountId: type === 'transfer' ? to!.accountId : null,
    };
  }
}

/** K5：改一笔、删一笔、批量。成员也能用（只能动自己记的，服务里逐条判）。 */
@Controller('finance/transactions')
@RequireCapabilities('view_finance', 'record_finance')
export class FinanceEditController {
  constructor(private readonly service: FinanceEditService) {}

  @Post('batch')
  batch(@ZodBody(batchFinanceTransactionsBody) body: BatchFinanceTransactionsBody, @CurrentUser() user: JwtUser) {
    return this.service.batch(body, user);
  }

  @Patch(':id')
  update(
    @ZodParam('id', uuid) id: string,
    @ZodBody(updateFinanceTransactionBody) body: UpdateFinanceTransactionBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.update(id, body, user);
  }

  @Delete(':id')
  remove(@ZodParam('id', uuid) id: string, @CurrentUser() user: JwtUser) {
    return this.service.remove(id, user);
  }
}
