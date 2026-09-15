#!/usr/bin/env node
// 构建 packages/* 里的工作区包（tsc → dist）。
// 作为根 package.json 的 postinstall 使用：不依赖 PATH 上有 pnpm / corepack，
// 在本机、CI 和 Docker 构建阶段（pnpm 全局安装、无 corepack 缓存）都能跑。
//
//   node scripts/build-packages.mjs          # 构建全部
//   node scripts/build-packages.mjs --check  # 只做类型检查（tsc --noEmit）

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = join(ROOT, 'packages');
const checkOnly = process.argv.includes('--check');

// 依赖顺序：shared 不依赖别人，contracts 未来可能依赖 shared
const ORDER = ['shared', 'contracts'];
const present = readdirSync(PACKAGES).filter((name) =>
  existsSync(join(PACKAGES, name, 'tsconfig.json')),
);
const packages = [
  ...ORDER.filter((name) => present.includes(name)),
  ...present.filter((name) => !ORDER.includes(name)),
];

for (const name of packages) {
  const dir = join(PACKAGES, name);
  const require = createRequire(join(dir, 'package.json'));
  let tsc;
  try {
    tsc = require.resolve('typescript/bin/tsc');
  } catch {
    console.error(
      `packages/${name}：找不到 typescript，请先安装依赖（corepack pnpm install）。`,
    );
    process.exit(1);
  }
  const args = [tsc, '-p', 'tsconfig.json', ...(checkOnly ? ['--noEmit'] : [])];
  console.log(`packages/${name}: tsc${checkOnly ? ' --noEmit' : ''}`);
  const result = spawnSync(process.execPath, args, { cwd: dir, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`工作区包${checkOnly ? '类型检查' : '构建'}完成：${packages.join(', ')}`);
