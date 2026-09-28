#!/usr/bin/env node
// H2a：写端点都要登记「会推哪些域」。遍历 docs/api-inventory.md 里的写端点（POST / PUT / PATCH /
// DELETE），每条必须在 packages/contracts 的 EVENT_ROUTES 或 EVENT_ROUTE_EXEMPT 里；映射表里
// 对不上任何写端点的条目也算错（死条目）。缺一条就退出码 1，CI 静态检查会红。
// 依赖已构建的 packages/contracts（corepack pnpm build:packages；install 的 postinstall 会构建）。

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'packages/contracts/package.json'));
const { EVENT_ROUTES, EVENT_ROUTE_EXEMPT, eventRouteFor } = require('./dist/index.js');

const inventory = readFileSync(join(ROOT, 'docs/api-inventory.md'), 'utf8');
const writes = [...inventory.matchAll(/^\| (POST|PUT|PATCH|DELETE) \| `([^`]+)` \|/gm)].map(
  ([, method, path]) => ({ method, path }),
);
if (writes.length === 0) {
  console.error('docs/api-inventory.md 里没读到写端点，表格格式变了？');
  process.exit(1);
}

const missing = writes.filter(({ path }) => eventRouteFor(path) === null);
const segments = (path) => path.split('/').filter(Boolean);
const covers = (prefix, path) => {
  const want = segments(prefix);
  const have = segments(path);
  return want.length <= have.length && want.every((segment, index) => segment === have[index]);
};
const dead = [...EVENT_ROUTES, ...EVENT_ROUTE_EXEMPT]
  .map((entry) => entry.prefix)
  .filter((prefix) => !writes.some(({ path }) => covers(prefix, path)));

for (const { method, path } of missing) console.error(`✗ 没登记事件域：${method} ${path}`);
for (const prefix of dead) console.error(`✗ 映射表里的死条目（没有写端点落在它下面）：${prefix}`);
if (missing.length || dead.length) {
  console.error('\n在 packages/contracts/src/events.ts 的 EVENT_ROUTES 或 EVENT_ROUTE_EXEMPT 里补齐或删掉。');
  process.exit(1);
}
const exempt = writes.filter(({ path }) => 'exempt' in (eventRouteFor(path) ?? {})).length;
const explicit = writes.filter(({ path }) => eventRouteFor(path)?.emit === 'explicit').length;
console.log(
  `写端点 ${writes.length} 个全部登记：拦截器发 ${writes.length - exempt - explicit}，业务服务显式发 ${explicit}，豁免 ${exempt}。`,
);
