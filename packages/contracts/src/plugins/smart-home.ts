// 智能家居（J1.6，由 J0 草稿转正）。
// smart-home-linkages.service.ts 直接注入 TasksService / RemindersService / ShoppingService，在自己的事务里建任务、提醒、购物项；
// smart-home-links.service.ts 订阅任务打勾事件触发设备联动。都属跨插件调用，原样保留，J1b 改走契约门面 / 内核事件与事务内钩子。
// hasData 要读环境变量里的服务器默认 HA 配置，静态 SQL 表达不了：由 smart-home-has-data.ts 按 id 注册到内核，内核不再 import 本插件。
// ⌘K 与 agent 都还没有智能家居的动作 / 查询（§8.2 缺项，J3 / J4 补）。
import type { PluginManifest } from './types';

export const smartHomeManifest = {
  key: 'smart-home',
  name: '智能家居',
  glyph: '智',
  manifestVersion: 1,
  tier: 'shelf',
  requires: [
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
    { plugin: 'today', via: 'kernel', uses: ['AttentionRegistry', 'ModuleHasDataRegistry'], reason: '往今天页挂留意、向模块开关提供 hasData 判定' },
  ],
  // J1b：留意里查今天的「晾衣服」、联动查今天待做的家务与扫完打勾走任务门面；滤芯低时查购物清单走购物门面。
  // 联动要建的家务 / 提醒 / 清单项走事务内钩子 smart-home.link-fired（订阅方是任务、提醒、购物）
  dependsOn: ['tasks', 'shopping'],
  nav: [{ key: 'smart-home', label: '智能家居', glyph: '智', scene: 'house', path: '/house/smart-home' }],
  module: { overridable: true, hasData: { kind: 'server', id: 'smart-home.hasData' } },
  events: {
    routes: [
      { prefix: '/smart-home' },
      // HA 打来的 webhook，没有登录用户，服务端显式发
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
    mergedTitle: '智能家居有 {n} 件事要看一下',
    // 三条规则在 smart-home-attention.ts，已挂 AttentionRegistry；这里只管文案、落点、排序与开关归属
    kinds: [
      { kind: 'filter', server: 'smart-home.filter', actionLabel: '看滤芯', path: '/house/smart-home?device={id}', title: '{name}的滤芯快用完了' },
      // 落点可以指向别的插件的页面：只是深链，不构成代码依赖
      { kind: 'laundry', server: 'smart-home.laundry', actionLabel: '去晾衣服', path: '/schedule/tasks?task={id}', title: '衣服好了两个多小时，还没晾' },
      { kind: 'offline', server: 'smart-home.offline', actionLabel: '看连接', path: '/house/smart-home/settings', capability: 'manage_integrations', title: 'Home Assistant 连不上一个多小时了' },
    ],
  },
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
    // 控制按来源分开数：联动按的记在家庭主人名下（联动以他的名义执行），不是他本人按的
    tables: [
      { label: '智能家居（手动控制）', table: 'smart_home_commands', memberColumn: 'memberId', createdColumn: 'createdAt', where: "source = 'manual'", note: 'source = manual' },
      { label: '智能家居（联动控制）', table: 'smart_home_commands', memberColumn: 'memberId', createdColumn: 'createdAt', where: "source = 'link'", note: 'source = link，记在家庭主人名下' },
      { label: '智能家居（HA 回报）', table: 'smart_home_events', memberColumn: null, createdColumn: 'receivedAt', where: "event <> 'ping'", note: 'HA 打来的，没有成员' },
    ],
  },
} as const satisfies PluginManifest;
