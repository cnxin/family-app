import type { FinanceCategory, FinanceCategoryKind } from '@family/contracts';
import { Segmented } from './ui';

// 分类图标：后端存的是图标名（lucide 风格），这里换成 emoji；自建分类没对上的用名字第一个字。
const GLYPHS: Record<string, string> = {
  utensils: '🍜', house: '🏠', car: '🚗', 'shopping-bag': '🛍️', film: '🎬', 'heart-pulse': '💊', gift: '🎁',
  shirt: '👕', 'graduation-cap': '🎓', baby: '🍼', 'paw-print': '🐾', smartphone: '📱', zap: '💡', 'building-2': '🏢',
  shield: '🛡️', wrench: '🔧', plane: '✈️', laptop: '💻', cookie: '🍪', 'circle-ellipsis': '⋯', landmark: '💼',
  'badge-dollar-sign': '🏅', 'receipt-text': '🧾', 'trending-up': '📈', 'undo-2': '↩️', wallet: '🧧', 'circle-plus': '➕',
};

export function categoryGlyph(category: Pick<FinanceCategory, 'icon' | 'name'>) {
  return GLYPHS[category.icon] ?? category.name.slice(0, 1);
}

/**
 * 分类网格（K5）：记一笔、改一笔、批量改分类共用。最近用过的 6 个排在最前，支出 / 收入两页；
 * 手机上 4 列（一屏至少 3 行 12 格），电脑上 6 列。每格是一个按钮，读屏名字就是分类名。
 */
export function CategoryGrid({
  categories,
  kind,
  onKindChange,
  value,
  onChange,
  recent,
  label = '分类',
}: {
  categories: FinanceCategory[];
  kind: FinanceCategoryKind;
  /** 给了才出支出 / 收入两页的切换 */
  onKindChange?: (kind: FinanceCategoryKind) => void;
  value: string | null;
  onChange: (category: FinanceCategory) => void;
  recent: readonly string[];
  label?: string;
}) {
  const pickable = categories.filter((one) => one.kind === kind && (one.isActive || one.id === value));
  const pinned = recent
    .map((id) => pickable.find((one) => one.id === id))
    .filter((one): one is FinanceCategory => Boolean(one))
    .slice(0, 6);
  const ordered = [...pinned, ...pickable.filter((one) => !pinned.includes(one))];
  return (
    <div>
      {onKindChange ? (
        <div className="mb-2">
          <Segmented
            label="分类收支"
            value={kind}
            onChange={onKindChange}
            options={[
              { value: 'expense' as const, label: '支出' },
              { value: 'income' as const, label: '收入' },
            ]}
          />
        </div>
      ) : null}
      <div role="group" aria-label={label} className="grid grid-cols-4 gap-1 sm:grid-cols-6">
        {ordered.map((one) => {
          const active = one.id === value;
          return (
            <button
              key={one.id}
              type="button"
              aria-pressed={active}
              aria-label={one.name}
              className={
                'flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 py-1.5 transition-[background-color,color,transform] ' +
                'duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ' +
                (active ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-muted')
              }
              onClick={() => onChange(one)}
            >
              <span
                aria-hidden
                className={'grid size-9 place-items-center rounded-full text-[17px] ' + (active ? 'ring-2 ring-accent' : '')}
                style={{ backgroundColor: `${one.color}22` }}
              >
                {categoryGlyph(one)}
              </span>
              <span className="w-full truncate text-center text-[12px]">{one.name}</span>
            </button>
          );
        })}
      </div>
      {pinned.length ? <p className="mt-1 text-[11px] text-ink-soft">最近用过的排在前面</p> : null}
    </div>
  );
}
