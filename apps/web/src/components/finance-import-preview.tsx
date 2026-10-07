import { useState } from 'react';
import type { FinanceAccount, FinanceCategory, FinanceImportFlag, FinanceImportPreviewRow } from '@family/contracts';
import { IMPORT_DIRECTION_LABELS, IMPORT_FLAG_LABELS, yuan } from '../lib/queries';
import { useMediaQuery } from '../lib/use-media-query';
import { Button, Checkbox, Segmented, selectClass } from './ui';

/** 预览里每行最后怎么记：勾不勾、记成什么、分类 / 转入账户。默认取服务端的建议。 */
export type RowDecision = {
  included: boolean;
  type: 'expense' | 'income' | 'transfer';
  categoryId: string | null;
  toAccountId: string | null;
};

const PAGE = 100;
const FLAG_TONE: Record<FinanceImportFlag, string> = {
  already_imported: 'bg-muted text-ink-soft',
  suspected_duplicate: 'bg-warm/15 text-warm',
  not_counted: 'bg-muted text-ink-soft',
  closed: 'bg-muted text-ink-soft',
  refund: 'bg-muted text-ink-soft',
};

function rowName(row: FinanceImportPreviewRow) {
  return `第 ${row.rowNo} 行 ${row.merchant || row.title}`;
}

function AmountText({ row }: { row: FinanceImportPreviewRow }) {
  if (row.direction === 'expense') return <span className="tabular-nums text-danger">-{yuan(row.amount)}</span>;
  if (row.direction === 'income') return <span className="tabular-nums text-accent">+{yuan(row.amount)}</span>;
  return <span className="tabular-nums">{yuan(row.amount)}</span>;
}

function Flags({ flags }: { flags: FinanceImportFlag[] }) {
  if (!flags.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((flag) => (
        <span key={flag} className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] ${FLAG_TONE[flag]}`}>
          {IMPORT_FLAG_LABELS[flag]}
        </span>
      ))}
    </span>
  );
}

/** 一个下拉管三件事：支出分类、收入分类、转到家里另一个账户。 */
function CategorySelect({
  row,
  decision,
  categories,
  transferTargets,
  onChange,
  className = '',
}: {
  row: FinanceImportPreviewRow;
  decision: RowDecision;
  categories: FinanceCategory[];
  transferTargets: FinanceAccount[];
  onChange: (next: Partial<RowDecision>) => void;
  className?: string;
}) {
  const value =
    decision.type === 'transfer'
      ? decision.toAccountId ? `to:${decision.toAccountId}` : ''
      : decision.categoryId ? `cat:${decision.categoryId}` : '';
  const pickable = (kind: 'expense' | 'income') =>
    categories.filter((one) => one.kind === kind && (one.isActive || one.id === decision.categoryId));
  return (
    <select
      aria-label={`${rowName(row)}的分类`}
      className={`${selectClass} min-w-0 ${className}`}
      value={value}
      disabled={!row.selectable}
      onChange={(event) => {
        const [kind, id] = event.target.value.split(':');
        if (kind === 'to') return onChange({ type: 'transfer', categoryId: null, toAccountId: id, included: true });
        const category = categories.find((one) => one.id === id);
        if (category) onChange({ type: category.kind, categoryId: category.id, toAccountId: null, included: true });
      }}
    >
      <option value="" disabled>
        选分类
      </option>
      <optgroup label="支出">
        {pickable('expense').map((one) => (
          <option key={one.id} value={`cat:${one.id}`}>
            {one.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="收入">
        {pickable('income').map((one) => (
          <option key={one.id} value={`cat:${one.id}`}>
            {one.name}
          </option>
        ))}
      </optgroup>
      {transferTargets.length ? (
        <optgroup label="转账">
          {transferTargets.map((one) => (
            <option key={one.id} value={`to:${one.id}`}>
              转到{one.name}
            </option>
          ))}
        </optgroup>
      ) : null}
    </select>
  );
}

/**
 * 预览列表（K1）：电脑上是表格（勾选 / 日期 / 对方 / 商品 / 金额 / 收支 / 分类 / 标记），手机上每行一张卡片，
 * 勾选框在左、分类在卡底。行多的时候一次摆 100 行，免得几千个下拉把页面拖慢。
 */
export function ImportPreviewList({
  rows,
  decisions,
  categories,
  transferTargets,
  onChange,
  onIncludeMany,
}: {
  rows: FinanceImportPreviewRow[];
  decisions: Record<number, RowDecision>;
  categories: FinanceCategory[];
  transferTargets: FinanceAccount[];
  onChange: (rowNo: number, next: Partial<RowDecision>) => void;
  /** 全选 / 全不选 / 反选：只动当前筛选出来、能勾的行 */
  onIncludeMany: (included: Record<number, boolean>) => void;
}) {
  const desktop = useMediaQuery('(min-width: 768px)');
  const [filter, setFilter] = useState<'all' | 'included' | 'flagged'>('all');
  const [limit, setLimit] = useState(PAGE);
  const visible = rows.filter((row) =>
    filter === 'included' ? decisions[row.rowNo]?.included : filter === 'flagged' ? row.flags.length > 0 : true,
  );
  const shown = visible.slice(0, limit);
  const pickable = visible.filter((row) => row.selectable);
  const bulk = (mode: 'all' | 'none' | 'invert') =>
    onIncludeMany(
      Object.fromEntries(
        pickable.map((row) => [row.rowNo, mode === 'all' ? true : mode === 'none' ? false : !decisions[row.rowNo].included]),
      ),
    );
  const select = (row: FinanceImportPreviewRow, className?: string) => (
    <CategorySelect
      row={row}
      decision={decisions[row.rowNo]}
      categories={categories}
      transferTargets={transferTargets}
      onChange={(next) => onChange(row.rowNo, next)}
      className={className}
    />
  );
  const check = (row: FinanceImportPreviewRow) => (
    <Checkbox
      label={`导入${rowName(row)}`}
      checked={decisions[row.rowNo].included}
      disabled={!row.selectable}
      onChange={() => onChange(row.rowNo, { included: !decisions[row.rowNo].included })}
    />
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="筛选预览行"
          value={filter}
          onChange={(next) => {
            setFilter(next);
            setLimit(PAGE);
          }}
          options={[
            { value: 'all' as const, label: `全部 ${rows.length}` },
            { value: 'included' as const, label: '要导入的' },
            { value: 'flagged' as const, label: '有标记的' },
          ]}
        />
        <div className="flex items-center gap-1" aria-label="批量勾选">
          <Button variant="ghost" className="h-8 px-2 text-[13px]" disabled={!pickable.length} onClick={() => bulk('all')}>
            全选
          </Button>
          <Button variant="ghost" className="h-8 px-2 text-[13px]" disabled={!pickable.length} onClick={() => bulk('none')}>
            全不选
          </Button>
          <Button variant="ghost" className="h-8 px-2 text-[13px]" disabled={!pickable.length} onClick={() => bulk('invert')}>
            反选
          </Button>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-ink-soft">这里没有行</p>
      ) : desktop ? (
        <table className="w-full table-fixed text-[13px]">
          <thead className="text-left text-[12px] text-ink-soft">
            <tr>
              <th className="w-10 pb-2 font-normal">导入</th>
              <th className="w-[92px] pb-2 font-normal">日期</th>
              <th className="pb-2 font-normal">对方</th>
              <th className="pb-2 font-normal">商品</th>
              <th className="w-[96px] pb-2 pr-3 text-right font-normal">金额</th>
              <th className="w-[64px] pb-2 font-normal">收支</th>
              <th className="w-[148px] pb-2 font-normal">分类</th>
              <th className="w-[104px] pb-2 pl-2 font-normal">标记</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr
                key={row.rowNo}
                aria-label={rowName(row)}
                className={'border-t border-border ' + (row.selectable ? '' : 'opacity-60')}
              >
                <td className="py-2">{check(row)}</td>
                <td className="py-2 tabular-nums text-ink-soft">{row.occurredOn}</td>
                <td className="truncate py-2 pr-2" title={row.merchant}>{row.merchant || '—'}</td>
                <td className="truncate py-2 pr-2 text-ink-soft" title={row.title}>{row.title || '—'}</td>
                <td className="py-2 pr-3 text-right"><AmountText row={row} /></td>
                <td className="py-2 text-ink-soft">{IMPORT_DIRECTION_LABELS[row.direction]}</td>
                <td className="py-2">{select(row, 'w-full')}</td>
                <td className="py-2 pl-2"><Flags flags={row.flags} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((row) => (
            <li
              key={row.rowNo}
              aria-label={rowName(row)}
              className={'rounded-card border border-border p-3 ' + (row.selectable ? '' : 'opacity-60')}
            >
              <div className="flex items-start gap-3">
                {check(row)}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <p className="min-w-0 flex-1 truncate text-[14px] font-medium">{row.merchant || row.title || '—'}</p>
                    <span className="shrink-0 text-[14px] font-semibold"><AmountText row={row} /></span>
                  </div>
                  <p className="truncate text-[12px] text-ink-soft">
                    {[row.occurredOn, row.title, IMPORT_DIRECTION_LABELS[row.direction]].filter(Boolean).join(' · ')}
                  </p>
                  {row.flags.length ? <div className="mt-1"><Flags flags={row.flags} /></div> : null}
                </div>
              </div>
              {select(row, 'mt-2 h-10 w-full')}
            </li>
          ))}
        </ul>
      )}
      {visible.length > shown.length ? (
        <Button variant="outline" className="h-9 text-[13px]" onClick={() => setLimit(limit + PAGE)}>
          再显示 {Math.min(PAGE, visible.length - shown.length)} 行（还有 {visible.length - shown.length} 行）
        </Button>
      ) : null}
    </div>
  );
}
