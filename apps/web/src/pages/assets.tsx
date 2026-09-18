import { useState } from 'react';
import type { AssetCategory, HomeAsset } from '@family/contracts';
import {
  ASSET_CATEGORY_LABELS,
  assetDateLabel,
  daysUntil,
  todayISO,
  shiftDays,
  useAssets,
} from '../lib/queries';
import { AssetForm } from '../components/asset-form';
import { SoftLink } from '../components/soft-link';
import { ListSkeleton } from '../components/skeleton';
import { Button, EmptyState, Page, Panel, Segmented } from '../components/ui';

type Filter = 'active' | 'all';
type CategoryFilter = AssetCategory | 'all';

const NO_ASSETS: HomeAsset[] = [];
const CATEGORY_EMOJI: Record<AssetCategory, string> = {
  appliance: '🔌',
  furniture: '🛋️',
  electronics: '💻',
  tool: '🔧',
  subscription: '🔁',
  other: '📦',
};

/** 到期短语：逾期最响，其次今天，再往后按天数说。 */
export function dueLabel(date: string) {
  const days = daysUntil(date);
  if (days < 0) return { text: `逾期 ${-days} 天`, urgent: true };
  if (days === 0) return { text: '今天到期', urgent: true };
  if (days <= 30) return { text: `${days} 天后`, urgent: false };
  return { text: assetDateLabel(date), urgent: false };
}

/** 启用中的计划里最早到期的那个——卡片上只说这一条。 */
export function nextPlan(asset: HomeAsset) {
  return asset.maintenancePlans
    .filter((plan) => plan.isEnabled)
    .reduce<HomeAsset['maintenancePlans'][number] | null>(
      (earliest, plan) =>
        !earliest || plan.nextDueDate < earliest.nextDueDate ? plan : earliest,
      null,
    );
}

function AssetCard({ asset }: { asset: HomeAsset }) {
  const plan = nextPlan(asset);
  const status =
    asset.category === 'subscription'
      ? asset.renewsOn
        ? { text: `下次续费 · ${dueLabel(asset.renewsOn).text}`, urgent: daysUntil(asset.renewsOn) <= 14 }
        : { text: '还没设续费日期', urgent: false }
      : plan
        ? { text: `${plan.title} · ${dueLabel(plan.nextDueDate).text}`, urgent: dueLabel(plan.nextDueDate).urgent }
        : { text: '暂无维护计划', urgent: false };

  return (
    <SoftLink
      to={`/house/assets/${asset.id}`}
      className="flex flex-col rounded-card border border-border px-3.5 py-3 transition-colors duration-150 hover:bg-muted"
    >
      <div className="flex items-start gap-3">
        <span
          className={
            'grid size-10 shrink-0 place-items-center rounded-lg text-lg ' +
            (asset.status === 'active' ? 'bg-accent-soft' : 'bg-muted opacity-70')
          }
        >
          {CATEGORY_EMOJI[asset.category]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold">{asset.name}</span>
            {asset.status === 'retired' ? (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-ink-soft">
                已停用
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-[12px] text-ink-soft">
            {[ASSET_CATEGORY_LABELS[asset.category], asset.location, asset.brand]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border pt-2">
        <span className={'truncate text-[12px] ' + (status.urgent ? 'text-warm' : 'text-ink-soft')}>
          {status.text}
        </span>
        <span className="shrink-0 text-[12px] text-ink-soft">{asset.documents.length} 份资料</span>
      </div>
    </SoftLink>
  );
}

export function AssetsPage() {
  const assets = useAssets('all');
  const [filter, setFilter] = useState<Filter>('active');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [creating, setCreating] = useState(false);

  const rows = assets.data ?? NO_ASSETS;
  const active = rows.filter((asset) => asset.status === 'active');
  const visible = rows.filter(
    (asset) =>
      (filter === 'all' || asset.status === 'active') &&
      (category === 'all' || asset.category === category),
  );

  // 临近事项：30 天内（含逾期）的维护，和 14 天内要续的订阅——后者逾期也要看见，
  // 旧页面把逾期的续费算漏了，续晚了反而不提醒说不过去。
  const horizon = shiftDays(todayISO(), 30);
  const duePlans = active.flatMap((asset) =>
    asset.maintenancePlans
      .filter((plan) => plan.isEnabled && plan.nextDueDate <= horizon)
      .map((plan) => ({ asset, title: plan.title, date: plan.nextDueDate })),
  );
  const dueRenewals = active
    .filter((asset) => asset.category === 'subscription' && asset.renewsOn)
    .filter((asset) => daysUntil(asset.renewsOn!) <= 14)
    .map((asset) => ({ asset, title: '续费', date: asset.renewsOn! }));
  const upcoming = [...duePlans, ...dueRenewals].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <Page
      title="家庭资产"
      subtitle="家电、家具、设备和维护资料"
      actions={
        <Button className="h-9 px-3 text-[13px]" onClick={() => setCreating(true)}>
          + 登记资产
        </Button>
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'active' as const, label: `使用中 ${active.length}` },
              { value: 'all' as const, label: '全部' },
            ]}
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="按分类筛选">
            {(['all', ...Object.keys(ASSET_CATEGORY_LABELS)] as CategoryFilter[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={category === value}
                className={
                  'rounded-full border px-2.5 py-1 text-[13px] transition-colors duration-150 ' +
                  (category === value
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border text-ink-soft hover:bg-muted')
                }
                onClick={() => setCategory(value)}
              >
                {value === 'all' ? '全部分类' : ASSET_CATEGORY_LABELS[value]}
              </button>
            ))}
          </div>
        </div>
      }
    >
      <Panel className="p-3">
        {assets.isPending ? (
          <ListSkeleton rows={4} />
        ) : assets.isError ? (
          <EmptyState emoji="📦" title="资产读不出来" hint="刷新一下，还不行就看看 API 服务" />
        ) : visible.length === 0 ? (
          <EmptyState
            emoji="🏠"
            title={rows.length ? '这个筛选下没有资产' : '还没登记家庭资产'}
            hint="从常用家电、订阅，或者需要定期保养的设备开始"
          />
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((asset) => (
              <AssetCard key={asset.id} asset={asset} />
            ))}
          </div>
        )}
      </Panel>

      <aside className="flex shrink-0 flex-col lg:w-[300px]">
        <Panel title={`临近事项 ${upcoming.length}`} grow={false}>
          {upcoming.length === 0 ? (
            <p className="px-3.5 py-6 text-center text-[13px] text-ink-soft">
              30 天内没有要保养的，订阅也都还早。
            </p>
          ) : (
            upcoming.map((one, index) => {
              const due = dueLabel(one.date);
              return (
                <SoftLink
                  key={`${one.asset.id}-${one.title}-${one.date}`}
                  to={`/house/assets/${one.asset.id}`}
                  className={
                    'flex items-center gap-2 px-3.5 py-2.5 hover:bg-muted ' +
                    (index ? 'border-t border-border' : '')
                  }
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{one.asset.name}</p>
                    <p className="truncate text-[12px] text-ink-soft">{one.title}</p>
                  </div>
                  <span
                    className={'shrink-0 text-[12px] ' + (due.urgent ? 'text-danger' : 'text-warm')}
                  >
                    {due.text}
                  </span>
                </SoftLink>
              );
            })
          )}
        </Panel>
      </aside>

      {creating ? <AssetForm editing={null} onClose={() => setCreating(false)} /> : null}
    </Page>
  );
}
