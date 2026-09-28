import { useMemo, useState } from 'react';
import type { SmartHomeDirectoryDevice, SmartHomeDirectoryEntry } from '@family/contracts';
import { useSmartHomeDirectory, useUpsertSmartHomeDevice } from '../lib/queries';
import { SMART_HOME_KINDS, arrangeDirectory, smartHomeStateLine, type SmartHomeKind } from '../lib/smart-home-copy';
import { pushToast } from '../lib/toast';
import { QueryFrame } from './query-state';
import { ListSkeleton } from './skeleton';
import { Button, EmptyState, Input, Panel } from './ui';

// HA 的实体目录：按设备一张卡（设备 / 实体 / 区域三张注册表拼出来），默认只摆主实体，
// 诊断 / 配置类折进「更多」。米家、海尔一台设备十几个子实体，平铺就没法挑了。

/** 确认加进白名单时给一下轻触感；桌面没有振动器就什么都不发生。 */
function confirmHaptic() {
  navigator.vibrate?.(10);
}

/** 目录里的一条：点「加进来」就地展开，别名默认是去掉设备名前缀的实体名，可改。 */
function DirectoryRow({ entry, area }: { entry: SmartHomeDirectoryEntry; area: string | null }) {
  const upsert = useUpsertSmartHomeDevice();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(entry.name.slice(0, 40));
  const [group, setGroup] = useState(area ?? '');
  const line = smartHomeStateLine(entry.domain, entry.state);

  return (
    <li data-smart-home-entity={entry.entityId} className="flex flex-col gap-2 border-t border-border px-3.5 py-2.5">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{entry.name}</span>
          <span className="block truncate text-[12px] text-ink-soft">
            {line.text} · {entry.entityId}
          </span>
        </span>
        {entry.whitelisted ? (
          <span className="shrink-0 text-[12px] text-accent">已加</span>
        ) : !open ? (
          <Button
            variant="outline"
            className="min-h-11 shrink-0 px-3"
            aria-label={`把${entry.fullName}加进来`}
            onClick={() => setOpen(true)}
          >
            加进来
          </Button>
        ) : null}
      </div>
      {open && !entry.whitelisted ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            upsert.mutate(
              { entityId: entry.entityId, body: { displayName: name.trim(), area: group.trim() || null } },
              {
                onSuccess: () => {
                  confirmHaptic();
                  pushToast(`「${name.trim()}」已加进智能家居`);
                  setOpen(false);
                },
              },
            );
          }}
        >
          <Input
            aria-label={`${entry.fullName} 的中文名`}
            className="min-w-0 flex-[2]"
            placeholder="中文名"
            maxLength={40}
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            aria-label={`${entry.fullName} 的分组`}
            className="min-w-0 flex-1"
            placeholder="分组，比如客厅"
            maxLength={20}
            value={group}
            onChange={(event) => setGroup(event.target.value)}
          />
          <Button type="submit" className="min-h-11" disabled={upsert.isPending || !name.trim()}>
            确认加入
          </Button>
          <Button type="button" variant="ghost" className="min-h-11" onClick={() => setOpen(false)}>
            取消
          </Button>
        </form>
      ) : null}
    </li>
  );
}

/** 一台设备一张卡：标题是设备名 + 区域，可整张收起；主实体之外的折在「更多 N 项」里。 */
function DeviceCard({
  device,
  shown,
  more,
}: {
  device: SmartHomeDirectoryDevice;
  shown: SmartHomeDirectoryEntry[];
  more: SmartHomeDirectoryEntry[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const bodyId = `smart-home-device-${device.id ?? 'none'}`;
  const added = device.entities.filter((entry) => entry.whitelisted).length;

  return (
    <section data-smart-home-directory-device={device.name} className="rounded-lg border border-border">
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        className="flex min-h-12 w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-muted"
        onClick={() => setCollapsed((value) => !value)}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{device.name}</span>
          <span className="block truncate text-[12px] text-ink-soft">
            {[device.area, device.manufacturer, `${device.entities.length} 个实体`, added ? `已加 ${added}` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        <span aria-hidden="true" className={`shrink-0 text-ink-soft transition-transform duration-150 ease-out ${collapsed ? '' : 'rotate-90'}`}>
          ›
        </span>
      </button>
      {collapsed ? null : (
        <ul id={bodyId}>
          {shown.map((entry) => (
            <DirectoryRow key={entry.entityId} entry={entry} area={device.area} />
          ))}
          {more.length ? (
            <>
              <li className="border-t border-border">
                <button
                  type="button"
                  aria-expanded={showMore}
                  className="min-h-11 w-full px-3.5 text-left text-[13px] text-accent hover:bg-muted"
                  onClick={() => setShowMore((value) => !value)}
                >
                  {showMore ? '收起' : `更多 ${more.length} 项`}
                  <span className="ml-1 text-[12px] text-ink-soft">
                    {more.every((entry) => entry.category) ? '诊断、配置之类' : '不常用的'}
                  </span>
                </button>
              </li>
              {showMore ? more.map((entry) => <DirectoryRow key={entry.entityId} entry={entry} area={device.area} />) : null}
            </>
          ) : null}
        </ul>
      )}
    </section>
  );
}

export function SmartHomeDirectoryPanel({ configured }: { configured: boolean }) {
  const directory = useSmartHomeDirectory(configured);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<SmartHomeKind | 'all'>('all');
  const groups = useMemo(
    () => arrangeDirectory(directory.data?.devices ?? [], { query: search, kind }),
    [directory.data, search, kind],
  );

  if (!configured) {
    return (
      <Panel title="从 Home Assistant 里挑">
        <EmptyState emoji="🔌" title="先连上 Home Assistant" hint="填好地址和令牌、测通之后，这里会按设备列出能挑的实体" />
      </Panel>
    );
  }

  return (
    <Panel
      title="从 Home Assistant 里挑"
      right={
        <button
          type="button"
          className="min-h-11 px-1 text-[12px] text-accent disabled:text-ink-soft"
          disabled={directory.isFetching}
          onClick={() => void directory.refetch()}
        >
          {directory.isFetching ? '正在读…' : '重新读取'}
        </button>
      }
    >
      <QueryFrame query={directory} skeleton={<div className="p-3"><ListSkeleton rows={5} /></div>}>
        {directory.data && !directory.data.connection.available ? (
          <p role="status" className="px-3.5 py-3 text-sm text-danger">
            连不上 Home Assistant：{directory.data.connection.message}
          </p>
        ) : (
          <div className="flex flex-col gap-3 p-3.5">
            <Input
              type="search"
              aria-label="搜设备或实体"
              placeholder="搜设备名、实体名或实体 ID"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div role="group" aria-label="按类型筛" className="flex flex-wrap gap-1.5">
              {[{ value: 'all' as const, label: '全部' }, ...SMART_HOME_KINDS].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={kind === option.value}
                  className={
                    'min-h-9 rounded-full border px-3 text-[13px] transition-colors duration-150 ' +
                    (kind === option.value
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-border text-ink-soft hover:text-ink')
                  }
                  onClick={() => setKind(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {directory.data?.groupingMessage ? (
              <p role="status" className="text-[12px] text-warm">
                {directory.data.groupingMessage}
              </p>
            ) : null}
            <p className="text-[12px] text-ink-soft">门锁和安防不接进小管家；要看全部设备请用 Home Assistant App。</p>
            {groups.length ? (
              groups.map((group) => (
                <DeviceCard
                  key={`${group.device.id ?? 'none'}:${search}:${kind}`}
                  device={group.device}
                  shown={group.shown}
                  more={group.more}
                />
              ))
            ) : (
              <EmptyState emoji="🔎" title={search || kind !== 'all' ? '没有符合的设备' : 'Home Assistant 上还没有能挑的设备'} />
            )}
          </div>
        )}
      </QueryFrame>
    </Panel>
  );
}
