// J0 草稿：智能家居。每个字段注明现在登记在哪；未接线，J1 才改成由它生成。
import type { PluginManifest } from './types';

export const smartHomeManifest = {
  key: 'smart-home',
  name: '智能家居',
  glyph: '智',
  manifestVersion: 1,
  tier: 'shelf',
  requires: [
    // smart-home-linkages.service.ts 直接注入 TasksService / RemindersService / ShoppingService，
    // 在自己的事务里 createWithinTransaction。J1 要改成走契约门面，不再 import 别的插件的 Service。
    {
      plugin: 'tasks',
      via: 'contract',
      uses: ['POST /tasks', 'PATCH /tasks/:taskId/instances/:dueDate', 'GET /tasks'],
      optional: true,
      reason: '洗衣机洗完建「晾衣服」任务、门锁 / 联动完成任务；留意里查今天的晾衣服是否打勾',
    },
    { plugin: 'tasks', via: 'event', uses: ['tasks.completed'], optional: true, reason: '家务打勾触发设备联动（smart-home-links.service.ts）' },
    { plugin: 'reminders', via: 'contract', uses: ['POST /reminders'], optional: true, reason: '滤芯到期建提醒' },
    { plugin: 'shopping', via: 'contract', uses: ['POST /shopping-items'], optional: true, reason: '耗材快用完加进购物清单' },
    { plugin: 'today', via: 'kernel', uses: ['AttentionRegistry'], reason: '往今天页挂留意（已是注册表模式）' },
  ],
  nav: [{ key: 'smart-home', label: '智能家居', glyph: '智', scene: 'house', path: '/house/smart-home' }],
  module: {
    overridable: true,
    // system-modules.service.ts 的 smartHomeSource：要读环境变量里的服务器默认 HA 配置，静态 SQL 表达不了。
    // 现在内核 system 模块反向 import 了 smart-home/home-assistant.config；改成 server 判定后这条反向依赖消失。
    hasData: { kind: 'server', id: 'smart-home.hasData' },
  },
  events: {
    routes: [
      { prefix: '/smart-home' },
      { prefix: '/smart-home/webhook', emit: 'explicit' },
    ],
    queryKeys: [
      'smart-home-states', 'smart-home-devices', 'smart-home-directory', 'smart-home-connector-settings',
      'smart-home-commands', 'smart-home-webhook', 'smart-home-webhook-events', 'smart-home-links',
      'smart-home-panel', 'smart-home-merge-report',
    ],
  },
  attention: {
    label: '智能家居',
    actionLabel: '去看看',
    listActionLabel: '去看看',
    path: '/house/smart-home',
    order: 9,
    kinds: [
      { kind: 'filter', server: 'smart-home.filter', actionLabel: '看滤芯', path: '/house/smart-home?device={id}' },
      // 指向别的插件的页面：留意的落点可以跨插件，但只是深链，不构成代码依赖
      { kind: 'laundry', server: 'smart-home.laundry', actionLabel: '去晾衣服', path: '/schedule/tasks?task={id}' },
      { kind: 'offline', server: 'smart-home.offline', actionLabel: '看连接', path: '/house/smart-home/settings', capability: 'manage_integrations' },
    ],
  },
  // 现在 ⌘K 没有智能家居动作，agent 也没有智能家居工具；以下是 J3 首批要补的，示意 device / room 槽位
  actions: [
    {
      id: 'smart-home.control',
      label: '控制设备',
      keywords: ['开', '关', '启动'],
      deepLink: '/house/smart-home?device={device}',
      slots: { device: 'device', room: 'room?' },
      templates: ['{device}开始', '打开{room}{device}', '关掉{room}{device}'],
    },
  ],
  queries: [
    {
      id: 'smart-home.device-state',
      label: '设备状态',
      templates: ['{device}还能用多久', '{device}现在什么状态', '{room}{device}开着吗'],
      slots: { device: 'device', room: 'room?' },
      server: 'smart-home.deviceState',
      answer: { server: 'smart-home.deviceStateAnswer' },
    },
  ],
  settingsRows: [
    {
      title: '智能家居',
      hint: '连上 Home Assistant，挑几样家里人常看的设备',
      path: '/house/smart-home/settings',
      status: { server: 'smart-home.connectorStatus' },
      managerOnly: true,
    },
  ],
  usage: {
    label: '智能家居',
    tables: [
      { label: '智能家居（手动控制）', table: 'smart_home_commands', memberColumn: 'memberId', createdColumn: 'createdAt', where: "source = 'manual'" },
      { label: '智能家居（联动控制）', table: 'smart_home_commands', memberColumn: 'memberId', createdColumn: 'createdAt', where: "source = 'link'" },
      { label: '智能家居（HA 回报）', table: 'smart_home_events', memberColumn: null, createdColumn: 'receivedAt', where: "event <> 'ping'" },
    ],
  },
} as const satisfies PluginManifest;
