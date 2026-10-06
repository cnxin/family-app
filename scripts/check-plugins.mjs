#!/usr/bin/env node
// J1：插件 manifest 与各处登记一致（docs/architecture.md §8.1 的 14 处）。
//
// J1.7 起全量：18 个插件都有 manifest，各处登记里插件的条目全部由 manifest 导出；
// 还手写的只有下面 KNOWN_HANDWRITTEN 列的几处（只做一致性断言），以及内核 / 助理层的 CORE_* 表（不许出现插件 key 或别名）。
// 其余任何手写的插件条目都报错。web 端登记的运行时结果另由 apps/web/src/lib/plugins-registry.test.ts 断言。
// 依赖已构建的 packages/contracts（corepack pnpm build:packages；install 的 postinstall 会构建）。

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'packages/contracts/package.json'));
const c = require('./dist/index.js');

const errors = [];
const fail = (message) => errors.push(message);
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 从 marker 所在行起，取到与它同缩进的第一个 `]` / `}`（可带 `;` `,` `)` 或 ` satisfies …;`）为止的一段。 */
function block(path, marker) {
  const source = read(path);
  const start = source.indexOf(marker);
  if (start < 0) {
    fail(`${path}：找不到「${marker}」，登记处改名了？同步改 scripts/check-plugins.mjs`);
    return '';
  }
  const lineStart = source.lastIndexOf('\n', start) + 1;
  const indent = source.slice(lineStart, start).match(/^\s*/)[0];
  const lines = source.slice(lineStart).split('\n');
  const end = lines.findIndex((line, index) => index > 0 && new RegExp(`^${indent}[\\]}]([;,)]*| satisfies .*;)$`).test(line));
  return (end < 0 ? lines : lines.slice(0, end + 1)).join('\n');
}

/** 对象字面量里有没有这个 key（`key:` 或 `'key':`）。 */
const hasKey = (text, key) => new RegExp(`(^|[\\s{,])'?${escape(key)}'?\\s*:`, 'm').test(text);

const PLUGINS = c.PLUGINS;

/**
 * J1 收口后仍手写、且里面有插件 key 的登记（§8.1 编号）。它们是 key 表、顺序表、数据库枚举或页面文件，
 * 不由 manifest 生成；脚本只断言它们与 manifest 一致。新增一处手写插件登记，要么改成从 manifest 生成，要么登记到这里并写明原因。
 */
const KNOWN_HANDWRITTEN = [
  { no: '①', file: 'apps/web/src/lib/nav.ts', what: 'CORE_KEYS、mobileTabs 的 pick', reason: '只按 key 排的顺序表；断言与 manifest 的 tier / mobileTab 一致' },
  { no: '②', file: 'packages/contracts/src/system.ts', what: 'SHELF_MODULE_KEYS', reason: '模块开关 key 表（含内核的 activity / assistant）；断言与 module.overridable 一致' },
  { no: '⑤', file: 'packages/contracts/src/today.ts', what: '留意 domain 枚举', reason: 'zod 枚举；断言与 manifest + CORE_ATTENTION 的留意域一致' },
  { no: '⑧', file: 'packages/contracts/src/agent.ts', what: 'AGENT_READ_TOOLS / AGENT_PROPOSAL_TOOLS / AGENT_MEMORY_TOOLS', reason: 'MCP 注册与 Hermes 配置契约按字面量名单走；断言每个工具恰好被一个插件或 KERNEL_AGENT_TOOLS 认领' },
  { no: '⑩', file: 'apps/web/src/pages/settings.tsx', what: '家庭设置行', reason: '页面文件，J1 不改页面；断言与 manifest.settingsRows 一致' },
  { no: '⑫', file: 'packages/contracts/src/activities.ts', what: 'ACTIVITY_MODULES', reason: '数据库约束里的值；断言别名表归属唯一' },
  { no: '⑬', file: 'packages/contracts/src/notifications.ts', what: 'NOTIFICATION_MODULES', reason: '数据库约束里的值；断言别名表归属唯一、与 manifest.notifications 一一对应' },
  { no: '⑭', file: 'apps/api/src/auth/capabilities.ts', what: 'Capability 名字清单', reason: '能力名 key 表；断言 manifest 声明的能力、动作能力、留意能力都在里面' },
];

/** 内核 / 助理层的表（J1.7 由 HANDWRITTEN_* 改名）：只许放内核条目，不许出现 18 个插件的 key 或别名。 */
const CORE_TABLES = [
  ['packages/contracts/src/events.ts', 'const CORE_EVENT_ROUTES'],
  ['packages/contracts/src/events.ts', 'const CORE_EVENT_ROUTE_EXEMPT'],
  // 留意声明的对象 key 是字段名（order、label…），只查字符串值
  ['packages/contracts/src/plugins/core.ts', 'export const CORE_ATTENTION', { values: true }],
  ['apps/web/src/lib/events.ts', 'const CORE_QUERY_KEYS'],
  ['apps/web/src/lib/notification-meta.ts', 'const CORE_MODULE_LABEL'],
  ['apps/web/src/lib/notification-meta.ts', 'const CORE_MODULE_ICON'],
  ['apps/web/src/lib/nav.ts', 'const CORE_NAV'],
  ['apps/web/src/lib/routes.ts', 'const CORE_LEGACY_PATHS'],
  ['apps/api/src/auth/capabilities.ts', 'const CORE_ROLE_CAPABILITIES'],
  // assistant 内核工具清单（J1b.5）：对象 key 是工具名，只查字符串值；CORE_TOOL_SOURCES 由它派生
  ['packages/contracts/src/plugins/core-assistant.ts', 'export const CORE_ASSISTANT_TOOLS', { values: true }],
  ['packages/contracts/src/plugins/core-assistant.ts', 'export const CORE_TOOL_SOURCES', { values: true }],
  ['apps/api/scripts/usage-report.mjs', 'const CORE_ACTIVITY_DOMAINS'],
];
/** CORE_* 里允许出现的插件写法（逐行原文）。都是写进数据库的值，J1 不改。 */
const CORE_EXCEPTIONS = [
  { table: 'export const CORE_ASSISTANT_TOOLS', line: "get_today_summary: { label: '今日摘要', sourceModule: 'calendar' },", reason: '跨域内核工具，调用记录历来记在 calendar 名下（数据库里的值，J1b 不改）' },
  { table: 'export const CORE_ASSISTANT_TOOLS', line: "get_family_schedule: { label: '家庭日程', sourceModule: 'calendar' },", reason: '同上' },
];

// ---- 1. key 与 manifest 本身 ----------------------------------------------------------------------

const domainKeys = new Set(c.DOMAIN_KEYS);
for (const key of [...c.PLUGIN_KEYS, ...c.KERNEL_DOMAIN_KEYS]) {
  if (!domainKeys.has(key)) fail(`DOMAIN_KEYS 缺 ${key}`);
}
if (domainKeys.size !== c.PLUGIN_KEYS.length + c.KERNEL_DOMAIN_KEYS.length) fail('DOMAIN_KEYS 与插件 + 内核 key 不一一对应');
for (const key of c.SHELF_MODULE_KEYS) if (!domainKeys.has(key)) fail(`SHELF_MODULE_KEYS 里的 ${key} 不是域 key`);

// 18 个插件每个都有 manifest 文件并在 PLUGINS 里（J1.7 起全量）
for (const key of c.PLUGIN_KEYS) {
  if (!existsSync(join(ROOT, `packages/contracts/src/plugins/${key}.ts`))) fail(`插件 ${key} 没有 manifest 文件 packages/contracts/src/plugins/${key}.ts`);
  if (!PLUGINS.some((plugin) => plugin.key === key)) fail(`插件 ${key} 不在 PLUGINS 里`);
}

const seen = new Set();
for (const plugin of PLUGINS) {
  if (!c.PLUGIN_KEYS.includes(plugin.key)) fail(`manifest ${plugin.key} 不在 PLUGIN_KEYS`);
  if (seen.has(plugin.key)) fail(`manifest ${plugin.key} 重复`);
  seen.add(plugin.key);
  if (plugin.manifestVersion !== 1) fail(`${plugin.key}：manifestVersion 必须为 1`);
  // J1b：dependsOn / hooks 的形状（与代码是否一致的强制断言在 J1b.6）
  for (const dependency of plugin.dependsOn ?? []) {
    if (!c.PLUGIN_KEYS.includes(dependency)) fail(`${plugin.key}：dependsOn 里的 ${dependency} 不是插件 key`);
    if (dependency === plugin.key) fail(`${plugin.key}：dependsOn 不能写自己`);
  }
  if (new Set(plugin.dependsOn ?? []).size !== (plugin.dependsOn ?? []).length) fail(`${plugin.key}：dependsOn 有重复`);
  for (const hook of plugin.hooks ?? []) {
    if (!c.TRANSACTION_HOOK_NAMES.includes(hook)) fail(`${plugin.key}：hooks 里的 ${hook} 不在 contracts 的 TRANSACTION_HOOK_NAMES 里`);
  }
  if (new Set(plugin.hooks ?? []).size !== (plugin.hooks ?? []).length) fail(`${plugin.key}：hooks 有重复`);
}

// ---- 2. 别名表：各 key 空间的每个值都有唯一归属，别名表里没有死值 -------------------------------------------

const spaces = [
  ['activity', c.ACTIVITY_MODULES, 'ACTIVITY_MODULES'],
  ['notification', c.NOTIFICATION_MODULES, 'NOTIFICATION_MODULES'],
  ['proposal', c.AGENT_ACTION_TYPES, 'AGENT_ACTION_TYPES'],
];
for (const [space, values, name] of spaces) {
  for (const value of values) {
    const owners = [
      ...c.PLUGIN_KEYS.filter((key) => c.PLUGIN_ALIASES[key][space]?.includes(value)),
      ...(c.KERNEL_ALIASES[space].includes(value) ? ['kernel'] : []),
    ];
    if (owners.length !== 1) fail(`${name} 的「${value}」归属 ${owners.length === 0 ? '没登记' : `不唯一：${owners.join('、')}`}（plugins/keys.ts）`);
  }
  for (const key of c.PLUGIN_KEYS) {
    for (const alias of c.PLUGIN_ALIASES[key][space] ?? []) {
      if (!values.includes(alias)) fail(`别名表 ${key}.${space} 的「${alias}」在 ${name} 里不存在`);
    }
  }
}

// ---- 3. agent 工具：名单唯一，每个工具恰好一个归属（插件或 KERNEL_AGENT_TOOLS） --------------------------------

const tools = [...c.AGENT_READ_TOOLS, ...c.AGENT_PROPOSAL_TOOLS, ...c.AGENT_MEMORY_TOOLS];
if (new Set(tools).size !== tools.length) fail('agent 工具名单有重复');
const owners = new Map();
const claim = (tool, owner) => {
  if (!tools.includes(tool)) fail(`${owner} 认领的工具 ${tool} 不在 agent 工具名单里`);
  if (owners.has(tool)) fail(`工具 ${tool} 被 ${owners.get(tool)} 和 ${owner} 重复认领`);
  owners.set(tool, owner);
};
for (const tool of c.KERNEL_AGENT_TOOLS) claim(tool, 'kernel');
for (const plugin of PLUGINS) {
  for (const query of plugin.queries ?? []) if (query.legacyTool) claim(query.legacyTool, plugin.key);
  for (const proposal of c.proposalsOf(plugin)) if (proposal.legacyTool) claim(proposal.legacyTool, plugin.key);
}
const unowned = tools.filter((tool) => !owners.has(tool));
// 内核清单（core-assistant.ts）：每个内核工具都有标签与调用记录来源；服务端不再另写一份来源表
for (const tool of c.KERNEL_AGENT_TOOLS) {
  const entry = c.CORE_ASSISTANT_TOOLS[tool];
  if (!entry?.label || !entry?.sourceModule) fail(`内核工具 ${tool} 在 CORE_ASSISTANT_TOOLS 里缺标签或 sourceModule`);
  if (c.CORE_TOOL_SOURCES[tool] !== entry?.sourceModule) fail(`CORE_TOOL_SOURCES.${tool} 与 CORE_ASSISTANT_TOOLS 不一致`);
}
if (Object.keys(c.CORE_ASSISTANT_TOOLS).length !== c.KERNEL_AGENT_TOOLS.length) fail('CORE_ASSISTANT_TOOLS 与 KERNEL_AGENT_TOOLS 条目不一致');
if (/const CORE_TOOL_SOURCES\b/.test(read('apps/api/src/agent/agent-tools.service.ts'))) {
  fail('agent-tools.service.ts 又手写了内核工具来源表：从 @family/contracts 的 CORE_TOOL_SOURCES 取');
}
// J1.6 起每个 agent 工具都有归属（插件 manifest 或内核清单 KERNEL_AGENT_TOOLS），新加工具必须登记
if (unowned.length) fail(`有无主的 agent 工具：${unowned.join('、')}（登记进某个插件 manifest 的 queries / actions / proposals，或 KERNEL_AGENT_TOOLS）`);

// ⌘K 动作对谁可见只看 manifest，不在面板里按域写死权限特判（§8.6 第 3、5 条）
if (/action\.domain\s*[!=]==/.test(read('apps/web/src/components/command-palette.tsx'))) {
  fail('command-palette.tsx 按域写死了动作可见性，改在 manifest 里声明');
}

// 内核模块不许 import 插件目录的代码（§8.2「不一致」第 6 条，J1.6 解掉 system → smart-home）
for (const kernelDir of ['system', 'today', 'activities', 'notifications', 'events']) {
  const dir = join(ROOT, 'apps/api/src', kernelDir);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((one) => one.endsWith('.ts'))) {
    const text = read(`apps/api/src/${kernelDir}/${file}`);
    for (const key of c.PLUGIN_KEYS) {
      if (existsSync(join(ROOT, 'apps/api/src', key)) && text.includes(`from '../${key}/`)) {
        fail(`内核 apps/api/src/${kernelDir}/${file} import 了插件 ${key} 的代码`);
      }
    }
  }
}

// ---- 1b. 内核表：CORE_* 只放内核条目；新加 CORE_* 表要登记进 CORE_TABLES -------------------------------------

{
  const pluginWords = new Set([
    ...c.PLUGIN_KEYS,
    ...c.PLUGIN_KEYS.flatMap((key) => Object.values(c.PLUGIN_ALIASES[key]).flat()),
  ]);
  for (const [path, marker, options] of CORE_TABLES) {
    let text = block(path, marker);
    for (const exception of CORE_EXCEPTIONS.filter((one) => one.table === marker)) text = text.replace(exception.line, '');
    for (const word of pluginWords) {
      if (text.includes(`'${word}'`) || (!options?.values && hasKey(text, word))) {
        fail(`${path} ${marker} 里出现了插件 key / 别名「${word}」：插件条目要写进 manifest`);
      }
    }
  }
  const declaredTables = new Set(CORE_TABLES.map(([path, marker]) => `${path}|${marker.replace(/^(export )?const /, '')}`));
  for (const path of [...new Set(CORE_TABLES.map(([path]) => path))]) {
    for (const [, name] of read(path).matchAll(/^(?:export )?const (CORE_[A-Z_]+)\b/gm)) {
      // nav.ts 的 CORE_KEYS 是 core 层（今天 / 点菜 / 购物…）的顺序表，不是内核表，见 KNOWN_HANDWRITTEN ①
      if (path === 'apps/web/src/lib/nav.ts' && name === 'CORE_KEYS') continue;
      if (!declaredTables.has(`${path}|${name}`)) fail(`${path} 新加了 ${name}：先登记进 check-plugins 的 CORE_TABLES`);
    }
  }
}

// ---- 1c. 留意：注册到 AttentionRegistry 的种类 == manifest + CORE_ATTENTION 声明的种类 --------------------------

{
  const declaredKinds = new Set(c.allAttention().flatMap(({ key, attention }) => attention.kinds.map((kind) => `${key}:${kind.kind}`)));
  const registeredKinds = new Set();
  const walk = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(`${dir}/${entry.name}`) : entry.name.endsWith('.ts') ? [`${dir}/${entry.name}`] : []);
  for (const file of walk('apps/api/src')) {
    const text = read(file);
    if (!text.includes('implements AttentionSource')) continue;
    const pattern = /export class (\w+) implements AttentionSource[^{]*\{\s*readonly domain = '([\w-]+)' as const;\s*readonly kinds = \[([^\]]*)\] as const;/g;
    let found = 0;
    for (const [, name, domain, kinds] of text.matchAll(pattern)) {
      found += 1;
      // 每个来源都要真的注册：注册类里 register(this.<注入它的字段>)，或者来源自己 register(this)
      const field = text.match(new RegExp(`private readonly (\\w+): ${name}\\b`))?.[1];
      const ownBody = text.slice(text.indexOf(`export class ${name} `)).split(/\nexport class /)[0];
      if (!(field && text.includes(`registry.register(this.${field})`)) && !ownBody.includes('registry.register(this)')) {
        fail(`${file}：留意来源 ${name} 没有注册到 AttentionRegistry`);
      }
      for (const [, kind] of kinds.matchAll(/'([\w-]+)'/g)) {
        const id = `${domain}:${kind}`;
        if (registeredKinds.has(id)) fail(`留意 ${id} 被两个来源注册（${name}）`);
        registeredKinds.add(id);
      }
    }
    const classes = (text.match(/implements AttentionSource/g) ?? []).length;
    if (found !== classes) fail(`${file}：留意来源要紧跟着写 readonly domain / readonly kinds（check-plugins 按这个读种类）`);
  }
  for (const id of declaredKinds) if (!registeredKinds.has(id)) fail(`留意 ${id} 有声明，没有来源注册`);
  for (const id of registeredKinds) if (!declaredKinds.has(id)) fail(`留意 ${id} 有来源注册，没有声明（manifest 的 attention 或 CORE_ATTENTION）`);
  const enumDomains = [...c.attentionItemSchema.shape.domain.options].sort();
  const attentionKeys = c.allAttention().map(({ key }) => key).sort();
  if (JSON.stringify(enumDomains) !== JSON.stringify(attentionKeys)) {
    fail(`contracts/today.ts 的留意 domain 枚举（${enumDomains.join('、')}）与声明了留意的域（${attentionKeys.join('、')}）不一致`);
  }
}

// 内核留意声明的能力名也必须存在
{
  const union = read('apps/api/src/auth/capabilities.ts').match(/export type Capability =([^;]*);/)?.[1] ?? '';
  for (const { key, attention } of c.CORE_ATTENTION) {
    for (const kind of attention.kinds) {
      if (kind.capability && !union.includes(`'${kind.capability}'`)) fail(`内核留意 ${key}/${kind.kind} 的能力 ${kind.capability} 不在 Capability 清单里`);
    }
  }
}

// propose_plan 能打包的步骤类型：MCP 入参的判别联合是手写的（agent-mcp.controller.ts），必须与 manifest 里
// grouped 不为 false 的提案类型一致；服务端 GROUPABLE_ACTION_TYPES 由 manifest 推出，两道闸口不许不同步
{
  const mcp = read('apps/api/src/agent/agent-mcp.controller.ts');
  const start = mcp.indexOf("'propose_plan',");
  const union = start < 0 ? '' : mcp.slice(start, mcp.indexOf("'propose_", start + 20));
  const mcpTypes = [...union.matchAll(/type: z\.literal\('([\w-]+)'\)/g)].map(([, type]) => type).sort();
  const groupable = c.pluginProposals().filter((one) => one.grouped).map((one) => one.actionType).sort();
  if (!mcpTypes.length) fail('agent-mcp.controller.ts 找不到 propose_plan 的步骤类型（type: z.literal）');
  if (JSON.stringify(mcpTypes) !== JSON.stringify(groupable)) {
    fail(`MCP propose_plan 能打包的步骤类型（${mcpTypes.join('、')}）与 manifest 里可打包的提案类型（${groupable.join('、')}）不一致`);
  }
}

// ---- 4. contracts 内的登记（dist 运行时结果） ---------------------------------------------------------

const prefixes = c.EVENT_ROUTES.map((route) => route.prefix);
for (const prefix of new Set(prefixes)) {
  if (prefixes.filter((one) => one === prefix).length > 1) fail(`EVENT_ROUTES 里 ${prefix} 登记了两次（manifest 与手写重复？）`);
}
for (const route of c.EVENT_ROUTES) {
  for (const domain of route.domains) if (!domainKeys.has(domain)) fail(`EVENT_ROUTES ${route.prefix} 的域 ${domain} 不存在`);
}
const attentionDomains = c.attentionItemSchema.shape.domain.options;
const handwrittenEvents = block('packages/contracts/src/events.ts', 'const CORE_EVENT_ROUTES');

for (const plugin of PLUGINS) {
  const { key } = plugin;
  const where = `[${key}]`;
  if (c.SHELF_MODULE_KEYS.includes(key) !== plugin.module.overridable) {
    fail(`${where} module.overridable 与 SHELF_MODULE_KEYS 不一致`);
  }
  if (attentionDomains.includes(key) !== Boolean(plugin.attention)) {
    fail(`${where} 有无留意与 contracts/today.ts 的 domain 枚举不一致`);
  }
  for (const route of plugin.events.routes) {
    if (new RegExp(`prefix: '${escape(route.prefix)}'`).test(handwrittenEvents)) {
      fail(`${where} 事件路由 ${route.prefix} 还在 events.ts 手写表里`);
    }
  }
  // 手写表里以本域打头的路由应该已经搬进 manifest
  for (const line of handwrittenEvents.split('\n')) {
    if (new RegExp(`domains: \\['${escape(key)}'[,\\]]`).test(line)) fail(`${where} events.ts 手写表还有本域路由：${line.trim()}`);
  }

  // ---- 5. web / api 里其余登记处不许有本域的手写条目（18 个插件全量） ------------------------------------------

  const navKeys = [key, ...(c.PLUGIN_ALIASES[key].nav ?? [])];
  const nav = read('apps/web/src/lib/nav.ts');
  for (const navKey of navKeys) {
    const literal = new RegExp(`key: '${escape(navKey)}'|shelfModuleKey\\.enum(\\.${escape(navKey)}\\b|\\['${escape(navKey)}'\\])`);
    if (literal.test(nav)) fail(`${where} nav.ts 还手写着分段 ${navKey}`);
  }
  // core 段的顺序（CORE_KEYS）和手机底栏（mobileTabs 的 pick）只按 key 排，仍手写；与 manifest 的 tier / mobileTab 一致
  const coreKeys = nav.match(/const CORE_KEYS = \[([^\]]*)\]/)?.[1];
  if (coreKeys === undefined) fail('nav.ts 找不到 CORE_KEYS');
  const tabs = [...nav.matchAll(/sceneByKey\('([\w-]+)'\), segments: pick\(\[([^\]]*)\]\)/g)].map(([, tab, keys]) => [tab, keys]);
  if (!tabs.length) fail('nav.ts 找不到 mobileTabs 的 pick');
  for (const segment of plugin.nav) {
    const core = (segment.tier ?? plugin.tier) === 'core';
    if (core !== (coreKeys ?? '').includes(`'${segment.key}'`)) fail(`${where} 分段 ${segment.key} 的 tier 与 nav.ts CORE_KEYS 不一致`);
    const inTabs = tabs.filter(([, keys]) => keys.includes(`'${segment.key}'`)).map(([tab]) => tab);
    if (JSON.stringify(inTabs) !== JSON.stringify(segment.mobileTab ? [segment.mobileTab] : [])) {
      fail(`${where} 分段 ${segment.key} 的 mobileTab（${segment.mobileTab ?? '—'}）与 nav.ts mobileTabs（${inTabs.join('、') || '—'}）不一致`);
    }
  }
  if (new RegExp(`domain: '${escape(key)}'`).test(block('apps/web/src/lib/actions.ts', 'export const ACTIONS'))) {
    fail(`${where} actions.ts 还手写着本域动作`);
  }
  if (hasKey(block('apps/web/src/lib/events.ts', 'const CORE_QUERY_KEYS'), key)) fail(`${where} web events.ts 内核查询 key 表里有本域`);
  const systemModules = read('apps/api/src/system/system-modules.service.ts');
  if (systemModules.includes(`key === '${key}'`)) fail(`${where} system-modules.service.ts 还在按 key 特判 hasData`);
  if (plugin.module.hasData.kind === 'server') {
    const registered = new RegExp(`register\\(\\s*'${escape(plugin.module.hasData.id)}'`);
    const sources = readdirSync(join(ROOT, 'apps/api/src', key)).filter((file) => file.endsWith('.ts'));
    if (!sources.some((file) => registered.test(read(`apps/api/src/${key}/${file}`)))) {
      fail(`${where} hasData 判定 ${plugin.module.hasData.id} 没有在 apps/api/src/${key}/ 里注册到 ModuleHasDataRegistry`);
    }
  }
  const toolSources = block('packages/contracts/src/plugins/core-assistant.ts', 'export const CORE_ASSISTANT_TOOLS');
  for (const [tool, owner] of owners) {
    if (owner === key && hasKey(toolSources, tool)) fail(`${where} agent-tools.service.ts sourceModule 还手写着 ${tool}`);
  }
  const usage = plugin.usage;
  const activity = block('apps/api/scripts/usage-report.mjs', 'const CORE_ACTIVITY_DOMAINS');
  for (const module of usage?.activityModules ?? []) if (hasKey(activity, module)) fail(`${where} usage-report.mjs 还手写着流水 ${module}`);
  const snapshotSources = block('apps/api/scripts/usage-report.mjs', 'const SNAPSHOT_SOURCES');
  for (const snapshot of usage?.snapshots ?? []) {
    if (!hasKey(snapshotSources, snapshot.server)) fail(`${where} 用量快照 ${snapshot.server} 在 usage-report.mjs SNAPSHOT_SOURCES 里没有实现`);
  }
  // 流水 module 必须挂在 manifest 上：别名表里有的流水值，manifest 里也要声明
  for (const module of c.PLUGIN_ALIASES[key].activity ?? []) {
    if (!(usage?.activityModules ?? []).includes(module)) fail(`${where} 别名表里的流水 ${module} 没写进 manifest.usage.activityModules`);
  }

  // 留意文案与落点（web）
  if (plugin.attention) {
    const copy = read('apps/web/src/lib/attention-copy.ts');
    for (const kind of plugin.attention.kinds) {
      if (copy.includes(`'${kind.kind}'`)) fail(`${where} attention-copy.ts 还手写着 ${kind.kind}`);
    }
    if (copy.includes(`'${key}'`)) fail(`${where} attention-copy.ts 还手写着本域`);
    if (read('apps/web/src/lib/routes.ts').includes(`item.domain === '${key}'`)) fail(`${where} routes.ts attentionPath 还有本域特判`);
  }
  // 旧路径
  const moved = block('apps/web/src/lib/routes.ts', 'const MOVED');
  for (const [from] of plugin.legacyPaths ?? []) {
    if (moved.includes(`['${from}', `)) fail(`${where} routes.ts MOVED 还手写着 ${from}`);
  }
  // 通知 module：别名表与 manifest 一一对应；web 名字 / 图标不手写
  const notificationAliases = c.PLUGIN_ALIASES[key].notification ?? [];
  const declared = (plugin.notifications ?? []).map((one) => one.key);
  if (JSON.stringify([...declared].sort()) !== JSON.stringify([...notificationAliases].sort())) {
    fail(`${where} manifest.notifications（${declared.join('、') || '—'}）与别名表 notification（${notificationAliases.join('、') || '—'}）不一致`);
  }
  for (const marker of ['const CORE_MODULE_LABEL', 'const CORE_MODULE_ICON']) {
    const text = block('apps/web/src/lib/notification-meta.ts', marker);
    for (const module of declared) if (hasKey(text, module)) fail(`${where} notification-meta.ts ${marker} 还手写着 ${module}`);
  }
  // 写提案：actionType 与别名表一致；agent 里的手写映射不再有本域
  const proposals = c.pluginProposals().filter((one) => one.plugin === key);
  const proposalAliases = c.PLUGIN_ALIASES[key].proposal ?? [];
  if (JSON.stringify(proposals.map((one) => one.actionType).sort()) !== JSON.stringify([...proposalAliases].sort())) {
    fail(`${where} manifest 的提案 actionType 与别名表 proposal 不一致`);
  }
  const proposalService = read('apps/api/src/agent/agent-proposals.service.ts') + read('apps/api/src/agent/agent-proposal-groups.service.ts');
  for (const proposal of proposals) {
    if (proposalService.includes(`${proposal.tool}: '`) || proposalService.includes(`Exclude<AgentActionType, '${proposal.actionType}'>`)) {
      fail(`${where} agent 提案服务里还写死着 ${proposal.tool} / ${proposal.actionType}`);
    }
  }

  // 能力：名字必须在 Capability 清单里，授予关系不再手写
  const capabilities = read('apps/api/src/auth/capabilities.ts');
  const capabilityUnion = capabilities.match(/export type Capability =([^;]*);/)?.[1] ?? '';
  if (!capabilityUnion) fail('capabilities.ts 找不到 Capability 清单');
  const handwrittenRoles = block('apps/api/src/auth/capabilities.ts', 'const CORE_ROLE_CAPABILITIES');
  for (const capability of plugin.capabilities ?? []) {
    if (!capabilityUnion.includes(`'${capability.key}'`)) fail(`${where} 能力 ${capability.key} 不在 Capability 清单里`);
    if (handwrittenRoles.includes(`'${capability.key}'`)) fail(`${where} 能力 ${capability.key} 还在内核 CORE_ROLE_CAPABILITIES 里授予`);
  }
  for (const action of plugin.actions ?? []) {
    if (action.capability && !capabilityUnion.includes(`'${action.capability}'`)) fail(`${where} 动作 ${action.id} 的能力 ${action.capability} 不存在`);
  }
  // 留意种类的 capability 有消费者（today-attention.service.ts 按它判门槛，J1.7），名字必须存在
  for (const kind of plugin.attention?.kinds ?? []) {
    if (kind.capability && !capabilityUnion.includes(`'${kind.capability}'`)) fail(`${where} 留意 ${kind.kind} 的能力 ${kind.capability} 不在 Capability 清单里`);
  }

  // ---- 6. 页面文件里的登记（J1 不改页面，只断言一致）：家庭设置行 ------------------------------------------

  const settings = read('apps/web/src/pages/settings.tsx');
  for (const row of plugin.settingsRows ?? []) {
    if (!settings.includes(`to="${row.path}"`) || !settings.includes(row.title) || !settings.includes(row.hint)) {
      fail(`${where} 设置行「${row.title}」与 settings.tsx 不一致`);
    }
  }
  const paths = plugin.nav.map((segment) => segment.path);
  for (const [, to] of settings.matchAll(/to="([^"]+)"/g)) {
    const mine = paths.some((path) => to === path || to.startsWith(`${path}/`) || to.startsWith(`${path}?`));
    if (mine && !(plugin.settingsRows ?? []).some((row) => row.path === to)) fail(`${where} settings.tsx 有本域的设置行 ${to}，manifest 没写`);
  }
}

if (errors.length) {
  console.error(`插件 manifest 与登记不一致（${errors.length} 处）：`);
  for (const message of errors) console.error(`  - ${message}`);
  process.exit(1);
}
console.log(
  `插件登记一致：${PLUGINS.length} / ${c.PLUGIN_KEYS.length} 个插件都有 manifest；agent 工具 ${tools.length} 个全部有归属（插件 ${owners.size - c.KERNEL_AGENT_TOOLS.length}、内核 ${c.KERNEL_AGENT_TOOLS.length}）；` +
    `仍手写并断言一致的 ${KNOWN_HANDWRITTEN.length} 处（${KNOWN_HANDWRITTEN.map((one) => one.no).join('')}），内核表 ${CORE_TABLES.length} 张`,
);
