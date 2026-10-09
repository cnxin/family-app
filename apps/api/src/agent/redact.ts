// 发给云端模型前的脱敏（J4.3，docs/j4-agent-plan.md §2 第 4 条，tier2Redact 开时）：
// - 成员真名 → 称呼。成员表没有昵称 / 称呼字段，统一换成「成员 N」（N 按加入家庭的先后）；
// - 手机号（11 位、1 开头）、车牌（省简称 + 字母 + 5～6 位）、身份证样式（18 位）、银行卡样式（16～19 位数字）
//   → 保留前 2 后 2，中间换成 *；
// - 金额、日期、地址、位置名不动（否则财务、日程、找东西都答不了）。回程不还原。
import type { DataSource } from 'typeorm';

export interface RedactionContext {
  /** 真名 → 称呼；长的先换（「王小明」先于「小明」）。 */
  readonly names: readonly { readonly name: string; readonly alias: string }[];
}

const mask = (value: string) => `${value.slice(0, 2)}${'*'.repeat(Math.max(value.length - 4, 1))}${value.slice(-2)}`;

const PATTERNS: readonly RegExp[] = [
  // 身份证样式：17 位数字 + 数字或 X
  /(?<![0-9A-Za-z])\d{17}[\dXx](?![0-9A-Za-z])/g,
  // 银行卡样式：16～19 位数字
  /(?<![0-9A-Za-z])\d{16,19}(?![0-9A-Za-z])/g,
  // 手机号：11 位、1 开头、第二位 3～9
  /(?<!\d)1[3-9]\d{9}(?!\d)/g,
  // 车牌：省简称 + 字母（不含 I、O）+ 5～6 位字母数字
  /[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-HJ-NP-Z][A-HJ-NP-Z0-9]{5,6}(?![A-Za-z0-9])/g,
];

export function redactForModel(text: string, context: RedactionContext): string {
  let result = text;
  for (const pattern of PATTERNS) result = result.replace(pattern, mask);
  for (const { name, alias } of context.names) {
    if (name.length >= 2) result = result.split(name).join(alias);
  }
  return result;
}

/** 本家庭成员的真名 → 「成员 N」。名字只有一个字的不换（会误伤正文里的常用字）。 */
export async function redactionContext(dataSource: DataSource, householdId: string): Promise<RedactionContext> {
  const members: { name: string }[] = await dataSource.query(
    `SELECT name FROM members WHERE "householdId" = $1 ORDER BY "createdAt", id`,
    [householdId],
  );
  return {
    names: members
      .map((member, index) => ({ name: member.name.trim(), alias: `成员${index + 1}` }))
      .filter((entry) => entry.name.length >= 2)
      .sort((left, right) => right.name.length - left.name.length),
  };
}
