import type { FinanceTransaction, FinanceTransactionType } from '@family/contracts';
import { yuan } from '../lib/queries';
import { Checkbox } from './ui';

const TYPE_STYLE: Record<FinanceTransactionType, { emoji: string; className: string }> = {
  expense: { emoji: '↗', className: 'text-danger' },
  income: { emoji: '↙', className: 'text-accent' },
  transfer: { emoji: '⇄', className: 'text-ink' },
  reversal: { emoji: '↺', className: 'text-ink-soft' },
};

function signed(type: FinanceTransactionType, amount: number) {
  if (type === 'expense') return `-${yuan(amount)}`;
  if (type === 'income') return `+${yuan(amount)}`;
  return yuan(amount);
}

/** 转账两条分录按先转出后转入显示（后端已按写入顺序给，这里再按正负排一次保险）。 */
function accountPath(entry: FinanceTransaction) {
  return [...entry.postings]
    .sort((a, b) => a.delta - b.delta)
    .map((posting) => posting.account?.name)
    .filter(Boolean)
    .join(' → ');
}

/**
 * 流水一行（K5）：能改的整行点开编辑（电脑上另有「编辑」按钮）；选择模式下整行点击 = 勾选。
 * 「显示已删除」时，删掉的、改过的灰着显示，标「已删除」「已改为 →」，不能再改。
 */
export function LedgerRow({
  entry,
  first,
  editable,
  selecting,
  selected,
  onToggle,
  onEdit,
}: {
  entry: FinanceTransaction;
  first: boolean;
  editable: boolean;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const style = TYPE_STYLE[entry.type];
  const hidden = Boolean(entry.deletedAt || entry.supersededById);
  const interactive = editable;
  const activate = () => {
    if (!interactive) return;
    if (selecting) onToggle();
    else onEdit();
  };
  return (
    <article
      aria-label={entry.title}
      tabIndex={interactive ? 0 : undefined}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        activate();
      }}
      className={
        'flex items-center gap-2 px-3.5 py-3 outline-none transition-colors duration-150 ' +
        (first ? '' : 'border-t border-border ') +
        (interactive ? 'cursor-pointer hover:bg-muted/60 focus-visible:bg-muted ' : '') +
        (selected ? 'bg-accent-soft/60 ' : '') +
        (entry.reversed || hidden ? 'opacity-60' : '')
      }
    >
      {selecting ? (
        <span onClick={(event) => event.stopPropagation()}>
          <Checkbox label={`选中${entry.title}`} checked={selected} disabled={!editable} onChange={onToggle} />
        </span>
      ) : (
        <span className={`grid size-8 shrink-0 place-items-center rounded-lg bg-muted ${style.className}`}>{style.emoji}</span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium">{entry.title}</p>
        <p className="truncate text-[12px] text-ink-soft">
          {[
            entry.occurredOn,
            entry.category?.name,
            accountPath(entry),
            entry.sourceType === 'import' ? `${entry.actorName}导入` : entry.actorName,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {entry.note ? <p className="truncate text-[12px] text-ink-soft">{entry.note}</p> : null}
        {entry.reversed && !hidden ? <p className="text-[12px] text-warm">已经被一笔反向流水撤销</p> : null}
        {entry.deletedAt ? <p className="text-[12px] text-warm">已删除</p> : null}
        {entry.supersededBy ? (
          <p className="text-[12px] text-warm">已改为 → {signed(entry.supersededBy.type, entry.supersededBy.amount)}</p>
        ) : entry.supersededById ? (
          <p className="text-[12px] text-warm">已改为 → 新的一笔</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className={`text-[14px] font-semibold tabular-nums ${style.className}`}>{signed(entry.type, entry.amount)}</span>
        {editable && !selecting ? (
          <button
            type="button"
            aria-label={`编辑${entry.title}`}
            className="hidden h-8 rounded-lg px-2 text-[13px] text-ink-soft transition-colors duration-150 hover:bg-muted hover:text-ink sm:inline-flex sm:items-center"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
          >
            编辑
          </button>
        ) : null}
      </div>
    </article>
  );
}
