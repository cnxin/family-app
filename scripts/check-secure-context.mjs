#!/usr/bin/env node
// 不安全上下文守门（教训 49）：家里人用局域网 IP（http://192.168.x.x）打开小管家时，浏览器不给
// crypto.randomUUID、navigator.clipboard 这类「只在安全上下文可用」的 API。浏览器端源码只许经过封装调用：
// 生成 id 用 apps/web/src/lib/ids.ts 的 newId()，复制用 apps/web/src/lib/clipboard.ts 的 copyText()。
// 扫 apps/web/src 和 packages/*/src（客户端会吃的包），注释行不算，测试文件不算。发现直接调用就退出码 1。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WRAPPERS = new Set(['apps/web/src/lib/ids.ts', 'apps/web/src/lib/clipboard.ts']);
const FORBIDDEN = [
  { pattern: /\bcrypto\.randomUUID\b/, use: 'newId()（apps/web/src/lib/ids.ts）' },
  { pattern: /\bnavigator\.clipboard\b/, use: 'copyText()（apps/web/src/lib/clipboard.ts）' },
  // C2 试用期家里人走局域网 HTTP（docs/deploy-c2.md §0.1）：下面这些在 HTTP 下要么没有、要么直接拒绝。
  // 现在一处都没用；真要用，先在 lib 里写一个带降级的封装，再把封装加进 WRAPPERS。
  { pattern: /\bcrypto\.subtle\b/, use: '带降级的封装（先在 lib 里写一个；HTTP 下 crypto.subtle 是 undefined）' },
  { pattern: /\bnavigator\.(mediaDevices|serviceWorker|geolocation|share|wakeLock|credentials)\b/, use: '带降级的封装（先在 lib 里写一个；HTTP 下不可用）' },
  { pattern: /\bNotification\.requestPermission\b/, use: '带降级的封装（先在 lib 里写一个；HTTP 下浏览器直接拒绝）' },
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.|\/__tests__\//.test(path)) yield path;
  }
}

const roots = [join(ROOT, 'apps/web/src'), ...readdirSync(join(ROOT, 'packages')).map((name) => join(ROOT, 'packages', name, 'src'))];
const problems = [];
for (const root of roots) {
  try {
    statSync(root);
  } catch {
    continue;
  }
  for (const path of files(root)) {
    const file = relative(ROOT, path);
    if (WRAPPERS.has(file)) continue;
    readFileSync(path, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        const code = line.trim();
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
        for (const rule of FORBIDDEN) {
          if (rule.pattern.test(line)) problems.push(`${file}:${index + 1}  ${code}\n    → 改用 ${rule.use}`);
        }
      });
  }
}
if (problems.length) {
  console.error('✗ 浏览器端源码直接调了只在安全上下文可用的 API（局域网 IP 访问时会炸，见 refactor-plan 教训 49）：\n');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('安全上下文守门：浏览器端没有直接调只在 HTTPS 下可用的 API（randomUUID、clipboard、subtle、mediaDevices 等）。');
