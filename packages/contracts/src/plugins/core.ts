// 内核的留意声明（不属于任何插件）：备份。形状与插件 manifest 的 attention 相同，
// 今天页（排序、能力门槛）与前端文案、落点按同一套读；规则在 apps/api/src/system/backups-attention.ts。
import type { KernelDomainKey } from './keys';
import type { PluginAttention } from './types';

export const CORE_ATTENTION: readonly { key: KernelDomainKey; attention: PluginAttention }[] = [
  {
    key: 'backups',
    attention: {
      label: '备份',
      actionLabel: '看备份',
      listActionLabel: '看备份',
      path: '/house/backups',
      order: 8,
      mergedTitle: '备份有 {n} 件事要看一下',
      kinds: [
        { kind: 'backup', server: 'backups.backup', actionLabel: '看备份', capability: 'manage_integrations', title: '备份需要看一下' },
      ],
    },
  },
];
