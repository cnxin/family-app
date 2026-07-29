export function normalizeLoginName(value: string) {
  return value.trim().toLocaleLowerCase('en-US');
}
