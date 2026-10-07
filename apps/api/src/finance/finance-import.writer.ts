import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import { fingerprint } from '../common/fingerprint';
import { FinanceAccount, FinanceCategory, FinancePosting, FinanceTransaction } from '../entities';
import type { StoredPreviewRow } from './finance-import.preview';
import { amount } from './finance.service';

/** 确认时决定要导的一行：记成什么、分类、转入账户。 */
export interface PlannedImportRow {
  row: StoredPreviewRow;
  type: 'expense' | 'income' | 'transfer';
  categoryId: string | null;
  toAccountId: string | null;
}

const CHUNK = 500;

/**
 * 确认导入的写入（K5 起成批写）：先按「记一笔」的规矩逐行校验（分类在用且收支对得上、转入账户在用且不是同一个、
 * 金额范围），全部通过后一次事务里分批 insert 流水和分录。流水的幂等键、指纹与逐笔记账时一致；
 * 一笔导入的流水不逐笔记动态（调用方记一条汇总）。逐笔走记账核心时 5000 行要 40 多秒。
 */
export async function insertImportedRows(
  manager: EntityManager,
  input: { user: JwtUser; importId: string; fallbackTitle: string; account: FinanceAccount; rows: readonly PlannedImportRow[] },
) {
  const { user, account, importId } = input;
  const householdId = user.householdId;
  const categories = new Map(
    (await manager.getRepository(FinanceCategory).find({ where: { householdId, isActive: true } })).map((one) => [one.id, one]),
  );
  const accounts = new Set(
    (await manager.getRepository(FinanceAccount).find({ where: { householdId, isActive: true }, select: { id: true } })).map((one) => one.id),
  );
  const transactions: Partial<FinanceTransaction>[] = [];
  const postings: Partial<FinancePosting>[] = [];
  for (const { row, type, categoryId, toAccountId } of input.rows) {
    if (type === 'transfer') {
      if (!toAccountId) throw new BadRequestException(`第 ${row.rowNo} 行记成转账要选转入账户`);
      if (toAccountId === account.id) throw new BadRequestException(`第 ${row.rowNo} 行的转入账户就是导入的这个账户`);
      if (!accounts.has(toAccountId)) throw new NotFoundException(`第 ${row.rowNo} 行的转入账户不存在或已停用`);
    } else {
      if (!categoryId) throw new BadRequestException(`第 ${row.rowNo} 行没选分类`);
      const category = categories.get(categoryId);
      if (!category || category.kind !== type) throw new NotFoundException(`第 ${row.rowNo} 行的分类不存在、已停用或收支对不上`);
    }
    const value = amount(row.amount);
    // 流水名字用交易对方（「康安大药房-望京店」比「药品」好认），商品说明放备注
    const product = row.title && row.title !== '/' && row.title !== row.merchant ? row.title : null;
    const title = (row.merchant || product || input.fallbackTitle).slice(0, 120);
    const note = row.merchant && product ? product.slice(0, 1000) : null;
    const finalCategory = type === 'transfer' ? null : categoryId;
    const finalTo = type === 'transfer' ? toAccountId : null;
    const id = randomUUID();
    transactions.push({
      id,
      householdId,
      type,
      amount: value,
      currency: 'CNY',
      title,
      note,
      occurredOn: row.occurredOn,
      categoryId: finalCategory,
      actorId: user.memberId,
      actorName: user.name,
      sourceType: 'import',
      sourceId: importId,
      externalId: row.externalId ? row.externalId.slice(0, 64) : null,
      merchant: row.merchant ? row.merchant.slice(0, 120) : null,
      idempotencyKey: `import:${importId}:${row.externalId ?? `row-${row.rowNo}`}`.slice(0, 180),
      requestFingerprint: fingerprint({
        type,
        amount: value,
        accountId: account.id,
        toAccountId: finalTo,
        categoryId: finalCategory,
        title,
        note,
        occurredOn: row.occurredOn,
        sourceType: 'import',
        sourceId: importId,
      }),
      reversalOfId: null,
    });
    postings.push({
      householdId,
      transactionId: id,
      accountId: account.id,
      delta: type === 'income' ? value : (-Number(value)).toFixed(2),
    });
    if (finalTo) postings.push({ householdId, transactionId: id, accountId: finalTo, delta: value });
  }
  for (let start = 0; start < transactions.length; start += CHUNK) {
    await manager.createQueryBuilder().insert().into(FinanceTransaction).values(transactions.slice(start, start + CHUNK)).updateEntity(false).execute();
  }
  for (let start = 0; start < postings.length; start += CHUNK) {
    await manager.createQueryBuilder().insert().into(FinancePosting).values(postings.slice(start, start + CHUNK)).updateEntity(false).execute();
  }
  return transactions.length;
}
