// native 运行时用哪个模型 provider。
// - 测试模式（NODE_ENV=test 且连的是隔离测试库）可用 AGENT_NATIVE_PROVIDER 指定：
//     scripted              剧本 provider（照本地确定性助理的剧本出 tool_call / 正文）
//     replay:<suite.json>   回放套件：按成员原话挑录制（ReplayProvider），挑不到的走 fallback（默认 scripted）
// - 否则用 J4.2 的临时环境变量 AGENT_NATIVE_BASE_URL / AGENT_NATIVE_KEY / AGENT_NATIVE_MODEL（J4.3 换成家庭设置里的配置）。
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
  OpenAICompatibleProvider,
  ReplayProvider,
  type ModelProvider,
  type Recording,
  type ReplayOptions,
} from '@family/agent-core';
import { ScriptedModelProvider } from './scripted-provider';

/** 只有隔离测试库才认测试开关（同 common/clock.ts 的测试时钟）。 */
export function isolatedTestMode() {
  return (
    process.env.NODE_ENV === 'test' &&
    /^family_app_(?:web_)?test_[a-f0-9]+$/.test(process.env.DB_NAME ?? '')
  );
}

export function nativeTestProviderSpec(): string | null {
  const spec = process.env.AGENT_NATIVE_PROVIDER?.trim();
  return spec && isolatedTestMode() ? spec : null;
}

interface ReplayScenario {
  /** 成员原话包含这段就用这条录制。 */
  readonly match: string;
  readonly recording: Recording;
  readonly options: ReplayOptions;
}

interface ReplaySuite {
  readonly scenarios: readonly ReplayScenario[];
  readonly fallback: 'scripted' | 'none';
}

const suites = new Map<string, ReplaySuite>();

function loadSuite(path: string): ReplaySuite {
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
  const cached = suites.get(absolute);
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(absolute, 'utf8')) as {
    scenarios: { match: string; recording: string; chunkSize?: number; latencyMs?: number }[];
    fallback?: 'scripted' | 'none';
  };
  const suite: ReplaySuite = {
    scenarios: raw.scenarios.map((scenario) => ({
      match: scenario.match,
      recording: JSON.parse(readFileSync(resolve(dirname(absolute), scenario.recording), 'utf8')) as Recording,
      options: { chunkSize: scenario.chunkSize, latencyMs: scenario.latencyMs },
    })),
    fallback: raw.fallback ?? 'scripted',
  };
  suites.set(absolute, suite);
  return suite;
}

/** 测试开关选出的 provider；每次 run 新建一个（回放按序号走，不能跨 run 共用）。 */
export function testProviderFor(spec: string, message: string): ModelProvider {
  if (spec === 'scripted') return new ScriptedModelProvider();
  if (!spec.startsWith('replay:')) throw new Error(`AGENT_NATIVE_PROVIDER 不认识：${spec}`);
  const suite = loadSuite(spec.slice('replay:'.length));
  const scenario = suite.scenarios.find((one) => message.includes(one.match));
  if (scenario) return new ReplayProvider(scenario.recording, scenario.options);
  if (suite.fallback === 'scripted') return new ScriptedModelProvider();
  throw new Error(`回放套件里没有匹配「${message.slice(0, 20)}」的录制`);
}

export interface NativeProviderConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly quirks?: string;
}

/** J4.2 临时：从环境变量读 OpenAI 兼容服务的配置（J4.3 改读家庭设置）。 */
export function envProviderConfig(): NativeProviderConfig | null {
  const baseUrl = process.env.AGENT_NATIVE_BASE_URL?.trim();
  const apiKey = process.env.AGENT_NATIVE_KEY?.trim();
  const model = process.env.AGENT_NATIVE_MODEL?.trim();
  return baseUrl && apiKey && model ? { baseUrl, apiKey, model } : null;
}

export function openAICompatibleProvider(config: NativeProviderConfig): ModelProvider {
  return new OpenAICompatibleProvider({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    quirks: config.quirks as never,
  });
}
