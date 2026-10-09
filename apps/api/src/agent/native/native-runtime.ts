// 第三个 AgentRuntime：小管家自带的循环（packages/agent-core 的 runLoop）。
// 工具执行接到 AgentToolsService.executeForLoop：与 MCP / 内置路径同一套鉴权（run 状态、授权名单、成员能力）、
// 同一套 agent_tool_events 落库；交给模型的提案结果只有 proposalId。
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { runLoop, type AgentEvent, type AgentLimits, type AgentToolset } from '@family/agent-core';
import { todayInShanghai } from '@family/shared';
import { AgentRun, AgentSetting } from '../../entities';
import { AgentToolsService } from '../agent-tools.service';
import type { AgentChatInput, AgentChatResult, AgentRuntime, AgentRuntimeHealth } from '../agent.types';
import { redactForModel, redactionContext } from '../redact';
import {
  nativeTestProviderSpec,
  openAICompatibleProvider,
  settingProviderConfig,
  testProviderFor,
} from './provider-factory';
import { RedactingProvider } from './redacting-provider';

/** 单次 run 的上限（agent-core 的参数，不是散落的常量）。 */
export const NATIVE_LIMITS: AgentLimits = {
  maxSteps: 8,
  maxToolCalls: 12,
  maxOutputTokens: 4_000,
  maxWallMs: 120_000,
};

/** native 运行失败：code 写进 agent_runs.errorCode，message 给成员看。 */
export class AgentRunError extends ServiceUnavailableException {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const ERROR_TEXT: Record<Extract<AgentEvent, { type: 'error' }>['code'], [string, string]> = {
  max_steps: ['AGENT_MAX_STEPS', '这个问题需要的步骤太多，换个更具体的说法再问'],
  max_tool_calls: ['AGENT_MAX_TOOL_CALLS', '这个问题需要查的东西太多，换个更具体的说法再问'],
  max_output_tokens: ['AGENT_OUTPUT_LIMIT', '回答太长被截断了，换个更具体的说法再问'],
  output_truncated: ['AGENT_OUTPUT_LIMIT', '回答太长被截断了，换个更具体的说法再问'],
  content_filter: ['AGENT_CONTENT_FILTER', '云端模型拒绝回答这个问题'],
  timeout: ['AGENT_TIMEOUT', '小管家这次想得太久了，稍后再问'],
  aborted: ['AGENT_ABORTED', '这次回答已取消'],
  provider_error: ['AGENT_PROVIDER_ERROR', '云端模型暂时不可用'],
};

function nativeInstructions() {
  return (
    `你是家庭管理软件中的小管家。当前日期为 ${todayInShanghai()}（Asia/Shanghai）。` +
    '涉及家庭事实时优先调用工具，不使用模型记忆猜测；需要的工具不在可用列表里时应明确说明。' +
    '写操作只能调用 propose_* 工具生成提案，提案要成员在 Family App 内确认后才会执行。' +
    '查询家庭收支、余额或预算，以及生成记账提案前，必须先调用 get_finance_summary；财务信息不明确时先追问，财务提案不得放入 propose_plan。' +
    '绝不能声称提案已经执行，也不能替用户确认。回答简洁、具体，并在不确定时明确说明。'
  );
}

@Injectable()
export class NativeAgentRuntime implements AgentRuntime {
  readonly kind = 'native' as const;
  readonly version = 'native-loop-1';
  private readonly active = new Map<string, AbortController>();

  constructor(
    private readonly tools: AgentToolsService,
    @InjectRepository(AgentRun) private readonly runs: Repository<AgentRun>,
    @InjectRepository(AgentSetting) private readonly settings: Repository<AgentSetting>,
    private readonly dataSource: DataSource,
  ) {}

  /** 没有家庭上下文时的健康：只有测试模式的回放 / 剧本模型算可用。status 用 healthFor。 */
  async health(): Promise<AgentRuntimeHealth> {
    if (nativeTestProviderSpec()) {
      return { available: true, configured: true, version: this.version, message: '测试模式：回放 / 剧本模型' };
    }
    return { available: false, configured: false, version: this.version, message: '按家庭的云端档配置' };
  }

  /** 某个家庭的健康：配好了地址、模型、key 算 configured，「测一下」通过才算 available。 */
  healthFor(setting: AgentSetting): AgentRuntimeHealth {
    if (nativeTestProviderSpec()) {
      return { available: true, configured: true, version: this.version, message: '测试模式：回放 / 剧本模型' };
    }
    const config = settingProviderConfig(setting);
    if (!config) return { available: false, configured: false, version: this.version, message: '还没有配置云端模型' };
    return setting.providerCheckOk
      ? { available: true, configured: true, version: this.version, message: `已配置模型 ${config.model}` }
      : { available: false, configured: true, version: this.version, message: '云端模型还没测通' };
  }

  async chat(input: AgentChatInput): Promise<AgentChatResult> {
    const provider = await this.providerFor(input);
    const controller = new AbortController();
    this.active.set(input.runId, controller);
    const registry = this.tools.registry;
    const toolset: AgentToolset<object> = {
      canonicalSet: (names) => registry.canonicalSet(names),
      toModelTools: (allowed) => registry.toModelTools(allowed),
      resolve: (name) => registry.resolve(name),
      execute: (name, _context, rawArgs) => this.tools.executeForLoop(name, input.runId, rawArgs),
    };
    try {
      let content = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let reported = false;
      const events = runLoop(
        provider,
        toolset,
        {
          system: nativeInstructions(),
          history: input.history.slice(-12).map((entry) => ({ role: entry.role, content: entry.content })),
          message: input.message,
          untrusted: input.untrusted ?? [],
          allowedTools: input.allowedTools,
          context: {},
          signal: controller.signal,
        },
        NATIVE_LIMITS,
      );
      for await (const event of events) {
        if (event.type === 'usage') {
          reported = true;
          inputTokens += event.inputTokens;
          outputTokens += event.outputTokens;
        } else if (event.type === 'done') {
          content = event.text.trim();
        } else if (event.type === 'error') {
          const [code, message] = ERROR_TEXT[event.code];
          throw new AgentRunError(code, message);
        }
      }
      if (!content) throw new AgentRunError('AGENT_EMPTY_ANSWER', '小管家这次没有给出回答');
      return reported ? { content, inputTokens, outputTokens } : { content };
    } finally {
      this.active.delete(input.runId);
    }
  }

  async cancel(runId: string) {
    this.active.get(runId)?.abort();
  }

  private async providerFor(input: AgentChatInput) {
    const run = await this.runs.findOneBy({ id: input.runId });
    if (!run) throw new AgentRunError('AGENT_RUN_MISSING', '智能体运行不存在');
    const spec = nativeTestProviderSpec();
    let provider = spec ? testProviderFor(spec, input.message) : null;
    if (!provider) {
      const setting = await this.settings.findOneBy({ householdId: run.householdId });
      const config = setting ? settingProviderConfig(setting) : null;
      if (!config) throw new AgentRunError('AGENT_PROVIDER_UNCONFIGURED', '还没有配置云端模型');
      provider = openAICompatibleProvider(config);
    }
    // 开 run 时按家庭的 tier2Redact 定下来的（记在 run 上）
    if (run.redacted) {
      const context = await redactionContext(this.dataSource, run.householdId);
      provider = new RedactingProvider(provider, (text) => redactForModel(text, context));
    }
    return provider;
  }
}
