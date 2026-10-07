import { useState } from 'react';
import type { FinanceAccount, FinanceCategory, FinanceCategoryKind } from '@family/contracts';
import { rememberCategory } from '../lib/finance-recent';
import { useBatchFinanceTransactions } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { CategoryGrid } from './finance-category-grid';
import { Button, Dialog } from './ui';

export type BatchAction = 'category' | 'account' | 'delete';

const chip = (active: boolean) =>
  'rounded-full border px-2.5 py-1 text-[13px] transition-colors duration-150 ' +
  (active ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-soft hover:bg-muted');

/**
 * 选择模式的工具条：已选 N · 改分类 · 改账户 · 删除 · 取消。流水是整页滚动的，贴在面板里会滚走；
 * 底部又有标签栏和提示条（每次操作后要停留几秒），所以浮在屏幕上方：手机上在顶栏下面，电脑上在内容区居中（侧栏 224px）。
 */
export function BatchBar({ count, onAction, onCancel }: { count: number; onAction: (action: BatchAction) => void; onCancel: () => void }) {
  return (
    <div
      role="toolbar"
      aria-label="批量操作"
      className={
        'fixed inset-x-3 top-[calc(60px+env(safe-area-inset-top))] z-30 flex flex-wrap items-center gap-1 rounded-card ' +
        'border border-border bg-surface px-3 py-2 shadow-lg ' +
        'lg:left-[calc(50%+112px)] lg:right-auto lg:top-4 lg:w-[560px] lg:-translate-x-1/2'
      }
    >
      <span className="mr-auto text-[13px] font-medium tabular-nums">已选 {count}</span>
      <Button variant="ghost" className="h-8 px-2 text-[13px]" disabled={!count} onClick={() => onAction('category')}>
        改分类
      </Button>
      <Button variant="ghost" className="h-8 px-2 text-[13px]" disabled={!count} onClick={() => onAction('account')}>
        改账户
      </Button>
      <Button variant="ghost" className="h-8 px-2 text-[13px] text-danger" disabled={!count} onClick={() => onAction('delete')}>
        删除
      </Button>
      <Button variant="ghost" className="h-8 px-2 text-[13px]" onClick={onCancel}>
        取消
      </Button>
    </div>
  );
}

/**
 * 批量改分类 / 改账户 / 删除的对话框：逐条按权限、跳过的说数量（「已改 N 笔，跳过 M 笔」）。
 * 改分类时默认翻到选中的笔里多数是支出还是收入那一页；收支对不上的会被跳过。
 */
export function BatchDialog({
  action,
  ids,
  kind,
  accounts,
  categories,
  recent,
  onClose,
  onDone,
}: {
  action: BatchAction;
  ids: string[];
  kind: FinanceCategoryKind;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  recent: readonly string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const batch = useBatchFinanceTransactions();
  const [pageKind, setPageKind] = useState<FinanceCategoryKind>(kind);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const picked = categories.find((one) => one.id === categoryId);
  const target = accounts.find((one) => one.id === accountId);
  const ready = action === 'delete' || (action === 'category' ? Boolean(picked) : Boolean(target));

  function run() {
    navigator.vibrate?.(10);
    batch.mutate(
      {
        ids,
        action,
        ...(action === 'category' && categoryId ? { categoryId } : {}),
        ...(action === 'account' && accountId ? { accountId } : {}),
      },
      {
        onSuccess: (result) => {
          if (action === 'category' && categoryId) rememberCategory(categoryId);
          const verb = action === 'delete' ? '已删' : '已改';
          pushToast(`${verb} ${result.done} 笔，跳过 ${result.skipped.length} 笔`);
          onDone();
        },
        onError: (error) => pushToast(error instanceof Error ? error.message : '没改成'),
      },
    );
  }

  const title = action === 'category' ? `把 ${ids.length} 笔改成哪个分类？` : action === 'account' ? `把 ${ids.length} 笔挪到哪个账户？` : `删除 ${ids.length} 笔？`;
  return (
    <Dialog
      title={title}
      maxWidth={560}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            取消
          </Button>
          <Button className={'flex-1 ' + (action === 'delete' ? 'bg-danger' : '')} disabled={!ready || batch.isPending} onClick={run}>
            {batch.isPending
              ? '处理中…'
              : action === 'category'
                ? picked ? `改成「${picked.name}」` : '先选一个分类'
                : action === 'account'
                  ? target ? `挪到「${target.name}」` : '先选一个账户'
                  : '确认删除'}
          </Button>
        </div>
      }
    >
      {action === 'category' ? (
        <CategoryGrid
          categories={categories}
          kind={pageKind}
          onKindChange={(next) => {
            setPageKind(next);
            setCategoryId(null);
          }}
          value={categoryId}
          recent={recent}
          onChange={(category) => setCategoryId(category.id)}
        />
      ) : action === 'account' ? (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-ink-soft">改账户会重记这几笔（原记录保留在历史里）；转账改的是转出账户。</p>
          <div className="flex flex-wrap gap-1.5">
            {accounts
              .filter((one) => one.isActive)
              .map((one) => (
                <button key={one.id} type="button" aria-pressed={accountId === one.id} className={chip(accountId === one.id)} onClick={() => setAccountId(one.id)}>
                  {one.name}
                </button>
              ))}
          </div>
        </div>
      ) : (
        <p className="text-[13px] text-ink-soft">
          这几笔会从流水里拿掉，账户余额回到记它们之前；在筛选里打开「显示已删除」还能看到。不是你记的会被跳过。
        </p>
      )}
    </Dialog>
  );
}
