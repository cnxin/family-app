// K1 账单导入解析器（docs/finance-plan.md §3-K1）：输入上传的字节，输出一行一行的交易。纯函数，不碰数据库；
// 列名、收支写法、状态词都来自 import-formats.ts。单测见 scripts/finance-import.check.ts。
import { decodeText, decodeUnknown, isBlankRow, parseCsv } from './csv';
import {
  GENERIC_DIRECTIONS,
  GENERIC_REQUIRED,
  IMPORT_MAX_ROWS,
  STATEMENT_FORMATS,
  type GenericField,
  type ImportSource,
  type StatementField,
  type StatementFormat,
} from './import-formats';

export type StatementDirection = 'expense' | 'income' | 'not_counted';
export type StatementStatus = 'success' | 'closed' | 'refund';

export interface StatementRow {
  /** 数据行序号，从 1 起（预览、确认导入都按它对行） */
  rowNo: number;
  /** 在文件里是第几行（报错用） */
  line: number;
  occurredOn: string;
  merchant: string;
  title: string;
  amount: number;
  direction: StatementDirection;
  status: StatementStatus;
  /** 交易单号；通用 CSV 没选单号列时为 null */
  externalId: string | null;
  /** 平台自己的分类 / 交易类型（支付宝「交易分类」、微信「交易类型」） */
  platformCategory: string | null;
  payMethod: string | null;
}

export interface ParsedStatement {
  rows: StatementRow[];
  /** 列数不足、日期或金额看不懂而跳过的行（表尾汇总行也在这里） */
  skipped: { line: number; reason: string }[];
  rangeFrom: string | null;
  rangeTo: string | null;
}

/** 文件本身不对（找不到表头、缺列、行数超限）：消息直接给人看。 */
export class StatementFormatError extends Error {}

const FIELD_LABELS: Record<StatementField, string> = {
  occurredAt: '交易时间',
  platformCategory: '交易分类',
  merchant: '交易对方',
  title: '商品',
  direction: '收/支',
  amount: '金额',
  payMethod: '支付方式',
  status: '交易状态',
  externalId: '交易单号',
};

/** 「2026-09-30 21:15:03」「2026/9/30 21:15」「2026年9月30日」→ 2026-09-30；看不懂返回 null。 */
export function parseDate(raw: string): string | null {
  const match = raw.trim().match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 「¥1,234.50」「￥12.00」「-35.5」→ 带符号的数，两位小数；看不懂返回 null。 */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[¥￥,，\s]/g, '').replace(/^\+/, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100) / 100;
}

/** 表头里某个字段在哪一列：候选名先找完全相等，再找包含。 */
function findColumn(header: readonly string[], candidates: readonly string[]): number {
  const cells = header.map((cell) => cell.trim());
  for (const name of candidates) {
    const exact = cells.indexOf(name);
    if (exact >= 0) return exact;
  }
  for (const name of candidates) {
    const partial = cells.findIndex((cell) => cell.includes(name));
    if (partial >= 0) return partial;
  }
  return -1;
}

function directionOf(format: StatementFormat, raw: string): StatementDirection {
  const value = raw.trim();
  if (format.directions.expense.includes(value)) return 'expense';
  if (format.directions.income.includes(value)) return 'income';
  return 'not_counted';
}

function statusOf(format: StatementFormat, raw: string): StatementStatus {
  if (format.statuses.refund.some((word) => raw.includes(word))) return 'refund';
  if (format.statuses.closed.some((word) => raw.includes(word))) return 'closed';
  return 'success';
}

function range(rows: readonly StatementRow[]) {
  const dates = rows.map((row) => row.occurredOn).sort();
  return { rangeFrom: dates[0] ?? null, rangeTo: dates.at(-1) ?? null };
}

/** 支付宝 / 微信导出的账单：按格式表找表头、对列、逐行转换。 */
export function parseStatement(buffer: Buffer, source: ImportSource): ParsedStatement {
  const format = STATEMENT_FORMATS[source];
  const table = parseCsv(decodeText(buffer, format.encoding));
  const headerIndex = table.findIndex((row) => row.some((cell) => cell.includes(format.headerAnchor)));
  if (headerIndex < 0) {
    throw new StatementFormatError(
      `这个文件里找不到表头（含「${format.headerAnchor}」的那一行），不像是${format.label}导出的账单`,
    );
  }
  const header = table[headerIndex];
  const columns = {} as Record<StatementField, number>;
  for (const field of Object.keys(format.columns) as StatementField[]) {
    columns[field] = findColumn(header, format.columns[field]);
  }
  const missing = format.required.filter((field) => columns[field] < 0);
  if (missing.length) {
    const detail = missing.map((field) => `${FIELD_LABELS[field]}（认的列名：${format.columns[field].join(' / ')}）`).join('、');
    throw new StatementFormatError(`${format.label}账单里找不到这些列：${detail}。导出格式可能改了`);
  }
  const needCells = Math.max(...format.required.map((field) => columns[field])) + 1;
  const cell = (row: readonly string[], field: StatementField) => (columns[field] >= 0 ? (row[columns[field]] ?? '').trim() : '');
  const rows: StatementRow[] = [];
  const skipped: ParsedStatement['skipped'] = [];
  for (let index = headerIndex + 1; index < table.length; index += 1) {
    const row = table[index];
    const line = index + 1;
    if (isBlankRow(row)) continue;
    if (row.length < needCells) {
      skipped.push({ line, reason: '列数不足（表尾汇总行之类）' });
      continue;
    }
    const occurredOn = parseDate(cell(row, 'occurredAt'));
    const amount = parseAmount(cell(row, 'amount'));
    if (!occurredOn || amount === null || amount === 0) {
      skipped.push({ line, reason: !occurredOn ? '交易时间看不懂' : '金额看不懂' });
      continue;
    }
    if (rows.length >= IMPORT_MAX_ROWS) {
      throw new StatementFormatError(`账单超过 ${IMPORT_MAX_ROWS} 行，分几次导出再导入`);
    }
    rows.push({
      rowNo: rows.length + 1,
      line,
      occurredOn,
      merchant: cell(row, 'merchant'),
      title: cell(row, 'title'),
      amount: Math.abs(amount),
      direction: directionOf(format, cell(row, 'direction')),
      status: statusOf(format, cell(row, 'status')),
      externalId: cell(row, 'externalId') || null,
      platformCategory: cell(row, 'platformCategory') || null,
      payMethod: cell(row, 'payMethod') || null,
    });
  }
  return { rows, skipped, ...range(rows) };
}

/** 通用 CSV 第一步：读出表头和数据行，让用户选列。编码自动判（UTF-8 不行就 GBK）。 */
export function readGenericTable(buffer: Buffer): { headers: string[]; rows: string[][]; firstLine: number } {
  const table = parseCsv(decodeUnknown(buffer).text);
  const headerIndex = table.findIndex((row) => !isBlankRow(row));
  if (headerIndex < 0) throw new StatementFormatError('文件是空的');
  const headers = table[headerIndex].map((cell) => cell.trim());
  if (headers.length < 2) throw new StatementFormatError('第一行只有一列，看起来不是逗号分隔的 CSV');
  const rows = table.slice(headerIndex + 1);
  if (rows.filter((row) => !isBlankRow(row)).length > IMPORT_MAX_ROWS) {
    throw new StatementFormatError(`账单超过 ${IMPORT_MAX_ROWS} 行，分几次导出再导入`);
  }
  return { headers, rows, firstLine: headerIndex + 2 };
}

/** 通用 CSV 的列对应：字段 → 第几列（从 0 起）；单号、备注、收支可不选（null）。 */
export type GenericMapping = Record<GenericField, number | null>;

export function validateGenericMapping(headers: readonly string[], mapping: GenericMapping): string | null {
  const labels: Record<GenericField, string> = {
    occurredOn: '日期', amount: '金额', direction: '收支', merchant: '对方', note: '备注', externalId: '单号',
  };
  for (const field of GENERIC_REQUIRED) {
    if (mapping[field] === null || mapping[field] === undefined) return `「${labels[field]}」这一列要选`;
  }
  for (const [field, index] of Object.entries(mapping) as [GenericField, number | null][]) {
    if (index !== null && (index < 0 || index >= headers.length)) return `「${labels[field]}」选的列不存在`;
  }
  return null;
}

/** 通用 CSV 第二步：按用户选的列转成交易行。收支列没选时按金额正负（负数是支出）。 */
export function parseGenericRows(table: ReturnType<typeof readGenericTable>, mapping: GenericMapping): ParsedStatement {
  const rows: StatementRow[] = [];
  const skipped: ParsedStatement['skipped'] = [];
  const at = (row: readonly string[], field: GenericField) => {
    const index = mapping[field];
    return index === null ? '' : (row[index] ?? '').trim();
  };
  table.rows.forEach((row, offset) => {
    const line = table.firstLine + offset;
    if (isBlankRow(row)) return;
    const occurredOn = parseDate(at(row, 'occurredOn'));
    const amount = parseAmount(at(row, 'amount'));
    if (!occurredOn || amount === null || amount === 0) {
      skipped.push({ line, reason: !occurredOn ? '日期看不懂' : '金额看不懂' });
      return;
    }
    const rawDirection = at(row, 'direction').toLowerCase();
    let direction: StatementDirection;
    if (mapping.direction === null) direction = amount < 0 ? 'expense' : 'income';
    else if (GENERIC_DIRECTIONS.expense.some((word) => rawDirection.includes(word))) direction = 'expense';
    else if (GENERIC_DIRECTIONS.income.some((word) => rawDirection.includes(word))) direction = 'income';
    else direction = 'not_counted';
    const merchant = at(row, 'merchant');
    rows.push({
      rowNo: rows.length + 1,
      line,
      occurredOn,
      merchant,
      title: at(row, 'note') || merchant,
      amount: Math.abs(amount),
      direction,
      status: 'success',
      externalId: at(row, 'externalId') || null,
      platformCategory: null,
      payMethod: null,
    });
  });
  return { rows, skipped, ...range(rows) };
}
