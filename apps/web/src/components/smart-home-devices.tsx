import { useState } from 'react';
import { smartHomeActionsFor, type SmartHomeDevice } from '@family/contracts';
import { useRemoveSmartHomeDevice, useSmartHomeDevices, useUpsertSmartHomeDevice } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { QueryFrame } from './query-state';
import { ListSkeleton } from './skeleton';
import { ToggleRow } from './media-settings-parts';
import { Button, EmptyState, Input, Panel, selectClass } from './ui';

/** 白名单里的一台：就地改中文名、分组，能控的设备还能开放控制、定谁能控；或者移出。 */
function WhitelistRow({ device }: { device: SmartHomeDevice }) {
  const upsert = useUpsertSmartHomeDevice();
  const remove = useRemoveSmartHomeDevice();
  const [name, setName] = useState(device.displayName);
  const [area, setArea] = useState(device.area ?? '');
  const [controllable, setControllable] = useState(device.controllable);
  const [minRole, setMinRole] = useState<'admin' | 'member'>(device.minRole === 'member' ? 'member' : 'admin');
  const actionable = smartHomeActionsFor(device.domain).length > 0;
  const dirty =
    name.trim() !== device.displayName ||
    (area.trim() || null) !== device.area ||
    controllable !== device.controllable ||
    minRole !== (device.minRole === 'member' ? 'member' : 'admin');
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
      {actionable ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-[2]">
            <ToggleRow
              label={`允许在小管家里控制${device.displayName}`}
              checked={controllable}
              disabled={busy}
              onChange={() => setControllable((value) => !value)}
            />
          </div>
          <select
            aria-label={`${device.displayName} 谁能控`}
            className={`${selectClass} min-h-11 min-w-0 flex-1`}
            disabled={busy || !controllable}
            value={minRole}
            onChange={(event) => setMinRole(event.target.value === 'member' ? 'member' : 'admin')}
          >
            <option value="admin">只有管理员</option>
            <option value="member">全家都能控</option>
          </select>
        </div>
      ) : null}
      <div className="flex gap-2">
        {dirty ? (
          <Button
            className="min-h-11"
            disabled={busy || !name.trim()}
            onClick={() =>
              upsert.mutate(
                {
                  entityId: device.entityId,
                  body: {
                    displayName: name.trim(),
                    area: area.trim() || null,
                    ...(actionable ? { controllable, minRole } : {}),
                  },
                },
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
