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
  ...fromPlugin('finance'),
  ...fromPlugin('guests'),
  ...fromPlugin('travel'),
  { id: 'locate', label: '记一下东西放哪', keywords: ['位置', '放在哪', '柜子'], domain: 'locations', to: '/house/inventory?locate=1' },
  { id: 'asset', label: '登记一件资产', keywords: ['家电'], domain: 'assets', to: '/house/assets?create=1' },
  ...fromPlugin('polls'),
  ...fromPlugin('memories'),
  ...fromPlugin('knowledge'),
  ...fromPlugin('reminders'),
  ...fromPlugin('calendar'),
  ...fromPlugin('tasks'),
  ...fromPlugin('shopping'),
  ...fromPlugin('recipes'),
];
