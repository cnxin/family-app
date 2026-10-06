import { useHouseholdToday } from '../lib/use-household-today';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCreateIntent } from '../lib/create-intent';
import {
  accountBalanceText,
  creditDetail,
  monthLabel,
  shiftMonth,
  useFinanceAccounts,
  useFinanceCategories,
  useFinanceRecurring,
  useFinanceSummary,
  yuan,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { AccountsPanel } from '../components/finance-accounts';
import { BudgetBar, BudgetsPanel } from '../components/finance-budgets';
import { CategoriesPanel } from '../components/finance-categories';
import { LedgerPanel } from '../components/finance-ledger';
import { RecurringPanel } from '../components/finance-recurring';
import { TransactionForm } from '../components/finance-transaction-form';
import { QueryFrame } from '../components/query-state';
import { ListSkeleton } from '../components/skeleton';
import { Button, EmptyState, Page, Panel, Segmented } from '../components/ui';

type View = 'overview' | 'ledger' | 'recurring' | 'budgets' | 'accounts';
const VIEWS: readonly View[] = ['overview', 'ledger', 'recurring', 'budgets', 'accounts'];

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-card border border-border px-3.5 py-3">
      <p className="text-[12px] text-ink-soft">{label}</p>
      <p className={'mt-1 text-xl font-semibold tabular-nums ' + (tone ?? '')}>{value}</p>
    </div>
  );
}

export function FinancePage() {
  const { session } = useAuth();
  const canManage = session?.member.role !== 'member';

  const today = useHouseholdToday();
  const currentMonth = today.slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  // 留意里「去看看」带 ?view=recurring 进来；预算、账户成员看不到，带了也回概览
  const [params] = useSearchParams();
  const [view, setView] = useState<View>(() => {
    const wanted = params.get('view') as View | null;
    if (!wanted || !VIEWS.includes(wanted)) return 'overview';
    return !canManage && (wanted === 'budgets' || wanted === 'accounts') ? 'overview' : wanted;
  });
  const [recording, setRecording] = useState(false);
  const [initialMode, setInitialMode] = useState<'expense' | 'income' | 'transfer'>('expense');
  // 留意里信用卡「去还款」带 kind=transfer：还款就是转账
  useCreateIntent((kind) => {
    setInitialMode(kind === 'income' ? 'income' : kind === 'transfer' ? 'transfer' : 'expense');
    setRecording(true);
  });

  const summary = useFinanceSummary(month);
  const accounts = useFinanceAccounts();
  const categories = useFinanceCategories();
  const recurring = useFinanceRecurring();
  const fixed = summary.data?.fixedCosts;

  const rows = accounts.data ?? [];
  const usable = rows.filter((one) => one.isActive);
  const net = summary.data?.net ?? 0;

  return (
    <Page
      title="家庭财务"
      subtitle="家里共用的账本、账户余额和月度预算"
      actions={
        <Button
          className="h-9 px-3 text-[13px]"
          disabled={usable.length === 0}
          onClick={() => setRecording(true)}
        >
          + 记一笔
        </Button>
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-border px-1 py-0.5">
            <Button
              variant="ghost"
              className="h-8 px-2 text-[13px]"
              aria-label="上个月"
              onClick={() => setMonth(shiftMonth(month, -1))}
            >
              ‹
            </Button>
            <span className="min-w-[92px] text-center text-[13px] font-medium">
              {monthLabel(month)}
            </span>
            <Button
              variant="ghost"
              className="h-8 px-2 text-[13px]"
              aria-label="下个月"
              disabled={month >= currentMonth}
              onClick={() => setMonth(shiftMonth(month, 1))}
            >
              ›
            </Button>
          </div>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'overview' as const, label: '概览' },
              { value: 'ledger' as const, label: '流水' },
              // 固定支出成员也能看（只读 + 到期点「已付」）
              { value: 'recurring' as const, label: '固定支出' },
              // 预算、账户与分类只有管理员能管，成员不出这两个分段
              ...(canManage
                ? [
                    { value: 'budgets' as const, label: '预算' },
                    { value: 'accounts' as const, label: '账户' },
                  ]
                : []),
            ]}
          />
        </div>
      }
    >
      {view === 'ledger' ? (
        <LedgerPanel month={month} canManage={canManage} />
      ) : view === 'recurring' ? (
        <QueryFrame queries={[recurring, accounts, categories]} skeleton={<ListSkeleton rows={4} />}>
          <RecurringPanel
            rows={recurring.data ?? []}
            accounts={rows}
            categories={categories.data ?? []}
            canManage={canManage}
          />
        </QueryFrame>
      ) : view === 'budgets' ? (
        <QueryFrame queries={[summary, categories]} skeleton={<ListSkeleton rows={4} />}>
          <BudgetsPanel
            month={month}
            categories={categories.data ?? []}
            budgets={summary.data?.budgets ?? []}
            canManage={canManage}
          />
        </QueryFrame>
      ) : view === 'accounts' ? (
        <QueryFrame queries={[accounts, categories]} skeleton={<ListSkeleton rows={4} />}>
          <>
            <AccountsPanel accounts={rows} canManage={canManage} />
            <aside className="flex shrink-0 flex-col lg:w-[320px]">
              <CategoriesPanel categories={categories.data ?? []} canManage={canManage} />
            </aside>
          </>
        </QueryFrame>
      ) : (
        <Panel className="p-3">
          <QueryFrame queries={[summary, accounts]} skeleton={<ListSkeleton rows={4} />}>
            {rows.length === 0 ? (
            <EmptyState
              emoji="💳"
              title="还没有财务账户"
              hint={
                canManage
                  ? '先去「账户」建一个现金或银行卡账户，再开始记收支'
                  : '让家庭管理员先建一个账户'
              }
            />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                <Tile label="家里总余额" value={yuan(summary.data?.totalBalance ?? 0)} />
                <Tile
                  label="本月收入"
                  value={yuan(summary.data?.income ?? 0)}
                  tone="text-accent"
                />
                <Tile label="本月支出" value={yuan(summary.data?.expense ?? 0)} tone="text-danger" />
                <Tile
                  label="本月结余"
                  value={yuan(net, true)}
                  tone={net < 0 ? 'text-danger' : 'text-accent'}
                />
              </div>

              <div>
                <h2 className="mb-2 px-1 text-[13px] font-semibold text-ink-soft">
                  账户余额 · {usable.length} 个在用，总余额按全部账户算
                </h2>
                {/* 停用的账户也列出来：总余额是按全部账户算的，只显示在用的会对不上账 */}
                <div className="overflow-hidden rounded-card border border-border">
                  {usable.length === 0 ? (
                    <p className="px-3.5 py-6 text-center text-[13px] text-ink-soft">
                      账户都停用了。去「账户」里启用一个，才能继续记账。
                    </p>
                  ) : null}
                  {rows.map((one, index) => (
                    <div
                      key={one.id}
                      className={
                        'flex items-center gap-2 px-3.5 py-2.5 ' +
                        (index || usable.length === 0 ? 'border-t border-border' : '')
                      }
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px]">{one.name}</p>
                        {creditDetail(one) ? (
                          <p className="truncate text-[12px] text-ink-soft">{creditDetail(one)}</p>
                        ) : null}
                      </div>
                      {one.isActive ? null : (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-ink-soft">
                          已停用
                        </span>
                      )}
                      <span
                        className={
                          'shrink-0 text-[14px] font-semibold tabular-nums ' +
                          (one.balance < 0 ? 'text-danger' : one.isActive ? '' : 'text-ink-soft')
                        }
                      >
                        {accountBalanceText(one)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {fixed && fixed.total > 0 ? (
                <div>
                  <h2 className="mb-2 px-1 text-[13px] font-semibold text-ink-soft">固定支出</h2>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-border px-3.5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px]">
                        每月约 <span className="font-semibold tabular-nums">{yuan(fixed.total)}</span>
                      </p>
                      <p className="mt-0.5 text-[12px] text-ink-soft">
                        周期账单 {yuan(fixed.recurring)} · 资产续费 {yuan(fixed.assets)}（订阅类资产按续费周期折算）
                      </p>
                    </div>
                    <Button variant="ghost" className="h-8 px-2 text-[13px]" onClick={() => setView('recurring')}>
                      看固定支出
                    </Button>
                  </div>
                </div>
              ) : null}

              {summary.data?.budgets.length ? (
                <div>
                  <h2 className="mb-2 px-1 text-[13px] font-semibold text-ink-soft">本月预算</h2>
                  <div className="overflow-hidden rounded-card border border-border">
                    {summary.data.budgets.map((budget, index) => (
                      <div
                        key={budget.id}
                        className={'px-3.5 py-2.5 ' + (index ? 'border-t border-border' : '')}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: budget.category.color }}
                          />
                          <span className="min-w-0 flex-1 truncate text-[13px]">
                            {budget.category.name}
                          </span>
                          <span
                            className={
                              'shrink-0 text-[12px] tabular-nums ' +
                              (budget.ratio > 100 ? 'text-danger' : 'text-ink-soft')
                            }
                          >
                            {yuan(budget.spent)} / {yuan(budget.amount)}
                          </span>
                        </div>
                        <BudgetBar ratio={budget.ratio} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
          </QueryFrame>
        </Panel>
      )}

      {recording ? (
        <TransactionForm
          month={month}
          accounts={rows}
          categories={categories.data ?? []}
          initialMode={initialMode}
          onClose={() => setRecording(false)}
        />
      ) : null}
    </Page>
  );
}
