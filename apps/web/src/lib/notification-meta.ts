import type { NotificationDelivery, NotificationModule } from '@family/contracts';

/** 十个通知模块的中文名和图标。消息列表、渠道偏好、投递记录都用这一份。 */
export const MODULE_LABEL: Record<NotificationModule, string> = {
  menu: '菜单',
  task: '任务',
  poll: '投票',
  calendar: '日历',
  reminder: '提醒',
  media: '观影',
  guest: '访客',
  points: '积分',
  agent: '小管家',
  system: '系统',
};

export const MODULE_ICON: Record<NotificationModule, string> = {
  menu: '🍲',
  task: '✅',
  poll: '🗳',
  calendar: '📅',
  reminder: '🔔',
  media: '🎬',
  guest: '👋',
  points: '🎁',
  agent: '🤖',
  system: '⚙️',
};

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
