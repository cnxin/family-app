// 「最近用过的分类」本机记忆（K5 分类网格置顶用）：只是方便，读写失败当没有。
const KEY = 'family-app.finance.recent-categories';
const MAX = 12;

export function readRecentCategories(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((one): one is string => typeof one === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberCategory(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify([id, ...readRecentCategories().filter((one) => one !== id)].slice(0, MAX)));
  } catch {
    /* 隐私模式记不住，下次没有置顶而已 */
  }
}

/** 置顶顺序：本机最近选过的在前，再按这个月流水里用得多的补上（服务端数据）。 */
export function recentCategoryIds(transactions: readonly { categoryId: string | null }[]) {
  const counts = new Map<string, number>();
  for (const one of transactions) if (one.categoryId) counts.set(one.categoryId, (counts.get(one.categoryId) ?? 0) + 1);
  const frequent = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  return [...new Set([...readRecentCategories(), ...frequent])];
}
