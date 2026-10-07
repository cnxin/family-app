// K5 导入清洗（docs/finance-plan.md §3-K5）：交易对方 / 商品说明去掉订单号样式的词和固定前缀。纯函数，
// 规则在 import-formats.ts 的 TEXT_CLEANING；单测见 scripts/finance-import.check.ts。
import { TEXT_CLEANING } from './import-formats';

const PREFIX = new RegExp(`^(?:${TEXT_CLEANING.prefixes.join('|')})\\s*[:：]\\s*`);

function isOrderToken(word: string) {
  return TEXT_CLEANING.orderTokens.some((pattern) => pattern.test(word));
}

/**
 * 清洗一段文字：去固定前缀 → 去订单号样式的词（按「-」分段、段内按空白分词；去掉了才重新用「-」拼回去，
 * 没去掉就原样不动）→ 只剩占位话或空的返回 null。
 * 「Z22047260030026100500099580-金帝星隆城」→「金帝星隆城」；「收款方备注:二维码收款」→ null；
 * 「柯桥东升路停车场-停车缴费-浙AGS6398」原样保留。
 */
export function cleanText(raw: string | null | undefined): string | null {
  let value = (raw ?? '').trim();
  for (let round = 0; round < 3 && PREFIX.test(value); round += 1) value = value.replace(PREFIX, '').trim();
  let removed = false;
  const segments = value
    .split(/\s*[-－—–]\s*/)
    .map((segment) => {
      const words = segment.split(/\s+/).filter(Boolean);
      const kept = words.filter((word) => !isOrderToken(word));
      if (kept.length !== words.length) removed = true;
      return kept.join(' ');
    })
    .filter(Boolean);
  if (removed) value = segments.join('-');
  value = value.trim();
  if (!value || (TEXT_CLEANING.placeholders as readonly string[]).includes(value)) return null;
  return value;
}

/** 名称（交易对方）与备注（商品说明）用同一套规则；分开起名是为了调用处读得清楚。 */
export const cleanTitle = cleanText;
export const cleanNote = cleanText;
