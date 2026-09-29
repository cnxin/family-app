import { useState } from 'react';
import { SMART_HOME_TODAY_LIMIT } from '@family/contracts';
import { useAuth } from '../lib/auth';
import { useSmartHomeStates } from '../lib/queries';
import { useModules } from '../lib/queries/modules';
import { todayDevices } from '../lib/smart-home-device-copy';
import { DeviceCard } from './smart-home-card';
import { DeviceDetail } from './smart-home-panel';
import { SoftLink } from './soft-link';

/**
 * 今天页「家里的设备」（smart-home-redesign §2.5、pre-trial-plan H3 E5）：勾了「在今天页显示」的设备，最多 4 张，
 * 卡片和详情就是智能家居页那一套，点卡片在今天页原地打开详情。没有勾的设备、智能家居分段没开、读失败时整块不出现；
 * HA 断开时同设备页（卡片保留上次状态去色），区块里一行说明，不另起横幅。
 */
export function TodayDevices() {
  const { session } = useAuth();
  const modules = useModules();
  const enabled = !modules.initialLoading && modules.visible('smart-home');
  const states = useSmartHomeStates(enabled);
  const [opened, setOpened] = useState<{ id: string; name: string } | null>(null);
  const data = enabled ? states.data : undefined;
  if (!data) return null;
  const { shown, total } = todayDevices(data.devices, SMART_HOME_TODAY_LIMIT);
  if (!shown.length) return null;
  const live = data.connection.available;
  const clock = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: session?.householdTimezone ?? 'Asia/Shanghai',
  });
  const asOf = data.stale && data.asOf ? clock.format(new Date(data.asOf)) : null;

  return (
    <section data-today-devices aria-labelledby="today-devices-title" className="animate-[scrim-in_220ms_ease-out_both]">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 id="today-devices-title" className="text-[13px] font-semibold tracking-wide text-ink-soft">
          家里的设备
        </h2>
        <SoftLink to="/house/smart-home" className="text-[13px] text-accent hover:underline">
          全部 {total} 台 ›
        </SoftLink>
      </div>
      {!live ? (
        <p role="status" className="mb-2 px-1 text-[12.5px] text-danger">
          连不上 Home Assistant{asOf ? `，下面是 ${asOf} 的状态` : ''}，暂时按不了
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {shown.map((device) => (
          <DeviceCard
            key={device.id}
            device={device}
            live={live}
            onOpen={() => setOpened({ id: device.id, name: device.displayName })}
          />
        ))}
      </div>
      {opened ? <DeviceDetail deviceId={opened.id} name={opened.name} onClose={() => setOpened(null)} /> : null}
    </section>
  );
}
