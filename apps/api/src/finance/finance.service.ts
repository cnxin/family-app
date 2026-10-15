import { householdToday, monthRange } from '@family/shared';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { assertCapability } from '../auth/capabilities';
import { JwtUser } from '../auth/jwt.guard';
import { Clock } from '../common/clock';
import { fingerprint } from '../common/fingerprint';
import { FinancePosting, FinanceTransaction, Household } from '../entities';
import { assertFinanceAttachment } from './finance-screenshot.service';
import type {
  CreateFinanceTransactionDto,
  FinanceTransactionQueryDto,
  ReverseFinanceTransactionDto,
} from './finance.dto';
import {
  FinanceCreateSource,
  amount,
  money,
  normalized,
  parseLedgerSearch,
  prepareTransaction,
  requireAccount,
} from './finance.helpers';

@Injectable()
export class FinanceService {
  constructor(
    @InjectRepository(FinanceTransaction)
    private readonly transactions: Repository<FinanceTransaction>,
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  async previewTransaction(dto: CreateFinanceTransactionDto, user: JwtUser) {
    const prepared = await prepareTransaction(dto, user, this.dataSource.manager);
    return {
      type: dto.type,
      amount: money(dto.amount),
      title: dto.title.trim(),
      occurredOn: dto.occurredOn,
      account: { id: prepared.account.id, name: prepared.account.name },
      toAccount: prepared.toAccount
        ? { id: prepared.toAccount.id, name: prepared.toAccount.name }
        : null,
      category: prepared.category
        ? { id: prepared.category.id, name: prepared.category.name }
        : null,
    };
  }

  async createTransaction(dto: CreateFinanceTransactionDto, user: JwtUser) {
    // K2：带了截图（识别接口返回的文件名）就记成 screenshot，文件得真在本家庭的截图目录里
    if (dto.attachmentPath) await assertFinanceAttachment(user.householdId, dto.attachmentPath);
    return this.dataSource.transaction((manager) =>
      this.createWithinTransaction(dto, user, manager, {
        sourceType: dto.attachmentPath ? 'screenshot' : 'manual',
        merchant: dto.merchant?.trim() || null,
        attachmentPath: dto.attachmentPath ?? null,
      }),
    );
  }

  async createWithinTransaction(
    dto: CreateFinanceTransactionDto,
    user: JwtUser,
    manager: EntityManager,
    source: FinanceCreateSource,
  ) {
    const { id, created } = await this.insertWithinTransaction(dto, user, manager, source);
    if (created) {
      await recordActivity(manager, user, {
        module: 'finance',
        action: `finance_${dto.type}_recorded`,
        summary: `${user.name}记录了${dto.type === 'expense' ? '支出' : dto.type === 'income' ? '收入' : '转账'}「${dto.title.trim()}」`,
        detail: normalized(dto.note),
        targetPath: '/finance',
        metadata: { transactionId: id, amount: money(dto.amount), sourceType: source.sourceType },
      });
    }
    return this.findTransaction(id, user.householdId, manager);
  }

  /**
   * 记一笔的核心：校验、幂等（同一个键、同样的内容返回原来那笔）、写流水与复式过账。不记动态、不重读整笔——
   * 账单导入一次几百上千笔，动态记一条汇总（K1）；普通记账走上面的 createWithinTransaction。
   */
  async insertWithinTransaction(
    dto: CreateFinanceTransactionDto,
    user: JwtUser,
    manager: EntityManager,
    source: FinanceCreateSource,
  ): Promise<{ id: string; created: boolean }> {
    assertCapability(user, 'record_finance');
    const prepared = await prepareTransaction(dto, user, manager);
    const requestFingerprint = fingerprint({
      type: dto.type,
      amount: amount(dto.amount),
      accountId: dto.accountId,
      toAccountId: dto.toAccountId ?? null,
      categoryId: dto.categoryId ?? null,
      title: dto.title.trim(),
      note: normalized(dto.note),
      occurredOn: dto.occurredOn,
      sourceType: source.sourceType,
      sourceId: source.sourceId ?? null,
    });
    await this.lockIdempotency(manager, user.householdId, dto.idempotencyKey);
    const repository = manager.getRepository(FinanceTransaction);
    const existing = await repository.findOneBy({
      householdId: user.householdId,
      idempotencyKey: dto.idempotencyKey,
    });
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new ConflictException('幂等键已用于另一笔不同的财务流水');
      }
      return { id: existing.id, created: false };
    }

    const transaction = await repository.save(
      repository.create({
        householdId: user.householdId,
        type: dto.type,
        amount: amount(dto.amount),
        currency: 'CNY',
        title: dto.title.trim(),
        note: normalized(dto.note),
        occurredOn: dto.occurredOn,
        categoryId: prepared.category?.id ?? null,
        actorId: source.actor?.memberId ?? user.memberId,
        actorName: source.actor?.name ?? user.name,
        sourceType: source.sourceType,
        sourceId: source.sourceId ?? randomUUID(),
        externalId: source.externalId ?? null,
        merchant: source.merchant ?? null,
        attachmentPath: source.attachmentPath ?? null,
        idempotencyKey: dto.idempotencyKey,
        requestFingerprint,
        reversalOfId: null,
        ...(source.createdAt ? { createdAt: source.createdAt } : {}),
      }),
    );
    const postings = manager.getRepository(FinancePosting);
    if (dto.type === 'expense') {
      await postings.save(postings.create({
        householdId: user.householdId,
        transactionId: transaction.id,
        accountId: prepared.account.id,
        delta: (-money(dto.amount)).toFixed(2),
      }));
    } else if (dto.type === 'income') {
      await postings.save(postings.create({
        householdId: user.householdId,
        transactionId: transaction.id,
        accountId: prepared.account.id,
        delta: amount(dto.amount),
      }));
    } else {
      await postings.save([
        postings.create({
          householdId: user.householdId,
          transactionId: transaction.id,
          accountId: prepared.account.id,
          delta: (-money(dto.amount)).toFixed(2),
        }),
        postings.create({
          householdId: user.householdId,
          transactionId: transaction.id,
          accountId: prepared.toAccount!.id,
          delta: amount(dto.amount),
        }),
      ]);
    }
    return { id: transaction.id, created: true };
  }

  async reverseTransaction(
    id: string,
    dto: ReverseFinanceTransactionDto,
    user: JwtUser,
  ) {
    assertCapability(user, 'manage_finance');
    return this.dataSource.transaction(async (manager) => {
      await this.lockIdempotency(manager, user.householdId, dto.idempotencyKey);
      const repository = manager.getRepository(FinanceTransaction);
      const original = await repository.findOne({
        where: { id, householdId: user.householdId },
        relations: { postings: true },
      });
      if (!original) throw new NotFoundException('财务流水不存在');
      if (original.type === 'reversal') throw new BadRequestException('撤销流水不能再次撤销');
      const existingReversal = await repository.findOneBy({
        householdId: user.householdId,
        reversalOfId: original.id,
      });
      if (existingReversal) {
        if (existingReversal.idempotencyKey !== dto.idempotencyKey) {
          throw new ConflictException('这笔财务流水已经撤销');
        }
        return this.findTransaction(existingReversal.id, user.householdId, manager);
      }
      const requestFingerprint = fingerprint({
        reversalOfId: original.id,
        note: normalized(dto.note),
      });
      const duplicate = await repository.findOneBy({
        householdId: user.householdId,
        idempotencyKey: dto.idempotencyKey,
      });
      if (duplicate) {
        if (duplicate.requestFingerprint !== requestFingerprint) {
          throw new ConflictException('幂等键已用于另一笔不同的财务流水');
        }
        return this.findTransaction(duplicate.id, user.householdId, manager);
      }
      const reversal = await this.insertReversal(manager, original, user, {
        idempotencyKey: dto.idempotencyKey,
        requestFingerprint,
        note: normalized(dto.note),
        occurredOn: await this.today(user.householdId),
      });
      await recordActivity(manager, user, {
        module: 'finance',
        action: 'finance_transaction_reversed',
        summary: `${user.name}撤销了财务流水「${original.title}」`,
        detail: normalized(dto.note),
        targetPath: '/finance',
        metadata: { transactionId: reversal.id, reversalOfId: original.id },
      });
      return this.findTransaction(reversal.id, user.householdId, manager);
    });
  }

  /**
   * 冲销一笔：另记一笔 reversal，分录金额全部取反。调用方负责校验能不能冲销、锁住原笔。
   * K5 的改金额 / 删除也走这里（冲销笔记在原笔那天，列表里和原笔一起折叠）。
   */
  async insertReversal(
    manager: EntityManager,
    original: FinanceTransaction,
    user: JwtUser,
    options: { idempotencyKey: string; requestFingerprint?: string; note?: string | null; occurredOn: string },
  ) {
    const repository = manager.getRepository(FinanceTransaction);
    const reversal = await repository.save(repository.create({
      householdId: user.householdId,
      type: 'reversal',
      amount: original.amount,
      currency: 'CNY',
      title: `撤销：${original.title}`.slice(0, 120),
      note: options.note ?? null,
      occurredOn: options.occurredOn,
      categoryId: original.categoryId,
      actorId: user.memberId,
      actorName: user.name,
      sourceType: 'finance_transaction',
      sourceId: original.id,
      idempotencyKey: options.idempotencyKey,
      requestFingerprint: options.requestFingerprint ?? fingerprint({ reversalOfId: original.id, note: options.note ?? null }),
      reversalOfId: original.id,
    }));
    const postings = manager.getRepository(FinancePosting);
    await postings.save(original.postings.map((posting) => postings.create({
      householdId: user.householdId,
      transactionId: reversal.id,
      accountId: posting.accountId,
      delta: (-money(posting.delta)).toFixed(2),
    })));
    return reversal;
  }

  async today(householdId: string): Promise<string> {
    const timezone = (await this.dataSource.getRepository(Household).findOneByOrFail({ id: householdId })).timezone;
    return householdToday(timezone, this.clock.now());
  }

  async listTransactions(query: FinanceTransactionQueryDto, user: JwtUser) {
    const month = (query.month ?? (await this.today(user.householdId)).slice(0, 7));
    const { start, end } = monthRange(month);
    if (query.accountId) await requireAccount(query.accountId, user.householdId, this.dataSource.manager, true);
    const limit = query.limit ?? 100;
    /** 月份、类型、账户、分类、成员、已删除这些筛选每次查询都一样；搜索另外加 */
    const filtered = () => {
      const builder = this.transactions
        .createQueryBuilder('transaction')
        .leftJoinAndSelect('transaction.category', 'category')
        .leftJoinAndSelect('transaction.actor', 'actor')
        .leftJoinAndSelect('transaction.postings', 'posting')
        .leftJoinAndSelect('posting.account', 'account')
        .where('transaction.householdId = :householdId', { householdId: user.householdId })
        .andWhere('transaction.occurredOn >= :start AND transaction.occurredOn < :end', { start, end })
        .orderBy('transaction.occurredOn', 'DESC')
        .addOrderBy('transaction.createdAt', 'DESC')
        .take(limit);
      if (query.type) builder.andWhere('transaction.type = :type', { type: query.type });
      if (query.accountId) builder.andWhere('posting.accountId = :accountId', { accountId: query.accountId });
      // K5：改金额 / 删除时记的冲销笔不进列表（它们是账本内部的一对）；被替代、删除的原笔要「显示已删除」才列
      builder.andWhere(
        `NOT (transaction.type = 'reversal' AND EXISTS (
           SELECT 1 FROM finance_transactions hidden
            WHERE hidden.id = transaction."reversalOfId"
              AND (hidden."deletedAt" IS NOT NULL OR hidden."supersededById" IS NOT NULL)))`,
      );
      if (query.includeDeleted !== 'true') {
        builder.andWhere('transaction.deletedAt IS NULL AND transaction.supersededById IS NULL');
      }
      if (query.categoryId) builder.andWhere('transaction.categoryId = :categoryId', { categoryId: query.categoryId });
      if (query.memberId) builder.andWhere('transaction.actorId = :memberId', { memberId: query.memberId });
      return builder;
    };
    const search = parseLedgerSearch(query.q);
    if (!search) return this.presentTransactions(await filtered().getMany(), user.householdId);
    const textMatch = '(transaction.title ILIKE :q OR transaction.merchant ILIKE :q OR transaction.note ILIKE :q)';
    const q = `%${search.text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    if (search.kind === 'text') {
      return this.presentTransactions(await filtered().andWhere(textMatch, { q }).getMany(), user.householdId);
    }
    // 纯数字：金额对上的在前；名称 / 商户 / 备注含这串数字、金额又不对的补在后面，总数仍不超过 limit。
    // 分两次查，不在一条里按表达式排序：take + 关联表时 TypeORM 会把分页算错（K5 踩过）
    const amount = { minAmount: search.min, maxAmount: search.max };
    const byAmount = await filtered().andWhere('transaction.amount BETWEEN :minAmount AND :maxAmount', amount).getMany();
    const byText = byAmount.length >= limit
      ? []
      : await filtered()
          .andWhere(textMatch, { q })
          .andWhere('transaction.amount NOT BETWEEN :minAmount AND :maxAmount', amount)
          .take(limit - byAmount.length)
          .getMany();
    return this.presentTransactions([...byAmount, ...byText], user.householdId);
  }

  private async presentTransactions(rows: FinanceTransaction[], householdId: string) {
    if (!rows.length) return [];
    const reversals = await this.transactions.find({
      where: { householdId, reversalOfId: In(rows.map((row) => row.id)) },
      select: { id: true, reversalOfId: true },
    });
    const reversed = new Map(reversals.map((row) => [row.reversalOfId, row.id]));
    const replacedIds = rows.map((row) => row.supersededById).filter((id): id is string => Boolean(id));
    const replacements = replacedIds.length
      ? await this.transactions.find({ where: { householdId, id: In(replacedIds) }, select: { id: true, amount: true, type: true } })
      : [];
    const replacedBy = new Map(replacements.map((row) => [row.id, { id: row.id, amount: money(row.amount), type: row.type }]));
    return rows.map((row) => ({
      ...row,
      amount: money(row.amount),
      supersededBy: row.supersededById ? replacedBy.get(row.supersededById) ?? null : null,
      // 分录顺序原来随查询计划变：固定成先写的在前，同一刻写的负数（转出）在前
      postings: [...row.postings]
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || Number(a.delta) - Number(b.delta))
        .map((posting) => ({ ...posting, delta: money(posting.delta) })),
      reversed: reversed.has(row.id),
      reversalId: reversed.get(row.id) ?? null,
    }));
  }

  /** 按 id 取一笔流水（与写接口回传同一形状）；周期账单「已付」回传落下的那一笔用。 */
  getTransaction(id: string, householdId: string) {
    return this.findTransaction(id, householdId, this.dataSource.manager);
  }

  async findTransaction(id: string, householdId: string, manager: EntityManager) {
    const row = await manager.getRepository(FinanceTransaction).findOne({
      where: { id, householdId },
      relations: { category: true, actor: true, postings: { account: true } },
    });
    if (!row) throw new NotFoundException('财务流水不存在');
    return (await this.presentTransactions([row], householdId))[0];
  }

  lockIdempotency(manager: EntityManager, householdId: string, key: string) {
    return manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `${householdId}:finance:${key}`,
    ]);
  }
}
