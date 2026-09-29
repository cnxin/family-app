import { smartHomeActionsFor, type SmartHomeDeviceWithState } from '@family/contracts';
import { useSmartHomeCommand } from '../lib/queries';
import { deviceStatusLine, primaryButton } from '../lib/smart-home-device-copy';
import { SmartHomeIcon } from './smart-home-icon';

// 设备卡（smart-home-redesign §2.1）：图标、中文名、一句状态、至多一个主按钮。开 / 关 / 运行 / 离线靠颜色表达。
// 点主按钮直接执行；点卡片其余任何地方打开详情。卡片不是「按钮里套按钮」：铺满整卡的详情按钮垫底，主按钮叠在上面。

const CARD = {
  on: 'bg-accent-soft border-transparent',
  off: 'bg-surface border-border',
  warn: 'bg-surface border-border',
  muted: 'bg-surface border-border opacity-50',
} as const;
const TILE = {
  on: 'bg-accent text-white',
  off: 'bg-muted text-ink-soft',
  warn: 'bg-warm-soft text-warm',
  muted: 'bg-muted text-ink-soft',
} as const;
const STATUS = { on: 'text-accent', off: 'text-ink-soft', warn: 'text-warm', muted: 'text-ink-soft' } as const;

/** 确认动作已发出：轻触一下；桌面没有振动器就什么都不发生。 */
function confirmHaptic() {
  navigator.vibrate?.(10);
}

export function DeviceCard({
  device,
  live,
  onOpen,
}: {
  device: SmartHomeDeviceWithState;
  /** HA 连着：断开时卡片保留上次状态、去色、收起主按钮 */
  live: boolean;
  onOpen: () => void;
}) {
  const command = useSmartHomeCommand();
  const line = deviceStatusLine(device);
  const button = device.canControl && live && device.online ? primaryButton(device.primaryDomain, device.primary) : null;
  const usable = button && smartHomeActionsFor(device.primaryDomain).includes(button.action) ? button : null;
  const pending = command.isPending;
  return (
    <article
      data-smart-home-device={device.primaryEntityId}
      data-tone={line.tone}
      className={
        'relative flex min-h-[112px] flex-col rounded-[18px] border p-3 transition-[transform,background-color] duration-150 ease-out ' +
        'has-[[data-card-open]:active]:scale-[.98] ' +
        CARD[line.tone] +
        (live ? '' : ' grayscale opacity-55')
      }
    >
      <button
        type="button"
        data-card-open
        aria-label={`打开${device.displayName}的详情`}
        className="absolute inset-0 rounded-[18px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        onClick={onOpen}
      />
      <div className="pointer-events-none relative mb-2 flex items-start justify-between gap-2">
        <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${TILE[line.tone]}`}>
          <SmartHomeIcon kind={device.icon} />
        </span>
        {usable ? (
          <button
            type="button"
            aria-label={`${device.displayName}：${usable.label}`}
            aria-busy={pending || undefined}
            disabled={pending}
            className={
              'pointer-events-auto min-h-11 min-w-14 rounded-full px-3.5 text-sm font-medium transition-transform duration-150 active:scale-[.97] ' +
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-60 ' +
              (line.tone === 'on' ? 'bg-surface text-ink' : 'border border-border bg-surface text-ink')
            }
            onClick={() => command.mutate({ deviceId: device.id, action: usable.action }, { onSuccess: confirmHaptic })}
          >
            {pending ? '…' : usable.label}
          </button>
        ) : null}
      </div>
      <p className="pointer-events-none relative truncate text-[15px] font-semibold">{device.displayName}</p>
      <p className={`pointer-events-none relative truncate text-[13px] ${STATUS[line.tone]}`}>
        {line.text}
        {device.primary?.assumed && device.primary.state !== 'unavailable' ? (
          <span data-smart-home-assumed title="红外遥控：按上次操作显示" className="ml-1 text-ink-soft">
            ≈
          </span>
        ) : null}
      </p>
    </article>
  );
}

/** 场景一排里的一个：一键执行（场景、脚本）。断开或没权限时不能点。 */
export function SceneChip({ device, live }: { device: SmartHomeDeviceWithState; live: boolean }) {
  const command = useSmartHomeCommand();
  const usable = device.canControl && live;
  return (
    <button
      type="button"
      data-smart-home-device={device.primaryEntityId}
      aria-label={`${device.displayName}：执行`}
      aria-busy={command.isPending || undefined}
      disabled={!usable || command.isPending}
      className={
        'flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-surface py-0 pl-3 pr-4 text-sm ' +
        'transition-transform duration-150 active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ' +
        'disabled:opacity-50'
      }
      onClick={() => command.mutate({ deviceId: device.id, action: 'activate' }, { onSuccess: confirmHaptic })}
    >
      <span className="text-accent">
        <SmartHomeIcon kind="scene" size={18} />
      </span>
      {command.isPending ? '…' : device.displayName}
    </button>
  );
}
