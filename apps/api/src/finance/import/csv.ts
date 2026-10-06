// K1 账单导入：把上传的字节变成一格一格的字符串。纯函数，单测见 scripts/finance-import.check.ts。
// GBK 用 Node 自带的 TextDecoder（官方构建带完整 ICU，生产镜像 node:22 也带），不另加依赖。

/** 按指定编码解码；去掉开头的 BOM。 */
export function decodeText(buffer: Buffer, encoding: 'gbk' | 'utf-8'): string {
  const text = new TextDecoder(encoding).decode(buffer);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** 通用 CSV 不知道编码：先当 UTF-8 严格解码，解不了再当 GBK。 */
export function decodeUnknown(buffer: Buffer): { text: string; encoding: 'gbk' | 'utf-8' } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return { text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, encoding: 'utf-8' };
  } catch {
    return { text: decodeText(buffer, 'gbk'), encoding: 'gbk' };
  }
}

/**
 * RFC 4180 风格：逗号分隔，双引号包住的格子里可以有逗号、换行，两个双引号是一个双引号；\r\n / \n 都认。
 * 返回每一行的格子（原样，不 trim）；最后一个空行不算。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** 一行是不是全空（空行、只有逗号的行）。 */
export function isBlankRow(row: readonly string[]): boolean {
  return row.every((cell) => cell.trim() === '');
}
