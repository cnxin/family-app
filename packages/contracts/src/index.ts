// 小管家 HTTP 契约。
// 每个域一个文件：请求/响应 Zod schema + `defineEndpoint` 注册表。
// 覆盖进度见 docs/api-inventory.md（有契约的端点会被 API 在测试模式下校验响应）。

export * from './common';
export * from './registry';
export * from './tasks';
export * from './polls';
export * from './calendar';
export * from './reminders';
export * from './points';
export * from './dishes';
export * from './recipes';
export * from './shopping';
export * from './inventory';
export * from './menus';
export * from './notifications';
export * from './activities';
export * from './auth';
export * from './finance';
export * from './smart-menu';
export * from './upload';
export * from './guests';
export * from './travel';

import { buildContractIndex } from './registry';
import { activities } from './activities';
import { auth } from './auth';
import { finance } from './finance';
import { smartMenu } from './smart-menu';
import { upload } from './upload';
import { guests } from './guests';
import { travel } from './travel';
import { calendar } from './calendar';
import { dishes } from './dishes';
import { inventory } from './inventory';
import { menus } from './menus';
import { notifications } from './notifications';
import { points } from './points';
import { polls } from './polls';
import { recipes } from './recipes';
import { reminders } from './reminders';
import { shopping } from './shopping';
import { tasks } from './tasks';

/** 所有已定义契约，按域分组。 */
export const contracts = {
  tasks,
  polls,
  calendar,
  reminders,
  points,
  dishes,
  recipes,
  shopping,
  inventory,
  menus,
  notifications,
  activities,
  auth,
  finance,
  smartMenu,
  upload,
  guests,
  travel,
};

/** `METHOD /path` → 契约。API 测试模式下的响应校验用它查表。 */
export const contractIndex = buildContractIndex([contracts]);
