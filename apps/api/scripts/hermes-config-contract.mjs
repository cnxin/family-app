import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, '..');
const repoRoot = resolve(apiRoot, '../..');
const agentTypesPath = resolve(apiRoot, 'src/agent/agent.types.ts');
const configPaths = [
  resolve(repoRoot, 'deploy/hermes/config.yaml'),
  resolve(repoRoot, 'deploy/hermes/config.local.yaml'),
];

function parseToolConstant(source, constantName) {
  const prefix = `export const ${constantName} = [`;
  const start = source.indexOf(prefix);
  if (start < 0) throw new Error(`找不到 ${constantName}`);
  const end = source.indexOf('] as const;', start + prefix.length);
  if (end < 0) throw new Error(`${constantName} 缺少 as const 结尾`);
  return [...source.slice(start + prefix.length, end).matchAll(/^\s+'([a-z0-9_]+)',\s*$/gm)]
    .map((match) => match[1]);
}

function parseHermesInclude(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const includeIndex = lines.findIndex((line) => line === '      include:');
  if (includeIndex < 0) throw new Error(`${path} 缺少 tools.include`);
  const tools = [];
  for (const line of lines.slice(includeIndex + 1)) {
    const match = /^ {8}- ([a-z0-9_]+)$/.exec(line);
    if (!match) break;
    tools.push(match[1]);
  }
  if (!tools.length) throw new Error(`${path} 的 tools.include 为空`);
  return tools;
}

function parseYamlScalar(path, keys) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  let blockStart = 0;
  let blockEnd = lines.length;

  for (let depth = 0; depth < keys.length; depth += 1) {
    const indent = depth * 2;
    const prefix = `${' '.repeat(indent)}${keys[depth]}:`;
    const lineIndex = lines.findIndex((line, index) => (
      index >= blockStart
      && index < blockEnd
      && line.startsWith(prefix)
      && line.slice(prefix.length).match(/^(?:\s|$)/)
    ));
    if (lineIndex < 0) throw new Error(`${path} 缺少 ${keys.join('.')}`);

    const value = lines[lineIndex].slice(prefix.length).trim();
    if (depth === keys.length - 1) {
      if (!value) throw new Error(`${path} 的 ${keys.join('.')} 为空`);
      return value.replace(/^(?:"(.*)"|'(.*)')$/, (_, doubleQuoted, singleQuoted) => (
        doubleQuoted ?? singleQuoted
      ));
    }
    if (value) throw new Error(`${path} 的 ${keys.slice(0, depth + 1).join('.')} 必须是映射`);

    blockStart = lineIndex + 1;
    blockEnd = lines.findIndex((line, index) => (
      index >= blockStart
      && line.trim()
      && line.length - line.trimStart().length <= indent
    ));
    if (blockEnd < 0) blockEnd = lines.length;
  }

  throw new Error(`${path} 缺少 ${keys.join('.')}`);
}

function hermesLoader() {
  const sourceRoot = process.env.HERMES_SOURCE_DIR
    || resolve(homedir(), '.hermes/hermes-agent');
  const python = process.env.HERMES_PYTHON
    || resolve(sourceRoot, 'venv/bin/python');
  return existsSync(sourceRoot) && existsSync(python)
    ? { python, sourceRoot }
    : null;
}

function loadWithHermes(path, loader) {
  const profileRoot = mkdtempSync(resolve(tmpdir(), 'family-app-hermes-contract-'));
  copyFileSync(path, resolve(profileRoot, 'config.yaml'));
  try {
    const source = [
      'import json',
      'from gateway.config import load_gateway_config, Platform',
      'from gateway.platforms.api_server import APIServerAdapter',
      'from hermes_cli.config import load_config',
      'config = load_config()',
      'platform = load_gateway_config().platforms[Platform.API_SERVER]',
      'adapter = APIServerAdapter(platform)',
      'print(json.dumps({',
      '  "directModelRequests": adapter._direct_model_requests,',
      '  "modelDefault": (config.get("model") or {}).get("default"),',
      '}))',
    ].join('\n');
    const result = spawnSync(loader.python, ['-c', source], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HERMES_HOME: profileRoot,
        PYTHONPATH: loader.sourceRoot,
      },
    });
    if (result.status !== 0) {
      throw new Error(
        `${path} 无法由 Hermes 加载器验证: ${(result.stderr || result.stdout).trim()}`,
      );
    }
    return JSON.parse(result.stdout.trim());
  } finally {
    rmSync(profileRoot, { force: true, recursive: true });
  }
}

function duplicates(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function difference(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

function sameOrder(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

const agentTypes = readFileSync(agentTypesPath, 'utf8');
const expected = [
  ...parseToolConstant(agentTypes, 'AGENT_READ_TOOLS'),
  ...parseToolConstant(agentTypes, 'AGENT_MEMORY_TOOLS'),
  ...parseToolConstant(agentTypes, 'AGENT_PROPOSAL_TOOLS'),
];
const actualByPath = new Map(configPaths.map((path) => [path, parseHermesInclude(path)]));
const configByPath = new Map(configPaths.map((path) => [path, {
  directModelRequests: parseYamlScalar(path, [
    'gateway',
    'platforms',
    'api_server',
    'extra',
    'direct_model_requests',
  ]),
  modelDefault: parseYamlScalar(path, ['model', 'default']),
}]));
const loader = hermesLoader();
const loadedConfigByPath = loader
  ? new Map(configPaths.map((path) => [path, loadWithHermes(path, loader)]))
  : null;
let failed = false;

for (const [path, actual] of actualByPath) {
  const missing = difference(expected, actual);
  const extra = difference(actual, expected);
  const repeated = duplicates(actual);
  const ordered = sameOrder(actual, expected);
  if (missing.length || extra.length || repeated.length || !ordered) {
    failed = true;
    console.error(`✗ ${path}`);
    if (missing.length) console.error(`  缺失: ${missing.join(', ')}`);
    if (extra.length) console.error(`  冗余: ${extra.join(', ')}`);
    if (repeated.length) console.error(`  重复: ${repeated.join(', ')}`);
    if (!ordered && !missing.length && !extra.length && !repeated.length) {
      console.error('  顺序不一致: 应按读工具、记忆工具、提案工具排列');
    }
  } else {
    console.log(`  ✓ ${path} 与代码常量一致（${actual.length} 个工具）`);
  }

  const config = configByPath.get(path);
  if (config.directModelRequests !== 'true') {
    failed = true;
    console.error(`✗ ${path} 的 gateway.platforms.api_server.extra.direct_model_requests 必须为 true`);
  } else {
    console.log(`  ✓ ${path} 已启用 direct_model_requests`);
  }

  const loadedConfig = loadedConfigByPath?.get(path);
  if (loadedConfig) {
    if (loadedConfig.directModelRequests !== true) {
      failed = true;
      console.error(`✗ ${path} 经 Hermes 加载后 direct_model_requests 未生效`);
    } else if (loadedConfig.modelDefault !== config.modelDefault) {
      failed = true;
      console.error(`✗ ${path} 经 Hermes 加载后的 model.default 不一致`);
      console.error(`  YAML: ${config.modelDefault}`);
      console.error(`  Hermes: ${loadedConfig.modelDefault ?? '<empty>'}`);
    } else {
      console.log(
        `  ✓ ${path} 经 Hermes 加载后 direct_model_requests=true，model.default=${loadedConfig.modelDefault}`,
      );
    }
  }
}

// CI 镜像可能不含 Hermes。此时仍检查能被 Hermes 识别的精确 YAML 层级，
// 但部署前必须设置 HERMES_SOURCE_DIR/HERMES_PYTHON 重跑，或执行进程级验证。
if (!loader) {
  console.log('  ○ 未检测到 Hermes 加载器，跳过实际加载验证；部署前必须在 Hermes 环境重跑');
}

const [firstPath, secondPath] = configPaths;
const first = actualByPath.get(firstPath);
const second = actualByPath.get(secondPath);
if (!sameOrder(first, second)) {
  failed = true;
  console.error('✗ 两份 Hermes tools.include 不一致');
  const onlyFirst = difference(first, second);
  const onlySecond = difference(second, first);
  if (onlyFirst.length) console.error(`  仅 config.yaml: ${onlyFirst.join(', ')}`);
  if (onlySecond.length) console.error(`  仅 config.local.yaml: ${onlySecond.join(', ')}`);
}

const firstModelDefault = configByPath.get(firstPath).modelDefault;
const secondModelDefault = configByPath.get(secondPath).modelDefault;
if (firstModelDefault !== secondModelDefault) {
  failed = true;
  console.error('✗ 两份 Hermes model.default 不一致');
  console.error(`  config.yaml: ${firstModelDefault}`);
  console.error(`  config.local.yaml: ${secondModelDefault}`);
}

if (failed) process.exit(1);
console.log('  ✓ 两份 Hermes tools.include 完全一致');
console.log(`  ✓ 两份 Hermes model.default 完全一致（${firstModelDefault}）`);
