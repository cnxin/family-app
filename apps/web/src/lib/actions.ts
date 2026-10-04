import { pluginActions, type PluginKey } from '@family/contracts';

/** ⌘K 能直接做的事。`to` 带深链，页面读完就把参数抹掉。 */
export interface Action {
  id: string;
  label: string;
  keywords: string[];
  domain: string;
  to: string;
}

/** 已迁插件的动作从 manifest 取（J1），放在原来的位置，顺序不变。 */
function fromPlugin(key: PluginKey): Action[] {
  return pluginActions(key).map((action) => ({
    id: action.id,
    label: action.label,
    keywords: [...action.keywords],
    domain: key,
    to: action.deepLink,
  }));
}

export const ACTIONS: Action[] = [
  { id: 'finance-expense', label: '记一笔支出', keywords: ['记账', '花钱'], domain: 'finance', to: '/house/finance?create=1&kind=expense' },
  { id: 'finance-income', label: '记一笔收入', keywords: ['进账'], domain: 'finance', to: '/house/finance?create=1&kind=income' },
  { id: 'guest-visit', label: '加个来访', keywords: ['访客'], domain: 'guests', to: '/house/guests?create=1' },
  ...fromPlugin('travel'),
  { id: 'locate', label: '记一下东西放哪', keywords: ['位置', '放在哪', '柜子'], domain: 'locations', to: '/house/inventory?locate=1' },
  { id: 'asset', label: '登记一件资产', keywords: ['家电'], domain: 'assets', to: '/house/assets?create=1' },
  { id: 'poll', label: '发起投票', keywords: ['表决'], domain: 'polls', to: '/schedule/polls?create=1' },
  ...fromPlugin('memories'),
  ...fromPlugin('knowledge'),
  { id: 'reminder', label: '加一条提醒', keywords: ['别忘了'], domain: 'reminders', to: '/schedule/reminders?create=1' },
  { id: 'calendar', label: '加日程', keywords: ['事件'], domain: 'calendar', to: '/schedule/calendar?create=1' },
  { id: 'task', label: '加任务', keywords: ['待办'], domain: 'tasks', to: '/schedule/tasks?create=1' },
  { id: 'shopping', label: '加到购物清单', keywords: ['要买'], domain: 'shopping', to: '/house/shopping?create=1' },
  { id: 'dish', label: '新建菜品', keywords: ['菜'], domain: 'recipes', to: '/eat/recipes?create=1' },
];
