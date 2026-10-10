// 智能家居门面（J4 第四批）：实现在 apps/api/src/smart-home/smart-home.facade.ts，注册到 PluginFacadeRegistry。
// 消费方：小管家（读工具 get_device_status）。
import type { PluginActor } from './kernel';

export interface DeviceStatusView {
  id: string;
  name: string;
  room: string | null;
  /** 一句状态，与控制页卡片同一套说法（「正在清扫 · 80%」「制冷 26°」「滤芯剩 8%」「离线」） */
  status: string;
  online: boolean;
}

export interface SmartHomeDeviceStatuses {
  /** connected 连着；unreachable 连不上（状态是最近一次读到的）；not_configured 还没连 Home Assistant */
  connection: 'connected' | 'unreachable' | 'not_configured';
  devices: DeviceStatusView[];
}

export interface SmartHomeFacade {
  /** 只读：设备的一句状态；deviceId / room（房间名包含匹配）筛选。场景、脚本不算设备。 */
  deviceStatuses(filter: { deviceId?: string; room?: string }, actor: PluginActor): Promise<SmartHomeDeviceStatuses>;
}
