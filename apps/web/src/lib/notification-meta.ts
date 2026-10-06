import { pluginNotificationModules, type NotificationDelivery, type NotificationModule } from '@family/contracts';

/** 十个通知模块的中文名和图标。消息列表、渠道偏好、投递记录都用这一份。 */
/** 内核条目，不属于任何插件；assistant 工具清单归 J1b（§8.6 第 2 条）。 */
const CORE_MODULE_LABEL: Partial<Record<NotificationModule, string>> = {
  agent: '小管家',
  system: '系统',
};

const CORE_MODULE_ICON: Partial<Record<NotificationModule, string>> = {
  agent: '🤖',
  system: '⚙️',
};

// 插件的通知名与图标由 manifest 生成（J1）
export const MODULE_LABEL = {
  ...CORE_MODULE_LABEL,
  ...Object.fromEntries(pluginNotificationModules().map((module) => [module.key, module.label])),
} as Record<NotificationModule, string>;

export const MODULE_ICON = {
  ...CORE_MODULE_ICON,
  ...Object.fromEntries(pluginNotificationModules().map((module) => [module.key, module.icon])),
} as Record<NotificationModule, string>;

export const DELIVERY_STATUS_LABEL: Record<NotificationDelivery['status'], string> = {
  pending: '等待投递',
  processing: '正在投递',
  retry_scheduled: '等待重试',
  sent: '投递成功',
  failed: '投递失败',
};

export function fullTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
