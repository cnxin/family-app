// 全部插件 manifest 的元组（保留每份 manifest 的字面量类型）：agent 工具名单要在类型层面从它推导出字面量联合。
// 单独一个文件：plugins/index.ts 与 plugins/agent-tools.ts 都从这里取，免得两者互相 import。
import { assetsManifest } from './assets';
import { calendarManifest } from './calendar';
import { financeManifest } from './finance';
import { guestsManifest } from './guests';
import { inventoryManifest } from './inventory';
import { knowledgeManifest } from './knowledge';
import { locationsManifest } from './locations';
import { mediaManifest } from './media';
import { memoriesManifest } from './memories';
import { menusManifest } from './menus';
import { pointsManifest } from './points';
import { pollsManifest } from './polls';
import { recipesManifest } from './recipes';
import { remindersManifest } from './reminders';
import { shoppingManifest } from './shopping';
import { smartHomeManifest } from './smart-home';
import { tasksManifest } from './tasks';
import { travelManifest } from './travel';

/** 已迁移的插件。顺序没有运行时含义，各登记处的顺序仍由各自决定。 */
export const PLUGIN_MANIFESTS = [knowledgeManifest, memoriesManifest, travelManifest, pollsManifest, recipesManifest, pointsManifest, guestsManifest, financeManifest, shoppingManifest, tasksManifest, calendarManifest, remindersManifest, menusManifest, locationsManifest, inventoryManifest, assetsManifest, mediaManifest, smartHomeManifest] as const;
