import { useState } from 'react';
import {
  monthLabel,
  monthNow,
  shiftMonth,
  useFinanceAccounts,
  useFinanceCategories,
  useFinanceSummary,
  yuan,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { AccountsPanel } from '../components/finance-accounts';
import { BudgetBar, BudgetsPanel } from '../components/finance-budgets';
import { CategoriesPanel } from '../components/finance-categories';
import { LedgerPanel } from '../components/finance-ledger';
import { TransactionForm } from '../components/finance-transaction-form';
import { ListSkeleton } from '../components/skeleton';
import { Button, EmptyState, Page, Panel, Segmented } from '../components/ui';

type View = 'overview' | 'ledger' | 'budgets' | 'accounts';

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

  const [month, setMonth] = useState(monthNow());
  const [view, setView] = useState<View>('overview');
  const [recording, setRecording] = useState(false);

  const summary = useFinanceSummary(month);
  const accounts = useFinanceAccounts();
  const categories = useFinanceCategories();

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
              disabled={month >= monthNow()}
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
              { value: 'budgets' as const, label: '预算' },
              { value: 'accounts' as const, label: '账户' },
            ]}
          />
        </div>
      }
    >
      {view === 'ledger' ? (
        <LedgerPanel month={month} canManage={canManage} />
      ) : view === 'budgets' ? (
        <BudgetsPanel
          month={month}
          categories={categories.data ?? []}
          budgets={summary.data?.budgets ?? []}
          canManage={canManage}
        />
      ) : view === 'accounts' ? (
        <>
          <AccountsPanel accounts={rows} canManage={canManage} />
          <aside className="flex shrink-0 flex-col lg:w-[320px]">
            <CategoriesPanel categories={categories.data ?? []} canManage={canManage} />
          </aside>
        </>
      ) : (
        <Panel className="p-3">
          {summary.isPending || accounts.isPending ? (
            <ListSkeleton rows={4} />
          ) : summary.isError ? (
            <EmptyState emoji="🧾" title="账目读不出来" hint="刷新一下，还不行就看看 API 服务" />
          ) : rows.length === 0 ? (
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
                      <p className="min-w-0 flex-1 truncate text-[14px]">{one.name}</p>
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
                        {yuan(one.balance)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

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
        </Panel>
      )}

      {recording ? (
        <TransactionForm
          month={month}
          accounts={rows}
          categories={categories.data ?? []}
          onClose={() => setRecording(false)}
        />
      ) : null}
    </Page>
  );
}
