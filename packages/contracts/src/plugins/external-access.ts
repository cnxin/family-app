// 外部访问（M5-E 阶段 1：Tailscale 控制面只读面板 + Serve 入口识别）。
// hasData 依赖服务器默认环境变量 / 密钥文件与家庭覆盖行，由 external-access-has-data.ts 注册到内核。
import type { PluginManifest } from './types';

export const externalAccessManifest = {
  key: 'external-access',
  name: '外部访问',
  glyph: '外',
  manifestVersion: 1,
  tier: 'shelf',
  requires: [
    {
      plugin: 'today',
      via: 'kernel',
      uses: ['AttentionRegistry', 'ModuleHasDataRegistry'],
      reason: '往今天页挂密钥到期 / 控制面离线留意，向模块开关提供 hasData 判定',
    },
  ],
  nav: [
    {
      key: 'external-access',
      label: '外部访问',
      glyph: '外',
      scene: 'house',
      path: '/house/external-access',
      managerOnly: true,
    },
  ],
  module: { overridable: true, hasData: { kind: 'server', id: 'external-access.hasData' } },
  events: {
    routes: [{ prefix: '/external-access' }],
    exempt: [
      {
        prefix: '/external-access/settings/test',
        reason: '只读测试：向 Tailscale 控制面换令牌并核验只读权限，不修改配置',
      },
    ],
    queryKeys: [
      'external-access-settings',
      'external-access-overview',
      'external-access-devices',
      'external-access-device',
      'external-access-session',
    ],
  },
  attention: {
    label: '外部访问',
    actionLabel: '去看看',
    listActionLabel: '去看看',
    path: '/house/external-access',
    order: 10,
    mergedTitle: '外部访问有 {n} 项要看一下',
    mixedTitle: '外部访问有 {n} 项要看一下',
    kinds: [
      {
        kind: 'key-expiring',
        server: 'external-access.key-expiring',
        actionLabel: '看设备',
        path: '/house/external-access',
        capability: 'manage_integrations',
        title: '{name} 的访问密钥{soon}到期',
        titleNoDue: '{name} 的访问密钥即将到期',
        mergedTitle: '有 {n} 台设备的访问密钥快到期了',
      },
      {
        kind: 'offline',
        server: 'external-access.offline',
        actionLabel: '看连接',
        path: '/house/external-access/settings',
        capability: 'manage_integrations',
        title: 'Tailscale 控制面暂时连不上',
      },
    ],
  },
  actions: [
    {
      id: 'external-access.open',
      label: '外部访问',
      keywords: ['tailscale', '外网', '远程访问', 'vpn', '外部访问', '节点'],
      deepLink: '/house/external-access',
      capability: 'manage_integrations',
      managerOnly: true,
    },
    {
      id: 'external-access.settings',
      label: '外部访问设置',
      keywords: ['tailscale设置', '外部访问设置', '外网配置'],
      deepLink: '/house/external-access/settings',
      capability: 'manage_integrations',
      managerOnly: true,
    },
  ],
  settingsRows: [
    {
      title: '外部访问',
      hint: '连上 Tailscale，查看外部访问节点与设备状态',
      path: '/house/external-access/settings',
      status: { server: 'external-access.connectorStatus' },
      managerOnly: true,
    },
  ],
} as const satisfies PluginManifest;
