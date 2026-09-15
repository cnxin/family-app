/**
 * 判断错误是否是 PostgreSQL 唯一约束冲突（SQLSTATE 23505）。
 * 兼容 pg 直接抛出的错误（`code`）和 TypeORM 包装后的错误（`driverError.code`）。
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    code?: unknown;
    driverError?: { code?: unknown } | null;
  };
  return candidate.code === '23505' || candidate.driverError?.code === '23505';
}
