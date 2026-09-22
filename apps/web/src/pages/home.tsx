import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { shelfSegments } from '../lib/nav';
import { usePins, PIN_LIMIT } from '../lib/pins';
import { useModules, useSetModuleOverride } from '../lib/queries/modules';
import { useAttention } from '../lib/queries';
import { attentionCopy } from '../lib/attention-copy';
import { pushToast } from '../lib/toast';
import { openPalette } from '../components/command-palette';
import { HomeTile } from '../components/home-tile';
import { HomeAvailable } from '../components/home-available';
import { SoftLink } from '../components/soft-link';
import { Button, Page, Panel } from '../components/ui';

const gridClass = 'grid grid-cols-3 gap-2 p-3 lg:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] lg:gap-3 lg:p-4';

export default function HomePage() {
  const { session } = useAuth();
  const member = session?.member;
  const manager = member?.role === 'owner' || member?.role === 'admin';
  const modules = useModules();
  const attention = useAttention();
  const update = useSetModuleOverride();
  const { pins } = usePins();
  const [editing, setEditing] = useState(false);
  const segments = shelfSegments(member);
  const active = segments.filter((segment) => modules.visible(segment.key));
  const available = segments.filter((segment) => !modules.visible(segment.key));
  const pinned = pins.flatMap((key) => active.filter((segment) => segment.key === key));
  const tile = (segment: typeof segments[number]) => {
    const item = attention.data?.items.find((entry) => entry.domain === segment.key);
    return <HomeTile key={segment.key} segment={segment} status={item ? attentionCopy(item, attention.data?.today).title : undefined} editing={editing} busy={update.isPending}
      onHide={manager ? () => {
        const previous = modules.state(segment.key)?.override ?? null;
        update.mutate({ key: segment.key, override: 'off' }, { onSuccess: () => {
          pushToast(`已收起${segment.label}`, undefined, { label: '撤销', run: () => {
            update.mutate({ key: segment.key, override: previous });
          } });
        } });
      } : undefined} />
  };
  return (
    <Page title="家里" subtitle="家里的功能，都在这里"
      actions={<Button variant="ghost" className="min-h-11" aria-pressed={editing} onClick={() => setEditing(!editing)}>{editing ? '完成置顶' : '编辑置顶'}</Button>}
      toolbar={<button type="button" onClick={openPalette}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left text-sm text-ink-soft transition-colors duration-150 hover:bg-muted active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <span>搜索功能</span><span aria-hidden="true" className="text-xs">⌘K</span>
      </button>}>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {editing ? <p id="pin-limit-hint" role="status" className="text-sm text-ink-soft">{pins.length >= PIN_LIMIT ? '已钉住 4 个，先取消一个置顶，才能钉住其他功能。' : `最多钉住 4 个 · 已选 ${pins.length} 个 · 只有你看得到`}</p> : null}
        {modules.initialLoading ? (
          <Panel title="家里在用的"><div role="status" aria-label="正在加载家里的功能" className={gridClass}>
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-28 rounded-xl bg-muted" aria-hidden="true" />)}
          </div></Panel>
        ) : <>
          {pinned.length ? <div className="lg:hidden"><Panel title="我钉住的 · 只有你看得到" grow={false}><div data-home-pins className={gridClass}>{pinned.map(tile)}</div></Panel></div> : null}
          <Panel title="家里在用的" grow={false}>
            <div data-home-grid className={gridClass}>{active.map(tile)}</div>
            {!active.length ? <p className="px-4 pb-4 text-sm text-ink-soft">从下面挑一个，家里的功能会随着使用慢慢长出来。</p> : null}
          </Panel>
          {available.length ? <Panel title="还可以开启" grow={false}><div className="divide-y divide-border">
            {available.map((segment) => <HomeAvailable key={segment.key} segment={segment} hidden={modules.explicitlyHidden(segment.key)} manager={manager} busy={update.isPending}
              onEnable={() => update.mutate({ key: segment.key, override: modules.explicitlyHidden(segment.key) ? null : 'on' })} />)}
          </div></Panel> : null}
        </>}
        <SoftLink to={manager ? '/settings' : '/me/profile'}
          className="flex min-h-11 items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 text-sm text-ink-soft hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
          <span>{manager ? '家庭设置' : '个人'}</span><span aria-hidden="true">›</span>
        </SoftLink>
      </div>
    </Page>
  );
}
