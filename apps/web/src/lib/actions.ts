/** ⌘K 能直接做的事。`to` 带深链，页面读完就把参数抹掉。 */
export interface Action {
  id: string;
  label: string;
  keywords: string[];
  domain: string;
  to: string;
}

export const ACTIONS: Action[] = [
  { id: 'finance-expense', label: '记一笔支出', keywords: ['记账', '花钱'], domain: 'finance', to: '/house/finance?create=1&kind=expense' },
  { id: 'finance-income', label: '记一笔收入', keywords: ['进账'], domain: 'finance', to: '/house/finance?create=1&kind=income' },
  { id: 'guest-visit', label: '加个来访', keywords: ['访客'], domain: 'guests', to: '/house/guests?create=1' },
  { id: 'travel-plan', label: '新建行程', keywords: ['旅行'], domain: 'travel', to: '/life/travel?create=1' },
  { id: 'asset', label: '登记一件资产', keywords: ['家电'], domain: 'assets', to: '/house/assets?create=1' },
  { id: 'poll', label: '发起投票', keywords: ['表决'], domain: 'polls', to: '/schedule/polls?create=1' },
  { id: 'memory', label: '记一条回忆', keywords: ['值得记住'], domain: 'memories', to: '/life/memories?create=1' },
  { id: 'knowledge', label: '写一篇说明', keywords: ['经验'], domain: 'knowledge', to: '/life/knowledge?create=1' },
  { id: 'reminder', label: '加一条提醒', keywords: ['别忘了'], domain: 'reminders', to: '/schedule/reminders?create=1' },
  { id: 'calendar', label: '加日程', keywords: ['事件'], domain: 'calendar', to: '/schedule/calendar?create=1' },
  { id: 'task', label: '加任务', keywords: ['待办'], domain: 'tasks', to: '/schedule/tasks?create=1' },
  { id: 'shopping', label: '加到购物清单', keywords: ['要买'], domain: 'shopping', to: '/house/shopping?create=1' },
  { id: 'dish', label: '新建菜品', keywords: ['菜'], domain: 'recipes', to: '/eat/recipes?create=1' },
];
