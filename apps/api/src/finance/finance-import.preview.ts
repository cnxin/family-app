import type { FinanceImportFlag, FinanceImportPreviewRow } from '@family/contracts';
import { EntityManager, In, Not } from 'typeorm';
import {
  FinanceAccount,
  FinanceCategory,
  FinanceMerchantRule,
  FinancePosting,
  FinanceTransaction,
} from '../entities';
import type { StatementRow } from './import/import-parser';
import { normalizeMerchant, suggestCategory } from './import/merchant-rules';

// K1 预览：把解析出的行配上标记、建议的类型 / 分类 / 转入账户、默认勾不勾（docs/finance-plan.md §3-K1 行规则）。

/** 存进 finance_imports.preview 的一行：比接口多一个单号（确认时用）。 */
export type StoredPreviewRow = FinanceImportPreviewRow & { externalId: string | null };

export type StoredPreview =
  | { stage: 'mapping'; headers: string[]; rows: string[][]; firstLine: number }
  | { stage: 'ready'; rows: StoredPreviewRow[]; skipped: { line: number; reason: string }[] };

export function previewStats(rows: readonly StoredPreviewRow[], skippedLines: number) {
  const flagged = (flag: FinanceImportFlag) => rows.filter((row) => row.flags.includes(flag)).length;
  return {
    total: rows.length,
    suggested: rows.filter((row) => row.included).length,
    alreadyImported: flagged('already_imported'),
    suspectedDuplicate: flagged('suspected_duplicate'),
    notCounted: flagged('not_counted'),
    closed: flagged('closed'),
    refund: flagged('refund'),
    skippedLines,
  };
}

/**
 * 行规则：
 * - 支出 + 成功 → 建议支出、勾上；收入 → 建议收入、勾上（对方 / 商品里有「退款」的建议「退款」分类）；
 * - 不计收支 → 不勾；对方名对得上家里另一个在用账户的，建议转账并预填转入账户，否则建议支出；
 * - 交易关闭 / 退款 → 不勾；
 * - 单号以前导过（导成了流水，或在以前确认的批次里出现过），或同一文件里前面出现过 → 已导入，不能勾；
 * - 同账户、同金额、同日已有一笔不是导入的流水 → 疑似重复，不勾（可以手动勾上）；没有单号的导入流水（通用 CSV 没选单号列）
 *   也算进来，否则同一份无单号的 CSV 导两次就全重了。
 */
export async function buildPreviewRows(
  manager: EntityManager,
  input: {
    householdId: string;
    account: FinanceAccount;
    rows: readonly StatementRow[];
    platformCategories: Readonly<Record<string, string>>;
  },
): Promise<StoredPreviewRow[]> {
  const { householdId, account, rows } = input;
  // 一个个查：选列那一步在事务里，同一个连接上不能并发查询
  const categories = await manager.getRepository(FinanceCategory).find({ where: { householdId, isActive: true } });
  const learned = await manager.getRepository(FinanceMerchantRule).find({ where: { householdId } });
  const otherAccounts = await manager
    .getRepository(FinanceAccount)
    .find({ where: { householdId, isActive: true, id: Not(account.id) } });
  const kindOf = new Map(categories.map((category) => [category.id, category.kind]));
  const bySystemKey = new Map(categories.filter((one) => one.systemKey).map((one) => [one.systemKey!, one.id]));
  const learnedByKind = {
    expense: learned.filter((rule) => rule.kind === 'expense'),
    income: learned.filter((rule) => rule.kind === 'income'),
  };

  const externalIds = [...new Set(rows.map((row) => row.externalId).filter((id): id is string => Boolean(id)))];
  const imported = new Set<string>();
  for (let start = 0; start < externalIds.length; start += 1000) {
    const found = await manager.getRepository(FinanceTransaction).find({
      where: { householdId, sourceType: 'import', externalId: In(externalIds.slice(start, start + 1000)) },
      select: { id: true, externalId: true },
    });
    for (const one of found) if (one.externalId) imported.add(one.externalId);
    // 以前确认过的批次里出现过的单号（当时选了不导的也算处理过）
    const processed: { id: string }[] = await manager.query(
      `SELECT DISTINCT value AS id
         FROM finance_imports, jsonb_array_elements_text("processedExternalIds") AS value
        WHERE "householdId" = $1 AND status = 'committed' AND value = ANY($2::text[])`,
      [householdId, externalIds.slice(start, start + 1000)],
    );
    for (const one of processed) imported.add(one.id);
  }

  // 疑似重复：这个账户上、这段日子里不是导入（或导入了但没单号）的收支流水（没被冲销），按「日期 | 金额」
  const dates = rows.map((row) => row.occurredOn).sort();
  const existing: { occurredOn: string; amount: string }[] = dates.length
    ? await manager
        .getRepository(FinancePosting)
        .createQueryBuilder('posting')
        .innerJoin('posting.transaction', 'transaction')
        // date 列原样取会变成 JS Date，按文本取才好和账单里的日期比
        .select(`CAST("transaction"."occurredOn" AS text)`, 'occurredOn')
        .addSelect('ABS(posting.delta)', 'amount')
        .where('posting.accountId = :accountId', { accountId: account.id })
        .andWhere('transaction.householdId = :householdId', { householdId })
        .andWhere("transaction.type IN ('expense', 'income')")
        .andWhere("(transaction.sourceType <> 'import' OR transaction.externalId IS NULL)")
        .andWhere('transaction.occurredOn BETWEEN :from AND :to', { from: dates[0], to: dates.at(-1) })
        .andWhere(
          'NOT EXISTS (SELECT 1 FROM finance_transactions reversal WHERE reversal."reversalOfId" = transaction.id)',
        )
        .getRawMany()
    : [];
  const manual = new Set(existing.map((one) => `${one.occurredOn}|${Number(one.amount).toFixed(2)}`));

  const transferTarget = (merchant: string) => {
    const name = normalizeMerchant(merchant);
    if (name.length < 2) return null;
    return (
      otherAccounts.find((other) => {
        const target = normalizeMerchant(other.name);
        return target.length >= 2 && (name === target || name.includes(target) || target.includes(name));
      }) ?? null
    );
  };
  const categoryFor = (row: StatementRow, kind: 'expense' | 'income') => {
    const suggestion = suggestCategory(
      { merchant: row.merchant, title: row.title, kind, platformCategory: row.platformCategory },
      learnedByKind[kind],
      (id) => kindOf.get(id) ?? null,
      input.platformCategories,
    );
    if ('categoryId' in suggestion) return suggestion.categoryId;
    return bySystemKey.get(suggestion.systemKey) ?? bySystemKey.get(kind === 'income' ? 'income_other' : 'expense_other') ?? null;
  };

  const seen = new Set<string>();
  return rows.map((row): StoredPreviewRow => {
    const flags: FinanceImportFlag[] = [];
    if (row.externalId) {
      if (imported.has(row.externalId) || seen.has(row.externalId)) flags.push('already_imported');
      seen.add(row.externalId);
    }
    if (row.direction === 'not_counted') flags.push('not_counted');
    if (row.status === 'closed') flags.push('closed');
    if (row.status === 'refund') flags.push('refund');
    if (!flags.includes('already_imported') && manual.has(`${row.occurredOn}|${row.amount.toFixed(2)}`)) {
      flags.push('suspected_duplicate');
    }
    const target = row.direction === 'not_counted' ? transferTarget(row.merchant) : null;
    const suggestedType = row.direction === 'income' ? 'income' : target ? 'transfer' : 'expense';
    const selectable = !flags.includes('already_imported');
    return {
      rowNo: row.rowNo,
      occurredOn: row.occurredOn,
      merchant: row.merchant,
      title: row.title,
      amount: row.amount,
      direction: row.direction,
      status: row.status,
      suggestedType,
      suggestedCategoryId: suggestedType === 'transfer' ? null : categoryFor(row, suggestedType),
      toAccountId: target?.id ?? null,
      flags,
      included: selectable && flags.length === 0,
      selectable,
      externalId: row.externalId,
    };
  });
}
