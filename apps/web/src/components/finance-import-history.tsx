import { useState } from 'react';
import { FINANCE_IMPORT_SOURCE_INFO } from '@family/contracts';
import { useFinanceImports } from '../lib/queries';

function when(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 「流水」下方的导入记录（K1）：默认收起，只列确认过的批次（放弃的预览接口里有、这里不摆）。
 * 只列表，不回滚——导错了用流水上的「撤销」逐笔改。
 */
export function ImportHistory() {
  const imports = useFinanceImports();
  const [open, setOpen] = useState(false);
  const rows = (imports.data ?? []).filter((row) => row.status === 'committed');
  if (!rows.length) return null;
  return (
    <section className="flex-none overflow-hidden rounded-card border border-border bg-surface">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition-colors duration-150 hover:bg-muted"
        onClick={() => setOpen(!open)}
      >
        <h2 className="flex-1 text-[13px] font-semibold text-ink-soft">导入记录 · {rows.length} 次</h2>
        <span
          aria-hidden
          className={'text-[12px] text-ink-soft transition-transform duration-200 ease-out ' + (open ? 'rotate-90' : '')}
        >
          ›
        </span>
      </button>
      {open ? (
        <ul className="max-h-[320px] overflow-y-auto border-t border-border">
          {rows.map((row, index) => (
            <li key={row.id} className={'px-3.5 py-2.5 ' + (index ? 'border-t border-border' : '')}>
              <div className="flex items-baseline gap-2">
                <p className="min-w-0 flex-1 truncate text-[14px]">
                  {FINANCE_IMPORT_SOURCE_INFO[row.source].label} → {row.account.name}
                </p>
                <span className="shrink-0 text-[12px] tabular-nums text-ink-soft">{when(row.committedAt ?? row.createdAt)}</span>
              </div>
              <p className="mt-0.5 truncate text-[12px] text-ink-soft">
                导入 {row.importedRows} · 跳过 {row.skippedRows} · 重复 {row.duplicateRows} · {row.createdBy.name}
                {row.rangeFrom && row.rangeTo ? ` · 账单 ${row.rangeFrom} 至 ${row.rangeTo}` : ''}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
