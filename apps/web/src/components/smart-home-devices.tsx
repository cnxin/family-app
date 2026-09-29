import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  SMART_HOME_FEATURED_LIMIT,
  SMART_HOME_ICONS,
  SMART_HOME_TODAY_LIMIT,
  smartHomeActionsFor,
  type SmartHomeDevice,
  type SmartHomeIcon as IconKind,
  type UpdateSmartHomeDeviceBody,
} from '@family/contracts';
import {
  useRemoveSmartHomeDevice,
  useSmartHomeDevices,
  useSmartHomeMergeReport,
  useSmartHomePanel,
  useUpdateSmartHomeDevice,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { QueryFrame } from './query-state';
import { ListSkeleton } from './skeleton';
import { SmartHomeIcon } from './smart-home-icon';
import { ToggleRow } from './media-settings-parts';
import { Button, EmptyState, Input, Panel, selectClass } from './ui';

// 设置页的白名单（smart-home-redesign §2.6）：一台设备一行。名字、房间、允许控制、谁能控常显；
// 「展开」里改图标、主实体、主面板项（至多 6 个）、藏掉的子实体、在今天页显示。
// 从详情「去设置」过来带 ?device=<id>：那一行自动展开、滚到眼前。

const ICON_LABELS: Record<IconKind, string> = {
  vacuum: '扫地机', curtain: '窗帘', air_conditioner: '空调', washer: '洗衣机', dryer: '烘干机',
  water_purifier: '净水器', fridge: '冰箱', switch: '开关', light: '灯', fan: '风扇', sensor: '传感器',
  scene: '场景', other: '其他',
};

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((one, index) => one === b[index]);

interface Draft {
  name: string;
  area: string;
  controllable: boolean;
  minRole: 'admin' | 'member';
  icon: IconKind;
  primaryEntityId: string;
  featuredEntityIds: string[];
  hiddenEntityIds: string[];
  pinnedToToday: boolean;
}

function draftOf(device: SmartHomeDevice): Draft {
  return {
    name: device.displayName,
    area: device.area ?? '',
    controllable: device.controllable,
    minRole: device.minRole === 'member' ? 'member' : 'admin',
    icon: device.icon,
    primaryEntityId: device.primaryEntityId,
    featuredEntityIds: device.featuredEntityIds,
    hiddenEntityIds: device.hiddenEntityIds,
    pinnedToToday: device.pinnedToToday,
  };
}

/** 展开区：主实体 / 主面板项 / 藏掉的子实体要读这台设备的子实体目录（详情面板接口给管理员的 catalog）。 */
function DeviceEditor({
  device,
  draft,
  onChange,
  disabled,
  pinnedOthers,
}: {
  device: SmartHomeDevice;
  draft: Draft;
  onChange: (next: Partial<Draft>) => void;
  disabled: boolean;
  pinnedOthers: number;
}) {
  const panel = useSmartHomePanel(device.id);
  const catalog = panel.data?.catalog ?? [];
  const choices = catalog.filter((entity) => entity.entityId !== draft.primaryEntityId);
  const toggle = (list: string[], entityId: string) =>
    list.includes(entityId) ? list.filter((one) => one !== entityId) : [...list, entityId];

  return (
    <div data-smart-home-editor className="flex flex-col gap-3 rounded-xl bg-muted/60 p-3">
      <label className="flex flex-col gap-1 text-[13px]">
        <span className="text-ink-soft">图标</span>
        <select
          aria-label={`${device.displayName} 的图标`}
          className={`${selectClass} min-h-11`}
          disabled={disabled}
          value={draft.icon}
          onChange={(event) => onChange({ icon: event.target.value as IconKind })}
        >
          {SMART_HOME_ICONS.map((icon) => (
            <option key={icon} value={icon}>
              {ICON_LABELS[icon]}
            </option>
          ))}
        </select>
      </label>
      <QueryFrame query={panel} skeleton={<ListSkeleton rows={2} />}>
        {device.haDeviceId ? (
          <>
            <label className="flex flex-col gap-1 text-[13px]">
              <span className="text-ink-soft">主实体（卡片上的状态和主按钮看它）</span>
              <select
                aria-label={`${device.displayName} 的主实体`}
                className={`${selectClass} min-h-11`}
                disabled={disabled}
                value={draft.primaryEntityId}
                onChange={(event) =>
                  onChange({
                    primaryEntityId: event.target.value,
                    featuredEntityIds: draft.featuredEntityIds.filter((one) => one !== event.target.value),
                    hiddenEntityIds: draft.hiddenEntityIds.filter((one) => one !== event.target.value),
                  })
                }
              >
                {catalog.map((entity) => (
                  <option key={entity.entityId} value={entity.entityId}>
                    {entity.name}（{entity.entityId}）
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-[13px] text-ink-soft">
                主面板项 {draft.featuredEntityIds.length}/{SMART_HOME_FEATURED_LIMIT}（详情里提到最上面，按勾选顺序）
              </legend>
              {choices.map((entity) => {
                const checked = draft.featuredEntityIds.includes(entity.entityId);
                return (
                  <label key={entity.entityId} className="flex min-h-9 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      aria-label={`${entity.name} 做主面板项`}
                      className="size-4 accent-[var(--color-accent)]"
                      disabled={disabled || (!checked && draft.featuredEntityIds.length >= SMART_HOME_FEATURED_LIMIT)}
                      checked={checked}
                      onChange={() => onChange({ featuredEntityIds: toggle(draft.featuredEntityIds, entity.entityId) })}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {entity.name}
                      {entity.category ? (
                        <span className="ml-1 text-[11px] text-ink-soft">{entity.category === 'config' ? '设置' : '诊断'}</span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-[13px] text-ink-soft">藏掉的子实体（详情里不出现，也按不了）</legend>
              {choices.map((entity) => (
                <label key={entity.entityId} className="flex min-h-9 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`藏掉${entity.name}`}
                    className="size-4 accent-[var(--color-accent)]"
                    disabled={disabled}
                    checked={draft.hiddenEntityIds.includes(entity.entityId)}
                    onChange={() => onChange({ hiddenEntityIds: toggle(draft.hiddenEntityIds, entity.entityId) })}
                  />
                  <span className="min-w-0 flex-1 truncate">{entity.name}</span>
                </label>
              ))}
            </fieldset>
          </>
        ) : (
          <p className="text-[12px] text-ink-soft">场景、脚本这类单实体设备没有主面板项</p>
        )}
      </QueryFrame>
      <ToggleRow
        label={`在今天页显示${device.displayName}`}
        checked={draft.pinnedToToday}
        disabled={disabled}
        onChange={() => onChange({ pinnedToToday: !draft.pinnedToToday })}
      />
      {draft.pinnedToToday && pinnedOthers >= SMART_HOME_TODAY_LIMIT ? (
        <p role="status" className="text-[12px] text-warm">
          今天页已经有 {pinnedOthers} 台了，最多显示 {SMART_HOME_TODAY_LIMIT} 台，多的按排序往后放
        </p>
      ) : null}
    </div>
  );
}

/** 白名单里的一台设备：常显名字、房间、控制；展开改主实体、主面板项、藏掉的子实体、图标、今天页；或者移出。 */
function WhitelistRow({ device, focused, pinnedOthers }: { device: SmartHomeDevice; focused: boolean; pinnedOthers: number }) {
  const update = useUpdateSmartHomeDevice();
  const remove = useRemoveSmartHomeDevice();
  const [draft, setDraft] = useState<Draft>(() => draftOf(device));
  const [open, setOpen] = useState(focused);
  const row = useRef<HTMLLIElement>(null);
  const initial = draftOf(device);
  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));
  // 能不能开放控制由服务端最终判断（主实体能控，或者有能控的子实体）；这里只把「肯定不行」的开关藏起来
  const actionable = smartHomeActionsFor(device.primaryDomain).length > 0 || Boolean(device.haDeviceId);
  const body: UpdateSmartHomeDeviceBody = {
    ...(draft.name.trim() !== initial.name ? { displayName: draft.name.trim() } : {}),
    ...(draft.area.trim() !== initial.area ? { area: draft.area.trim() || null } : {}),
    ...(draft.controllable !== initial.controllable ? { controllable: draft.controllable } : {}),
    ...(draft.minRole !== initial.minRole ? { minRole: draft.minRole } : {}),
    ...(draft.icon !== initial.icon ? { icon: draft.icon } : {}),
    ...(draft.primaryEntityId !== initial.primaryEntityId ? { primaryEntityId: draft.primaryEntityId } : {}),
    ...(!sameList(draft.featuredEntityIds, initial.featuredEntityIds) ? { featuredEntityIds: draft.featuredEntityIds } : {}),
    ...(!sameList(draft.hiddenEntityIds, initial.hiddenEntityIds) ? { hiddenEntityIds: draft.hiddenEntityIds } : {}),
    ...(draft.pinnedToToday !== initial.pinnedToToday ? { pinnedToToday: draft.pinnedToToday } : {}),
  };
  const dirty = Object.keys(body).length > 0;
  const busy = update.isPending || remove.isPending;

  useEffect(() => {
    if (focused) row.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focused]);

  return (
    <li
      ref={row}
      data-smart-home-whitelisted={device.primaryEntityId}
      className={`flex flex-col gap-2 border-b border-border px-3.5 py-3 last:border-b-0 ${focused ? 'bg-accent-soft/40' : ''}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-ink-soft">
          <SmartHomeIcon kind={device.icon} size={18} />
        </span>
        <p className="min-w-0 flex-1 truncate text-[12px] text-ink-soft">
          {device.primaryEntityId}
          {device.featuredEntityIds.length ? ` · 主面板项 ${device.featuredEntityIds.length} 个` : ''}
          {device.pinnedToToday ? ' · 今天页' : ''}
          {device.legacy ? ' · 等连上 Home Assistant 后按设备整理' : ''}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label={`${device.displayName} 的中文名`}
          className="min-w-0 flex-[2]"
          maxLength={40}
          disabled={busy}
          value={draft.name}
          onChange={(event) => patch({ name: event.target.value })}
        />
        <Input
          aria-label={`${device.displayName} 的分组`}
          className="min-w-0 flex-1"
          placeholder="房间，比如客厅"
          maxLength={20}
          disabled={busy}
          value={draft.area}
          onChange={(event) => patch({ area: event.target.value })}
        />
      </div>
      {actionable ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-[2]">
            <ToggleRow
              label={`允许在小管家里控制${device.displayName}`}
              checked={draft.controllable}
              disabled={busy}
              onChange={() => patch({ controllable: !draft.controllable })}
            />
          </div>
          <select
            aria-label={`${device.displayName} 谁能控`}
            className={`${selectClass} min-h-11 min-w-0 flex-1`}
            disabled={busy || !draft.controllable}
            value={draft.minRole}
            onChange={(event) => patch({ minRole: event.target.value === 'member' ? 'member' : 'admin' })}
          >
            <option value="admin">只有管理员</option>
            <option value="member">全家都能控</option>
          </select>
        </div>
      ) : null}
      {open ? <DeviceEditor device={device} draft={draft} onChange={patch} disabled={busy} pinnedOthers={pinnedOthers} /> : null}
      <div className="flex flex-wrap gap-2">
        {dirty ? (
          <Button
            className="min-h-11"
            disabled={busy || !draft.name.trim()}
            onClick={() => update.mutate({ id: device.id, body }, { onSuccess: () => pushToast(`已保存「${draft.name.trim()}」`) })}
          >
            保存
          </Button>
        ) : null}
        <Button variant="outline" className="min-h-11" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? '收起' : '主实体、主面板项…'}
        </Button>
        <Button
          variant="ghost"
          className="min-h-11"
          aria-label={`把${device.displayName}移出智能家居`}
          disabled={busy}
          onClick={() => remove.mutate(device.id, { onSuccess: () => pushToast(`「${device.displayName}」已移出`) })}
        >
          移出
        </Button>
      </div>
    </li>
  );
}

/** 旧的按实体登记的行归并以后：把「主实体是传感器、但设备有可控实体」的列出来，要不要换由管理员定（拍板 2）。 */
function MergeNotice() {
  const report = useSmartHomeMergeReport(true);
  const flagged = report.data?.devices.filter((device) => device.sensorPrimaryWithControllable) ?? [];
  if (!flagged.length) return null;
  return (
    <div data-smart-home-merge-notice role="status" className="mx-3.5 mt-3 rounded-xl bg-warm-soft px-3 py-2.5 text-[13px] text-warm">
      按设备整理时，这几台的主实体是传感器，但设备有能控的实体，要不要换主实体你来定：
      <ul className="mt-1 list-disc pl-5">
        {flagged.map((device) => (
          <li key={device.primaryEntityId}>
            {device.displayName}：可控的有 {device.controllableEntityIds.join('、')}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SmartHomeWhitelistPanel() {
  const devices = useSmartHomeDevices();
  const [params] = useSearchParams();
  const focusedId = params.get('device');
  const pinned = (devices.data ?? []).filter((device) => device.pinnedToToday);
  return (
    <Panel title={`家里人能看到的设备${devices.data ? ` ${devices.data.length}` : ''}`} grow={false}>
      <MergeNotice />
      {pinned.length > SMART_HOME_TODAY_LIMIT ? (
        <p role="status" className="mx-3.5 mt-3 rounded-xl bg-warm-soft px-3 py-2 text-[13px] text-warm">
          勾了「在今天页显示」的有 {pinned.length} 台，今天页只放前 {SMART_HOME_TODAY_LIMIT} 台，其余在智能家居页看
        </p>
      ) : null}
      <QueryFrame query={devices} skeleton={<div className="p-3"><ListSkeleton rows={2} /></div>}>
        {devices.data?.length ? (
          <ul>
            {devices.data.map((device) => (
              <WhitelistRow
                key={`${device.id}:${device.updatedAt}`}
                device={device}
                focused={device.id === focusedId}
                pinnedOthers={pinned.filter((one) => one.id !== device.id).length}
              />
            ))}
          </ul>
        ) : (
          <EmptyState emoji="🧺" title="还没挑设备" hint="从右边 Home Assistant 的设备里挑几台常用的" />
        )}
      </QueryFrame>
    </Panel>
  );
}
