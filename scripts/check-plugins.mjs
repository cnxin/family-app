#!/usr/bin/env node
// J1：插件 manifest 与各处登记一致（docs/architecture.md §8.1 的 14 处）。
//
// J1.7 起全量：18 个插件都有 manifest，各处登记里插件的条目全部由 manifest 导出；
// 还手写的只有下面 KNOWN_HANDWRITTEN 列的几处（只做一致性断言），以及内核 / 助理层的 CORE_* 表（不许出现插件 key 或别名）。
// 其余任何手写的插件条目都报错。web 端登记的运行时结果另由 apps/web/src/lib/plugins-registry.test.ts 断言。
// 依赖已构建的 packages/contracts（corepack pnpm build:packages；install 的 postinstall 会构建）。

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'packages/contracts/package.json'));
const c = require('./dist/index.js');

const errors = [];
const fail = (message) => errors.push(message);
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 从 marker 所在行起，取到与它同缩进的第一个 `]` / `}`（可带 `;` `,` `)` 或 `（as const）satisfies …;`）为止的一段。 */
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
  const end = lines.findIndex((line, index) => index > 0 && new RegExp(`^${indent}[\\]}]([;,)]*|( as const)? satisfies .*;)$`).test(line));
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
  { table: 'export const CORE_ASSISTANT_TOOLS', line: "get_today_summary: { label: '今日摘要', sourceModule: 'calendar', kind: 'read' },", reason: '跨域内核工具，调用记录历来记在 calendar 名下（数据库里的值，J1b 不改）' },
  { table: 'export const CORE_ASSISTANT_TOOLS', line: "get_family_schedule: { label: '家庭日程', sourceModule: 'calendar', kind: 'read' },", reason: '同上' },
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
  // J1b：dependsOn / hooks 的形状（与代码是否一致见 1d）
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
// J4.1 起名单由 manifest 推导（contracts/plugins/agent-tools.ts），⑧ 不再手写；这里另算一遍「工具集合 == manifest 推导」，
// 并核对 apps/api/src/agent/tools/ 里实现的工具与它一一对应。

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
  for (const query of plugin.queries ?? []) claim(c.queryToolName(query), plugin.key);
  for (const proposal of c.proposalsOf(plugin)) claim(c.proposalToolName(proposal), plugin.key);
}
{
  // 工具集合 == manifest 推导：查询 → 读工具，写提案 → 提案工具，内核工具按 core-assistant.ts 的 kind 归组
  const kernelOf = (kind) => c.KERNEL_AGENT_TOOLS.filter((tool) => c.CORE_ASSISTANT_TOOLS[tool].kind === kind);
  const derived = {
    读: [...kernelOf('read'), ...PLUGINS.flatMap((plugin) => (plugin.queries ?? []).map((query) => c.queryToolName(query)))],
    提案: [...c.proposalsOf ? PLUGINS.flatMap((plugin) => c.proposalsOf(plugin).map((proposal) => c.proposalToolName(proposal))) : [], ...kernelOf('propose')],
    记忆: kernelOf('preference'),
  };
  const listed = { 读: c.AGENT_READ_TOOLS, 提案: c.AGENT_PROPOSAL_TOOLS, 记忆: c.AGENT_MEMORY_TOOLS };
  const sorted = (values) => JSON.stringify([...values].sort());
  for (const group of Object.keys(derived)) {
    if (sorted(listed[group]) !== sorted(derived[group])) {
      fail(`agent ${group}工具名单（${listed[group].join('、')}）不等于 manifest 推导（${derived[group].join('、')}）`);
    }
  }
  const aliases = Object.entries(c.agentToolAliases()).flatMap(([tool, names]) => names.map((alias) => [alias, tool]));
  for (const [alias, tool] of aliases) {
    if (tools.includes(alias)) fail(`工具 ${tool} 的旧名 ${alias} 和现有工具重名`);
  }
  if (new Set(aliases.map(([alias]) => alias)).size !== aliases.length) fail('agent 工具的旧名有重复');
  // apps/api 的实现：每个工具一处 defineTool({ name, …, kind })，与名单一一对应；读 / 记忆工具 kind 为 read，提案工具为 propose
  const toolDir = 'apps/api/src/agent/tools';
  const implemented = new Map();
  for (const file of readdirSync(join(ROOT, toolDir)).filter((one) => one.endsWith('.ts'))) {
    for (const [, name, kind] of read(`${toolDir}/${file}`).matchAll(/defineTool\(\{\s*name: '([\w-]+)',[\s\S]*?\n\s+kind: '(read|propose)',/g)) {
      if (implemented.has(name)) fail(`${toolDir}/${file}：工具 ${name} 实现了两次`);
      implemented.set(name, kind);
    }
  }
  const expectedKind = (tool) => (c.AGENT_PROPOSAL_TOOLS.includes(tool) ? 'propose' : 'read');
  for (const tool of tools) {
    if (!implemented.has(tool)) fail(`agent 工具 ${tool} 在 ${toolDir}/ 里没有实现`);
    else if (implemented.get(tool) !== expectedKind(tool)) fail(`agent 工具 ${tool} 的 kind 应为 ${expectedKind(tool)}`);
  }
  for (const tool of implemented.keys()) if (!tools.includes(tool)) fail(`${toolDir}/ 实现了名单外的工具 ${tool}（先登记进 manifest 或 core-assistant.ts）`);
  // MCP 只按注册表注册、propose_plan 的步骤联合由 manifest 推导：两处都不许再手写工具名或 z.literal
  const mcp = read('apps/api/src/agent/agent-mcp.controller.ts');
  if (/registerTool\(\s*'/.test(mcp) || /\bregister\(\s*'/.test(mcp)) fail('agent-mcp.controller.ts 又手写注册了工具：按注册表注册');
  if (/z\.literal\(\s*'/.test(read(`${toolDir}/kernel.ts`))) fail(`${toolDir}/kernel.ts 手写了 propose_plan 的步骤类型：由 manifest 推导`);
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

// ---- 1d. J1b：插件之间只经内核的门面 / 事务内钩子（docs/architecture.md §9） ---------------------------------
// 插件目录之间零 import（contracts、shared 不算插件目录）；dependsOn == 实际取用的门面、hooks == 实际订阅的钩子
// （多声明、少声明都报错）；门面接口只在 contracts 定义、实现只在提供方目录注册；钩子名 / 插件事件名只在 contracts 定义。

const j1b = { facades: 0, hooks: 0, events: 0, agentFacades: 0 };
{
  const SRC = 'apps/api/src';
  /** 不叫插件 key 的插件目录。 */
  const PLUGIN_EXTRA_DIRS = { dishes: 'recipes' };
  /** 内核目录：不属于任何插件（内核 → 插件的 import 不在 J1b 范围，见 §9「没解的」）。新目录必须归到这里或插件。 */
  const KERNEL_DIRS = ['activities', 'agent', 'assistant', 'auth', 'common', 'database', 'entities', 'events', 'households', 'notifications', 'system', 'today', 'upload'];
  const ownerOfDir = (dir) => (c.PLUGIN_KEYS.includes(dir) ? dir : PLUGIN_EXTRA_DIRS[dir] ?? null);
  const walk = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(`${dir}/${entry.name}`) : entry.name.endsWith('.ts') ? [`${dir}/${entry.name}`] : []);
  const filesOf = new Map(c.PLUGIN_KEYS.map((key) => [key, []]));
  const apiFiles = [];
  for (const entry of readdirSync(join(ROOT, SRC), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const owner = ownerOfDir(entry.name);
    if (!owner && !KERNEL_DIRS.includes(entry.name)) {
      fail(`apps/api/src/${entry.name}/ 既不是插件目录也不是登记过的内核目录：在 check-plugins 的 PLUGIN_EXTRA_DIRS 或 KERNEL_DIRS 里归类`);
    }
    for (const file of walk(`${SRC}/${entry.name}`)) {
      const item = { file, text: read(file), owner };
      apiFiles.push(item);
      if (owner) filesOf.get(owner).push(item);
    }
  }
  /** 注入的字段名：private readonly <字段>: <类型> */
  const fieldsOf = (text, type) => [...text.matchAll(new RegExp(`private readonly (\\w+): ${type}\\b`, 'g'))].map((match) => match[1]);
  const calls = (text, type, method) => fieldsOf(text, type).flatMap((field) =>
    [...text.matchAll(new RegExp(`this\\.${field}\\s*\\.${method}\\(\\s*'([\\w.-]+)'(?:,\\s*'([\\w-]+)')?`, 'g'))].map((match) => ({ name: match[1], owner: match[2] })));

  // 插件目录之间零 import；J4.1 起 agent 目录（内核）同样零 import 插件目录，只走门面（§9.5）
  const AGENT_DIR = `${SRC}/agent/`;
  for (const { file, text, owner } of apiFiles) {
    const agent = file.startsWith(AGENT_DIR);
    if (!owner && !agent) continue;
    for (const [, spec] of text.matchAll(/(?:\bfrom\s+|\bimport\(\s*|\brequire\(\s*)'(\.{1,2}\/[^']+)'/g)) {
      const target = relative(join(ROOT, SRC), resolve(dirname(join(ROOT, file)), spec)).split(sep)[0];
      const targetOwner = ownerOfDir(target);
      if (agent && targetOwner) fail(`${file} import 了插件 ${targetOwner} 的 ${spec}：agent 只经门面读写插件数据（§9.5）`);
      else if (targetOwner && targetOwner !== owner) fail(`${file} import 了插件 ${targetOwner} 的 ${spec}：插件之间只走门面 / 事务内钩子（§9）`);
    }
  }

  // 门面：接口只在 contracts（plugins/<key>.facade.ts，登记进 PluginFacades），实现只在提供方目录注册一次
  const kernelTypes = 'packages/contracts/src/plugins/kernel.ts';
  const facadeKeys = readdirSync(join(ROOT, 'packages/contracts/src/plugins'))
    .filter((name) => name.endsWith('.facade.ts')).map((name) => name.replace(/\.facade\.ts$/, ''));
  const facadeMap = block(kernelTypes, 'export interface PluginFacades');
  const facadeEntries = [...facadeMap.matchAll(/^\s+'?([\w-]+)'?: (\w+);$/gm)].map((match) => match[1]);
  for (const key of facadeKeys) {
    if (!c.PLUGIN_KEYS.includes(key)) fail(`contracts/plugins/${key}.facade.ts：${key} 不是插件 key`);
    if (!facadeEntries.includes(key)) fail(`门面 ${key} 没有登记进 kernel.ts 的 PluginFacades`);
  }
  for (const key of facadeEntries) if (!facadeKeys.includes(key)) fail(`PluginFacades 里的 ${key} 没有对应的 contracts/plugins/${key}.facade.ts`);
  const registered = new Map();
  for (const { file, text, owner } of apiFiles) {
    if (/\binterface \w+Facade\b/.test(text)) fail(`${file} 定义了门面接口：门面接口只在 contracts/plugins/<key>.facade.ts`);
    for (const [, key] of text.matchAll(/\.register\(\s*'([\w-]+)',\s*\w+Facade\(/g)) {
      if (owner !== key) fail(`${file} 注册了 ${key} 的门面：实现只在提供方目录 apps/api/src/${key}/`);
      registered.set(key, (registered.get(key) ?? 0) + 1);
    }
  }
  for (const key of facadeKeys) if (registered.get(key) !== 1) fail(`门面 ${key} 注册了 ${registered.get(key) ?? 0} 次（应为在 apps/api/src/${key}/ 里注册 1 次）`);

  // dependsOn == 实际取用的门面
  for (const plugin of PLUGINS) {
    const used = new Set(filesOf.get(plugin.key).flatMap(({ text }) => calls(text, 'PluginFacadeRegistry', 'get').map((call) => call.name)));
    for (const key of used) {
      if (!facadeKeys.includes(key)) fail(`${plugin.key} 取用了不存在的门面 ${key}`);
      if (key === plugin.key) fail(`${plugin.key} 取用了自己的门面`);
    }
    const declared = new Set(plugin.dependsOn ?? []);
    for (const key of used) if (!declared.has(key) && key !== plugin.key) fail(`${plugin.key} 取用了 ${key} 的门面，manifest 的 dependsOn 没声明`);
    for (const key of declared) if (!used.has(key)) fail(`${plugin.key} 的 dependsOn 声明了 ${key}，代码里没有取用它的门面`);
  }

  // agent 目录取用的门面 == core-assistant.ts 的 ASSISTANT_DEPENDS_ON（agent 没有 manifest，用它代替 dependsOn）
  {
    const used = new Set(apiFiles.filter(({ file }) => file.startsWith(AGENT_DIR))
      .flatMap(({ text }) => [...text.matchAll(/\bfacades\s*\.\s*get\(\s*'([\w-]+)'/g)].map((match) => match[1])));
    const declared = new Set(c.ASSISTANT_DEPENDS_ON);
    for (const key of used) {
      if (!facadeKeys.includes(key)) fail(`agent 取用了不存在的门面 ${key}`);
      else if (!declared.has(key)) fail(`agent 取用了 ${key} 的门面，core-assistant.ts 的 ASSISTANT_DEPENDS_ON 没声明`);
    }
    for (const key of declared) if (!used.has(key)) fail(`ASSISTANT_DEPENDS_ON 声明了 ${key}，agent 目录里没有取用它的门面`);
    j1b.agentFacades = used.size;
  }

  // 事务内钩子：名单与 payload 只在 contracts；订阅方 == manifest.hooks；发起方 == 钩子名前缀的插件；写死的顺序只列订阅方
  const hookNames = [...c.TRANSACTION_HOOK_NAMES];
  const hookPayloads = [...block(kernelTypes, 'export interface TransactionHookPayloads').matchAll(/^\s+'([\w.-]+)': (\w+);$/gm)];
  const eventPayloadEntries = [...block(kernelTypes, 'export interface PluginEventPayloads').matchAll(/^\s+'([\w.-]+)': (\w+);$/gm)];
  const payloadNames = hookPayloads.map((match) => match[1]);
  const payloadTypes = [...hookPayloads, ...eventPayloadEntries].map((match) => match[2]);
  if (JSON.stringify([...payloadNames].sort()) !== JSON.stringify([...hookNames].sort())) {
    fail(`kernel.ts 的 TransactionHookPayloads（${payloadNames.join('、')}）与 TRANSACTION_HOOK_NAMES（${hookNames.join('、')}）不一致`);
  }
  for (const name of hookNames) {
    if (!c.PLUGIN_KEYS.includes(name.split('.')[0])) fail(`钩子 ${name} 不是「<发起方插件 key>.<事件>」`);
  }
  const ran = new Set();
  const subscribersOf = new Map(hookNames.map((name) => [name, new Set()]));
  for (const { file, text, owner } of apiFiles) {
    const redefined = payloadTypes.find((type) => new RegExp(`\\b(?:(?:interface|class) ${type}\\b|type ${type}\\s*=)`).test(text));
    if (/\b(?:TRANSACTION_HOOK_NAMES|PLUGIN_EVENT_NAMES|TRANSACTION_HOOK_ORDER)\s*[:=]/.test(text) || redefined) {
      fail(`${file} 定义了钩子 / 插件事件的名单或 payload${redefined ? `（${redefined}）` : ''}：只在 contracts 定义`);
    }
    for (const { name } of calls(text, 'TransactionHookRegistry', 'run')) {
      if (!hookNames.includes(name)) fail(`${file} 发起了 contracts 里没有的钩子 ${name}`);
      else if (owner !== name.split('.')[0]) fail(`${file} 发起了钩子 ${name}：只有 ${name.split('.')[0]} 插件能发起`);
      ran.add(name);
    }
    for (const { name, owner: subscriber } of calls(text, 'TransactionHookRegistry', 'on')) {
      if (!hookNames.includes(name)) fail(`${file} 订阅了 contracts 里没有的钩子 ${name}`);
      else if (!owner || subscriber !== owner) fail(`${file} 以 ${subscriber} 的名义订阅 ${name}：只能以所在插件（${owner ?? '内核'}）的名义`);
      else subscribersOf.get(name).add(owner);
    }
  }
  for (const name of hookNames) {
    if (!ran.has(name)) fail(`钩子 ${name} 没有发起方（${name.split('.')[0]} 插件里没有 hooks.run）`);
    if (!subscribersOf.get(name).size) fail(`钩子 ${name} 没有订阅方`);
  }
  for (const plugin of PLUGINS) {
    const subscribed = new Set(hookNames.filter((name) => subscribersOf.get(name).has(plugin.key)));
    const declared = new Set(plugin.hooks ?? []);
    for (const name of subscribed) if (!declared.has(name)) fail(`${plugin.key} 订阅了钩子 ${name}，manifest 的 hooks 没声明`);
    for (const name of declared) if (!subscribed.has(name)) fail(`${plugin.key} 的 hooks 声明了 ${name}，代码里没有订阅`);
  }
  for (const [name, order] of Object.entries(c.TRANSACTION_HOOK_ORDER)) {
    for (const key of order) if (!subscribersOf.get(name)?.has(key)) fail(`TRANSACTION_HOOK_ORDER.${name} 里的 ${key} 不是它的订阅方`);
  }

  j1b.facades = facadeKeys.length;
  j1b.hooks = hookNames.length;

  // 内核事件总线上的插件事件：名字只在 contracts；只有前缀插件能发
  const eventNames = [...c.PLUGIN_EVENT_NAMES];
  j1b.events = eventNames.length;
  const eventPayloads = eventPayloadEntries.map((match) => match[1]);
  if (JSON.stringify([...eventPayloads].sort()) !== JSON.stringify([...eventNames].sort())) fail('kernel.ts 的 PluginEventPayloads 与 PLUGIN_EVENT_NAMES 不一致');
  for (const { file, text, owner } of apiFiles) {
    for (const { name } of calls(text, 'EventBus', 'emit')) {
      if (!eventNames.includes(name)) fail(`${file} 发了 contracts 里没有的插件事件 ${name}`);
      else if (owner !== name.split('.')[0]) fail(`${file} 发了插件事件 ${name}：只有 ${name.split('.')[0]} 插件能发`);
    }
    for (const { name } of calls(text, 'EventBus', 'on')) if (!eventNames.includes(name)) fail(`${file} 订阅了 contracts 里没有的插件事件 ${name}`);
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
    `仍手写并断言一致的 ${KNOWN_HANDWRITTEN.length} 处（${KNOWN_HANDWRITTEN.map((one) => one.no).join('')}），内核表 ${CORE_TABLES.length} 张；` +
    `插件目录之间零 import，门面 ${j1b.facades} 个、事务内钩子 ${j1b.hooks} 个、插件事件 ${j1b.events} 个与 manifest 一致；` +
    `agent 工具集合 == manifest 推导（读 ${c.AGENT_READ_TOOLS.length}、提案 ${c.AGENT_PROPOSAL_TOOLS.length}、记忆 ${c.AGENT_MEMORY_TOOLS.length}，apps/api 实现一一对应）；` +
    `agent 目录零 import 插件目录，经门面 ${j1b.agentFacades} 个（== ASSISTANT_DEPENDS_ON）`,
);
