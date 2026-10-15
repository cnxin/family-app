import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import { FinanceAccount, FinanceCategory, FinanceTransactionSourceType } from '../entities';
import type { CreateFinanceTransactionDto } from './finance.dto';

// 账本服务（K3 起从 finance.module.ts 原样搬出：周期账单服务要用它，放在模块文件里会互相 import）。

export const MAX_AMOUNT = 999_999_999_999.99;

export type FinanceCreateSource = {
  sourceType: FinanceTransactionSourceType;
  sourceId?: string;
  /** K1 导入：交易单号（按家庭 + 来源唯一）与交易对方 */
  externalId?: string | null;
  merchant?: string | null;
  /** K2 截图记账：截图文件名（uploads/.private/finance/<家庭>/ 下） */
  attachmentPath?: string | null;
  /** K5 改金额 / 账户另记的新笔：记在原来那笔的记账人名下（不是改的人），记录时间沿用原笔（列表里位置不变） */
  actor?: { memberId: string; name: string };
  createdAt?: Date;
};

export function amount(value: number | string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_AMOUNT) {
    throw new BadRequestException(`金额必须在 0.01 到 ${MAX_AMOUNT} 之间`);
  }
  return parsed.toFixed(2);
}

export function money(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Math.round(parsed * 100) / 100;
}

export function normalized(value?: string | null) {
  return value?.trim() || null;
}

/**
 * 流水搜索框（K5；K 收尾加金额；C2 批 2 两种都找）：纯数字（可带小数点）按金额精确找、「100-200」按金额范围找
 * （两头都算，反着写也认），同时也按文字找名称 / 商户 / 备注里含这串字的（「12306」这类），列表里金额对上的排前面；
 * 别的只按文字找。返回 null 表示没填。
 */
export function parseLedgerSearch(raw: string | undefined | null) {
  const text = raw?.trim();
  if (!text) return null;
  const number = String.raw`\d+(?:\.\d{1,2})?`;
  const exact = text.match(new RegExp(`^(${number})$`));
  if (exact) return { kind: 'amount' as const, min: Number(exact[1]).toFixed(2), max: Number(exact[1]).toFixed(2), text };
  const range = text.match(new RegExp(`^(${number})\\s*[-~～—－]\\s*(${number})$`));
  if (range) {
    const [low, high] = [Number(range[1]), Number(range[2])].sort((a, b) => a - b);
    return { kind: 'amount' as const, min: low.toFixed(2), max: high.toFixed(2), text };
  }
  return { kind: 'text' as const, text };
}

export function assertDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('记账日期不是有效的日历日期');
  }
}

export async function prepareTransaction(
  dto: CreateFinanceTransactionDto,
  user: JwtUser,
  manager: EntityManager,
) {
  assertDate(dto.occurredOn);
  amount(dto.amount);
  const account = await requireAccount(dto.accountId, user.householdId, manager, false);
  let toAccount: FinanceAccount | null = null;
  let category: FinanceCategory | null = null;
  if (dto.type === 'transfer') {
    if (!dto.toAccountId) throw new BadRequestException('转账必须选择转入账户');
    if (dto.toAccountId === dto.accountId) throw new BadRequestException('转出与转入账户不能相同');
    if (dto.categoryId) throw new BadRequestException('账户间转账不使用收支分类');
    toAccount = await requireAccount(dto.toAccountId, user.householdId, manager, false);
  } else {
    if (dto.toAccountId) throw new BadRequestException('收支流水不能设置转入账户');
    if (!dto.categoryId) throw new BadRequestException('收入和支出必须选择分类');
    category = await manager.getRepository(FinanceCategory).findOneBy({
      id: dto.categoryId,
      householdId: user.householdId,
      kind: dto.type,
      isActive: true,
    });
    if (!category) throw new NotFoundException('所选收支分类不存在或已停用');
  }
  return { account, toAccount, category };
}

export async function requireAccount(
  id: string,
  householdId: string,
  manager: EntityManager,
  includeInactive: boolean,
) {
  const account = await manager.getRepository(FinanceAccount).findOneBy({
    id,
    householdId,
    ...(includeInactive ? {} : { isActive: true }),
  });
  if (!account) throw new NotFoundException('财务账户不存在或已停用');
  return account;
}
