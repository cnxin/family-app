#!/usr/bin/env node
// 从 apps/api/src 的 Controller 源码提取 HTTP 端点清单，输出 docs/api-inventory.md。
// 零依赖，纯正则扫描；用于重构期间对照"哪些端点已迁移"。
//
//   node scripts/api-inventory.mjs          # 重新生成 docs/api-inventory.md
//   node scripts/api-inventory.mjs --check  # 仅校验文件是否过期（CI 用），过期时退出码 1

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'apps', 'api', 'src');
const OUTPUT = join(ROOT, 'docs', 'api-inventory.md');
const METHODS = ['Get', 'Post', 'Put', 'Patch', 'Delete'];

// 已定义契约的端点集合（需要先构建 packages/contracts；未构建时视为无契约并给出提示）
function loadContractKeys() {
  try {
    const require = createRequire(import.meta.url);
    const { contractIndex } = require(join(ROOT, 'packages', 'contracts', 'dist', 'index.js'));
    return new Set(contractIndex.keys());
  } catch {
    console.error(
      '提示：packages/contracts 尚未构建（corepack pnpm build:packages），契约列将全部显示为空。',
    );
    return new Set();
  }
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'migrations') walk(full, files);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files.sort();
}

function stringArg(text) {
  const match = text.match(/^\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)?\s*$/);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? '';
}

function joinPath(prefix, path) {
  const parts = [prefix, path]
    .map((part) => (part ?? '').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);
  return `/${parts.join('/')}`;
}

function extractControllers(source) {
  const controllers = [];
  // @Controller 与 class 之间允许出现其他类级装饰器（@Public()、@RequireCapabilities(...)）
  const pattern =
    /@Controller\(([^)]*)\)((?:\s*@\w+\([^)]*\))*)\s*(?:export\s+)?class\s+(\w+)/g;
  let match;
  while ((match = pattern.exec(source))) {
    controllers.push({
      prefix: stringArg(match[1]) ?? '',
      classDecorators: match[2] ?? '',
      name: match[3],
      start: match.index,
    });
  }
  for (let index = 0; index < controllers.length; index += 1) {
    const current = controllers[index];
    const next = controllers[index + 1];
    const tail = source.slice(current.start + 1);
    const boundary = tail.search(/@(Injectable|Module)\(/);
    const boundaryEnd = boundary >= 0 ? current.start + 1 + boundary : source.length;
    current.end = Math.min(next ? next.start : source.length, boundaryEnd);
    current.body = source.slice(current.start, current.end);
  }
  return controllers;
}

function extractRoutes(controller, file) {
  const routes = [];
  const routePattern = new RegExp(
    `@(${METHODS.join('|')})\\(([^)]*)\\)`,
    'g',
  );
  let match;
  while ((match = routePattern.exec(controller.body))) {
    const method = match[1].toUpperCase();
    const path = stringArg(match[2]) ?? '';
    const after = controller.body.slice(match.index + match[0].length);
    const handlerMatch = after.match(/^[\s\S]*?\n\s*(?:async\s+)?(\w+)\s*\(/);
    const before = controller.body.slice(0, match.index);
    const previousRouteEnd = Math.max(
      ...METHODS.map((name) => before.lastIndexOf(`@${name}(`)),
      before.lastIndexOf('\n  }\n'),
      0,
    );
    // 装饰器可能写在路由装饰器之前或之后（如 @Post(...) 下面再 @RequireCapabilities(...)），
    // 所以窗口 = 上一个方法结束之后 ~ 本方法签名之前
    const afterDecorators = handlerMatch
      ? after.slice(0, handlerMatch[0].length)
      : '';
    const decoratorWindow = before.slice(previousRouteEnd) + afterDecorators;
    const capabilities = [
      ...decoratorWindow.matchAll(/@RequireCapabilities\(([^)]*)\)/g),
    ].flatMap((item) =>
      item[1]
        .split(',')
        .map((token) => token.trim().replace(/^['"`]|['"`]$/g, ''))
        .filter(Boolean),
    );
    const classCapabilities = [
      ...controller.classDecorators.matchAll(/@RequireCapabilities\(([^)]*)\)/g),
    ].flatMap((item) =>
      item[1]
        .split(',')
        .map((token) => token.trim().replace(/^['"`]|['"`]$/g, ''))
        .filter(Boolean),
    );
    routes.push({
      method,
      path: joinPath(controller.prefix, path),
      handler: handlerMatch ? handlerMatch[1] : '?',
      controller: controller.name,
      file: relative(ROOT, file).replaceAll('\\', '/'),
      module: relative(SRC, file).split(/[\\/]/)[0],
      isPublic:
        /@Public\(\)/.test(decoratorWindow) ||
        /@Public\(\)/.test(controller.classDecorators),
      capabilities: [...new Set([...classCapabilities, ...capabilities])],
    });
  }
  return routes;
}

function collect() {
  const routes = [];
  for (const file of walk(SRC)) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('@Controller(')) continue;
    for (const controller of extractControllers(source)) {
      routes.push(...extractRoutes(controller, file));
    }
  }
  const order = { GET: 0, POST: 1, PUT: 2, PATCH: 3, DELETE: 4 };
  return routes.sort(
    (a, b) =>
      a.module.localeCompare(b.module) ||
      a.path.localeCompare(b.path) ||
      order[a.method] - order[b.method],
  );
}

function render(routes, contractKeys) {
  const byModule = new Map();
  for (const route of routes) {
    if (!byModule.has(route.module)) byModule.set(route.module, []);
    byModule.get(route.module).push(route);
  }
  const methodCounts = {};
  for (const route of routes) {
    methodCounts[route.method] = (methodCounts[route.method] ?? 0) + 1;
  }
  const lines = [];
  lines.push('# API 端点清单');
  lines.push('');
  lines.push(
    '> 由 `node scripts/api-inventory.mjs` 从 `apps/api/src` 的 Controller 自动生成，请勿手改。',
  );
  lines.push(
    '> 用途：重构迁移时逐条对照；`--check` 模式在 CI 里保证清单与代码一致。',
  );
  lines.push(
    '> 权限列只反映装饰器（`@Public` / `@RequireCapabilities`）；标"登录"的端点仍可能在 Service 内部用 `assertCapability` 或角色判断做二次校验。',
  );
  lines.push('');
  lines.push(
    `共 ${routes.length} 个端点（${Object.entries(methodCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([method, count]) => `${method} ${count}`)
      .join(' / ')}），公开端点 ${routes.filter((r) => r.isPublic).length} 个，已定义契约 ${
      routes.filter((r) => contractKeys.has(`${r.method} ${r.path}`)).length
    } 个。`,
  );
  lines.push('');
  lines.push('| 模块 | 端点数 | 已有契约 |');
  lines.push('| --- | ---: | ---: |');
  for (const [module, list] of byModule) {
    const covered = list.filter((r) =>
      contractKeys.has(`${r.method} ${r.path}`),
    ).length;
    lines.push(`| ${module} | ${list.length} | ${covered} |`);
  }
  lines.push('');
  for (const [module, list] of byModule) {
    lines.push(`## ${module}（${list.length}）`);
    lines.push('');
    lines.push('| 方法 | 路径 | 处理函数 | 权限 | 契约 | 文件 |');
    lines.push('| --- | --- | --- | --- | :-: | --- |');
    for (const route of list) {
      const auth = route.isPublic
        ? '公开'
        : route.capabilities.length
          ? route.capabilities.map((c) => `\`${c}\``).join(' ')
          : '登录';
      const contracted = contractKeys.has(`${route.method} ${route.path}`) ? '✓' : '';
      lines.push(
        `| ${route.method} | \`${route.path}\` | \`${route.controller}.${route.handler}\` | ${auth} | ${contracted} | \`${route.file}\` |`,
      );
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

const routes = collect();
const markdown = render(routes, loadContractKeys());
if (process.argv.includes('--check')) {
  let existing = '';
  try {
    existing = readFileSync(OUTPUT, 'utf8');
  } catch {
    // 文件不存在视为过期
  }
  if (existing !== markdown) {
    console.error(
      `docs/api-inventory.md 已过期，请运行 node scripts/api-inventory.mjs 重新生成（当前 ${routes.length} 个端点）。`,
    );
    process.exit(1);
  }
  console.log(`docs/api-inventory.md 与代码一致（${routes.length} 个端点）。`);
} else {
  writeFileSync(OUTPUT, markdown);
  console.log(`已写入 ${relative(ROOT, OUTPUT)}（${routes.length} 个端点）。`);
}
