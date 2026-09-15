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

import { buildContractIndex } from './registry';
import { calendar } from './calendar';
import { points } from './points';
import { polls } from './polls';
import { reminders } from './reminders';
import { tasks } from './tasks';

/** 所有已定义契约，按域分组。 */
export const contracts = { tasks, polls, calendar, reminders, points };

/** `METHOD /path` → 契约。API 测试模式下的响应校验用它查表。 */
export const contractIndex = buildContractIndex([contracts]);
