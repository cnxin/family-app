import { useMemo, useState } from 'react';
import type { SmartHomeDevice, SmartHomeDirectoryEntry } from '@family/contracts';
import {
  useRemoveSmartHomeDevice,
  useSmartHomeDevices,
  useSmartHomeDirectory,
  useUpsertSmartHomeDevice,
} from '../lib/queries';
import { smartHomeStateLine } from '../lib/smart-home-copy';
import { pushToast } from '../lib/toast';
import { QueryFrame } from './query-state';
import { ListSkeleton } from './skeleton';
import { Button, EmptyState, Input, Panel } from './ui';

/** 确认加进白名单时给一下轻触感；桌面没有振动器就什么都不发生。 */
function confirmHaptic() {
  navigator.vibrate?.(10);
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/** 白名单里的一台：就地改中文名和分组，或者移出。 */
function WhitelistRow({ device }: { device: SmartHomeDevice }) {
  const upsert = useUpsertSmartHomeDevice();
  const remove = useRemoveSmartHomeDevice();
  const [name, setName] = useState(device.displayName);
  const [area, setArea] = useState(device.area ?? '');
  const dirty = name.trim() !== device.displayName || (area.trim() || null) !== device.area;
  const busy = upsert.isPending || remove.isPending;

  return (
    <li data-smart-home-whitelisted={device.entityId} className="flex flex-col gap-2 border-b border-border px-3.5 py-3 last:border-b-0">
      <p className="truncate text-[12px] text-ink-soft">{device.entityId}</p>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label={`${device.displayName} 的中文名`}
          className="min-w-0 flex-[2]"
          maxLength={40}
          disabled={busy}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Input
          aria-label={`${device.displayName} 的分组`}
          className="min-w-0 flex-1"
          placeholder="分组，比如客厅"
          maxLength={20}
          disabled={busy}
          value={area}
          onChange={(event) => setArea(event.target.value)}
        />
      </div>
      <div className="flex gap-2">
        {dirty ? (
          <Button
            className="min-h-11"
            disabled={busy || !name.trim()}
            onClick={() =>
              upsert.mutate(
                { entityId: device.entityId, body: { displayName: name.trim(), area: area.trim() || null } },
                { onSuccess: () => pushToast(`已保存「${name.trim()}」`) },
              )
            }
          >
            保存
          </Button>
        ) : null}
        <Button
          variant="ghost"
          className="min-h-11"
          aria-label={`把${device.displayName}移出智能家居`}
          disabled={busy}
          onClick={() =>
            remove.mutate(device.entityId, { onSuccess: () => pushToast(`「${device.displayName}」已移出`) })
          }
        >
          移出
        </Button>
      </div>
    </li>
  );
}

/** 目录里的一条：点「加进来」就地展开，起中文名、填分组再确认。 */
function DirectoryRow({ entry }: { entry: SmartHomeDirectoryEntry }) {
  const upsert = useUpsertSmartHomeDevice();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(entry.name.slice(0, 40));
  const [area, setArea] = useState('');
  const line = smartHomeStateLine(entry.domain, entry.state);

  return (
    <li data-smart-home-entity={entry.entityId} className="flex flex-col gap-2 border-b border-border px-3.5 py-2.5 last:border-b-0">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{entry.name}</span>
          <span className="block truncate text-[12px] text-ink-soft">
            {entry.entityId} · {line.text}
          </span>
        </span>
        {entry.whitelisted ? (
          <span className="shrink-0 text-[12px] text-accent">已加入</span>
        ) : !open ? (
          <Button
            variant="outline"
            className="min-h-11 shrink-0 px-3"
            aria-label={`把${entry.name}加进来`}
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
              { entityId: entry.entityId, body: { displayName: name.trim(), area: area.trim() || null } },
              {
                onSuccess: () => {
                  confirmHaptic();
                  pushToast(`「${name.trim()}」已加进智能家居`);
                  setOpen(false);
                },
                onError: (error) => pushToast(errorText(error, '没加成')),
              },
            );
          }}
        >
          <Input
            aria-label={`${entry.name} 的中文名`}
            className="min-w-0 flex-[2]"
            placeholder="中文名，比如客厅窗帘"
            maxLength={40}
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            aria-label={`${entry.name} 的分组`}
            className="min-w-0 flex-1"
            placeholder="分组，比如客厅"
            maxLength={20}
            value={area}
            onChange={(event) => setArea(event.target.value)}
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

export function SmartHomeWhitelistPanel() {
  const devices = useSmartHomeDevices();
  return (
    <Panel title={`家里人能看到的设备${devices.data ? ` ${devices.data.length}` : ''}`} grow={false}>
      <QueryFrame query={devices} skeleton={<div className="p-3"><ListSkeleton rows={2} /></div>}>
        {devices.data?.length ? (
          <ul>
            {devices.data.map((device) => (
              <WhitelistRow key={`${device.entityId}:${device.updatedAt}`} device={device} />
            ))}
          </ul>
        ) : (
          <EmptyState emoji="🧺" title="还没挑设备" hint="从右边 Home Assistant 的实体里挑几样常用的" />
        )}
      </QueryFrame>
    </Panel>
  );
}

export function SmartHomeDirectoryPanel({ configured }: { configured: boolean }) {
  const directory = useSmartHomeDirectory(configured);
  const [search, setSearch] = useState('');
  const entities = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const all = directory.data?.entities ?? [];
    return keyword
      ? all.filter((entry) => entry.name.toLowerCase().includes(keyword) || entry.entityId.includes(keyword))
      : all;
  }, [directory.data, search]);

  if (!configured) {
    return (
      <Panel title="从 Home Assistant 里挑">
        <EmptyState emoji="🔌" title="先连上 Home Assistant" hint="填好地址和令牌、测通之后，这里会列出能挑的设备" />
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
          <>
            <div className="border-b border-border px-3.5 py-2.5">
              <Input
                aria-label="搜实体"
                placeholder="搜名字或实体 ID"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <p className="mt-1.5 text-[12px] text-ink-soft">门锁和安防不接进小管家；要看全部设备请用 Home Assistant App。</p>
            </div>
            {entities.length ? (
              <ul>
                {entities.map((entry) => (
                  <DirectoryRow key={entry.entityId} entry={entry} />
                ))}
              </ul>
            ) : (
              <EmptyState emoji="🔎" title={search ? '没搜到' : 'Home Assistant 上还没有能挑的设备'} />
            )}
          </>
        )}
      </QueryFrame>
    </Panel>
  );
}
