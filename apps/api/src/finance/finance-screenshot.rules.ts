// K2 截图记账的纯函数（docs/finance-plan.md §3-K2）：识别提示词、模型回复的解析、日期归一、按付款方式猜账户。
// 单测见 scripts/finance-screenshot.check.ts。
import {
  financeAttachmentName,
  financeScreenshotModelOutput,
  type FinanceAccountType,
  type FinanceScreenshotModelOutput,
} from '@family/contracts';
import { todayInShanghai } from '@family/shared';
import { cleanTitle } from './import/text-cleaning';

/** 系统提示词（固定模板，不带任何家庭数据）：只许返回一个 JSON 对象。 */
export const SCREENSHOT_SYSTEM_PROMPT = [
  '你是记账截图识别器。用户会发来一张付款或收款截图（支付宝、微信、银行 App、小票等）。',
  '只输出一个 JSON 对象，不要输出任何别的文字，不要用代码块。字段：',
  'amount：金额，数字，单位元，不带货币符号；',
  'direction："expense"（支出）或 "income"（收入）；',
  'merchant：交易对方或商户名，看不出就 null；',
  'occurredAt：交易时间，格式 YYYY-MM-DD HH:mm，看不出就 null；',
  'payMethod：付款方式原文，如「花呗」「余额」「零钱」「招商银行信用卡(1234)」，看不出就 null；',
  'note：商品说明或备注，看不出就 null。',
  '截图里不是一笔交易时输出 {"amount": null}。',
].join('\n');

export const SCREENSHOT_USER_PROMPT = '识别这张截图里的这一笔交易。';
export const SCREENSHOT_UNRECOGNIZED = '没认出来，手动填吧';

/**
 * 解析模型回复：容忍代码块包裹、前后多余的字；取第一个「{」到最后一个「}」按 JSON 解析，再按契约校验。
 * 不是 JSON、金额不对、收支不对都返回 null（调用方重试一次）。金额按分四舍五入。
 */
export function parseScreenshotReply(text: string): FinanceScreenshotModelOutput | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = financeScreenshotModelOutput.safeParse(raw);
  if (!parsed.success) return null;
  const amount = Math.round(parsed.data.amount * 100) / 100;
  return amount > 0 ? { ...parsed.data, amount } : null;
}

function validDate(year: number, month: number, day: number) {
  const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

/**
 * 交易时间 → 记账日期（YYYY-MM-DD）。认「2026-10-09 12:30」「2026/10/09」「2026年10月9日」，
 * 以及没写年份的「10月9日」「10-09」（按今年；算出来在明天之后就当去年）。认不出返回 null（表单保持默认日期）。
 */
export function normalizeOccurredOn(raw: string | null | undefined, today = todayInShanghai()): string | null {
  if (!raw) return null;
  const text = raw.trim();
  const full = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/.exec(text);
  if (full) return validDate(Number(full[1]), Number(full[2]), Number(full[3]));
  const short = /^(\d{1,2})\s*[-/.月]\s*(\d{1,2})(?:日|号|\s|$|T)/.exec(text);
  if (!short) return null;
  const year = Number(today.slice(0, 4));
  const value = validDate(year, Number(short[1]), Number(short[2]));
  if (!value) return null;
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return value > tomorrow.toISOString().slice(0, 10) ? validDate(year - 1, Number(short[1]), Number(short[2])) : value;
}

export interface GuessableAccount {
  id: string;
  name: string;
  type: FinanceAccountType;
  isActive: boolean;
}

const squeeze = (value: string) => value.replace(/[\s（）()【】[\]·・\-_]/g, '').toLowerCase();

/** 只有一个候选才选它；多个时挑名字和付款方式对得上的，还分不出就不猜。 */
function pick(candidates: GuessableAccount[], payMethod: string) {
  if (candidates.length === 1) return candidates[0].id;
  const named = candidates.filter((account) => squeeze(payMethod).includes(squeeze(account.name)));
  return named.length === 1 ? named[0].id : null;
}

/**
 * 按付款方式猜账户（停用的不算），依次：
 * 1. 付款方式里写着某个账户的名字（「招商银行信用卡(1234)」对上账户「招商银行信用卡」）→ 它；
 * 2. 写着「信用卡」→ 信用卡账户（多张时按银行名挑）；写着「××银行」「储蓄卡」「借记卡」→ 银行账户（同上）。
 *    排在支付宝 / 微信之前：「微信支付-招商银行信用卡」钱是从信用卡出的；
 * 3. 「花呗 / 余额宝 / 余额 / 支付宝」→ 支付宝类账户；
 * 4. 「零钱 / 微信」→ 微信类账户。
 * 都对不上返回 null（表单让人自己选）。
 */
export function guessAccount(payMethod: string | null | undefined, accounts: readonly GuessableAccount[]): string | null {
  const method = payMethod?.trim();
  if (!method) return null;
  const active = accounts.filter((account) => account.isActive);
  const byName = active.filter((account) => squeeze(account.name).length >= 2 && squeeze(method).includes(squeeze(account.name)));
  if (byName.length === 1) return byName[0].id;
  const ofType = (type: FinanceAccountType) => active.filter((account) => account.type === type);
  // 账户名开头的「××银行」出现在付款方式里就算同一家银行
  const bankOf = (name: string) => /^(.{2,6}?银行)/.exec(name)?.[1] ?? null;
  const byBank = (candidates: GuessableAccount[]) => {
    const sameBank = candidates.filter((account) => {
      const bank = bankOf(account.name);
      return bank != null && method.includes(bank);
    });
    if (sameBank.length) return pick(sameBank, method);
    // 写了银行却对不上任何账户：不猜；没写银行：只有一张才选
    return /银行/.test(method) ? null : pick(candidates, method);
  };
  if (/信用卡/.test(method)) return byBank(ofType('credit'));
  if (/银行|储蓄卡|借记卡/.test(method)) return byBank(ofType('bank'));
  if (/花呗|余额宝|余额|支付宝/.test(method)) return pick(ofType('alipay'), method);
  if (/零钱|微信/.test(method)) return pick(ofType('wechat'), method);
  return null;
}

/** 预填的账目名称：清洗过的商户名，没有用备注，都没有用「截图记账」（≤ 120 字）。 */
export function screenshotTitle(merchant: string | null | undefined, note: string | null | undefined) {
  return (cleanTitle(merchant ?? null) || cleanTitle(note ?? null) || '截图记账').slice(0, 120);
}

/** 按文件头认图片类型（不信客户端声明的类型）：只认 JPG / PNG / WebP。 */
export function sniffScreenshot(buffer: Buffer): { ext: '.jpg' | '.png' | '.webp'; mime: string } | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: '.jpg', mime: 'image/jpeg' };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: '.png', mime: 'image/png' };
  }
  if (buffer.length >= 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') {
    return { ext: '.webp', mime: 'image/webp' };
  }
  return null;
}

/** 孤儿截图：识别了却没确认记账，留在目录里的。超过这么久、没有流水引用就删（第四批收尾）。 */
export const ORPHAN_SCREENSHOT_AGE_MS = 24 * 60 * 60 * 1000;
/** 每轮最多删这么多（各家庭合计），删不完下一轮接着删。 */
export const ORPHAN_SCREENSHOT_BATCH = 200;

/**
 * 一个家庭的截图目录里该删的文件：修改时间早于 24 小时、没有任何流水的 attachmentPath 引用它，最旧的先删，
 * 最多 limit 个。文件名不是「uuid + .jpg / .png / .webp」的不认、不删（不是识别接口存的）。
 */
export function orphanScreenshots(
  files: readonly { name: string; mtimeMs: number }[],
  referenced: ReadonlySet<string>,
  now: number,
  limit = ORPHAN_SCREENSHOT_BATCH,
): string[] {
  return files
    .filter((file) => financeAttachmentName.safeParse(file.name).success)
    .filter((file) => now - file.mtimeMs > ORPHAN_SCREENSHOT_AGE_MS && !referenced.has(file.name))
    .sort((left, right) => left.mtimeMs - right.mtimeMs)
    .slice(0, Math.max(limit, 0))
    .map((file) => file.name);
}
