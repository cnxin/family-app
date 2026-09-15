import { ValidationError } from './errors';

/** 去首尾空白；空串、undefined、null 一律归一为 null。 */
export function normalizedText(value?: string | null): string | null {
  return value?.trim() || null;
}

/** 去首尾空白且不允许为空；为空时抛 `${label}不能为空`。 */
export function normalizedRequiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new ValidationError(`${label}不能为空`);
  return normalized;
}
