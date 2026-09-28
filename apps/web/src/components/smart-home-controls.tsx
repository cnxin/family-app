import type { SmartHomeAction, SmartHomeDeviceWithState } from '@family/contracts';
import { useSmartHomeCommand } from '../lib/queries';
import { smartHomeButtons } from '../lib/smart-home-copy';
import { Button } from './ui';

/** 按下后给一下轻触感（确认动作已发出）；桌面没有振动器就什么都不发生。 */
function confirmHaptic() {
  navigator.vibrate?.(10);
}

/**
 * 一台设备的控制按钮（E2）。按下后等 HA 执行完才算成功；状态变化随后经 /events 推过来，
 * 所以这里不做乐观更新。失败的原因由全局错误提示弹出。
 */
export function SmartHomeControls({ device }: { device: SmartHomeDeviceWithState }) {
  const command = useSmartHomeCommand();
  const buttons = smartHomeButtons(device.domain, device.state);
  if (!device.canControl || !buttons.length || !device.state || device.state.state === 'unavailable') return null;
  const pendingAction = command.isPending ? command.variables?.action : null;

  const run = (action: SmartHomeAction) =>
    command.mutate({ entityId: device.entityId, action }, { onSuccess: () => confirmHaptic() });

  return (
    <div role="group" aria-label={`控制${device.displayName}`} className="flex shrink-0 flex-wrap justify-end gap-1.5">
      {buttons.map((button) => (
        <Button
          key={button.action}
          variant="outline"
          className="min-h-11 px-3"
          aria-label={`${device.displayName}：${button.label}`}
          disabled={command.isPending}
          onClick={() => run(button.action)}
        >
          {pendingAction === button.action ? '…' : button.label}
        </Button>
      ))}
    </div>
  );
}
