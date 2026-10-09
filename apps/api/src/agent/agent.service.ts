import { EventBus } from '../events/event-bus';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { AGENT_PROVIDER_PRESETS } from '@family/contracts';
import { ProviderError } from '@family/agent-core';
import { hasCapability, type Capability } from '../auth/capabilities';
import { JwtUser } from '../auth/jwt.guard';
import { agentDataKey } from '../common/config';
import {
  AgentConversation,
  AgentMessage,
  AgentRun,
  AgentRuntimeKind,
  AgentSetting,
  AgentMemberChannel,
  AgentMemberProfile,
  AgentResponseStyle,
  AgentToolEvent,
  AgentProviderKind,
  AgentTier2Scope,
  AssistantUtteranceRecord,
} from '../entities';
import {
  decryptAgentContent,
  decryptProviderKey,
  encryptAgentContent,
  encryptProviderKey,
} from './agent.crypto';
import { FakeAgentRuntime, HermesAgentRuntime } from './agent-runtimes';
import { AgentRunError, NativeAgentRuntime } from './native/native-runtime';
import { isolatedTestMode, openAICompatibleProvider, settingProviderConfig } from './native/provider-factory';
import { modulesTurnedOff, toolAccess } from './tool-access';
import {
  AGENT_MEMORY_TOOLS,
  AGENT_PROPOSAL_TOOLS,
  AGENT_READ_TOOLS,
  AGENT_TOOL_AUTHORIZATION_TTL_MS,
  AgentRuntime,
} from './agent.types';
import { AgentProposalsService } from './agent-proposals.service';
import { isUniqueViolation } from '@family/shared';

interface UpdateAgentSettingsInput {
  enabled?: boolean;
  runtimeKind?: AgentRuntimeKind;
  runtimeProfile?: string;
  modelAlias?: string;
  retentionDays?: number;
  dailyRoutineNotificationLimit?: number;
  routineNotificationsEnabled?: boolean;
  readToolsEnabled?: string[];
  proposalToolsEnabled?: string[];
  tier0Enabled?: boolean;
  tier1Enabled?: boolean;
  tier1BaseUrl?: string | null;
  tier1Model?: string | null;
  tier2DailyLimit?: number;
  tier2Redact?: boolean;
  captureUtterances?: boolean;
  providerKind?: AgentProviderKind | null;
  providerBaseUrl?: string | null;
  providerModel?: string | null;
  providerKey?: string | null;
  tier2Scope?: AgentTier2Scope;
  expectedVersion: number;
}

/** 云端运行方式（第 2 档）：每日上限与 tier2Scope 只管它们；本地确定性助理（测试、离线用）不算。 */
const CLOUD_RUNTIMES: readonly AgentRuntimeKind[] = ['hermes', 'native'];
const DAILY_LIMIT_CODE = 'AGENT_DAILY_LIMIT';
const DAILY_LIMIT_TEXT = '今天小管家的云端额度用完了，明天再问';

/** 可清空的文本设置：没传保留原值，传 null 或空白清空。 */
function optionalSetting(value: string | null | undefined, current: string | null) {
  if (value === undefined) return current;
  return value?.trim() || null;
}

interface UpdateAgentProfileInput {
  enabled?: boolean;
  assistantName?: string;
  responseStyle?: AgentResponseStyle;
  memoryEnabled?: boolean;
  memorySuggestionEnabled?: boolean;
  proactiveRoutinesEnabled?: boolean;
  expectedVersion: number;
}

function trimmed(value: string, fallback: string) {
  return value.trim() || fallback;
}

function sanitizeAssistantName(value: string) {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
}

@Injectable()
export class AgentService {
  constructor(
    private readonly eventBus: EventBus,
    @InjectRepository(AgentSetting)
    private readonly settings: Repository<AgentSetting>,
    @InjectRepository(AgentConversation)
    private readonly conversations: Repository<AgentConversation>,
    @InjectRepository(AgentMessage)
    private readonly messages: Repository<AgentMessage>,
    @InjectRepository(AgentRun) private readonly runs: Repository<AgentRun>,
    @InjectRepository(AgentToolEvent)
    private readonly toolEvents: Repository<AgentToolEvent>,
    @InjectRepository(AgentMemberChannel)
    private readonly channels: Repository<AgentMemberChannel>,
    @InjectRepository(AgentMemberProfile)
    private readonly profiles: Repository<AgentMemberProfile>,
    private readonly dataSource: DataSource,
    private readonly fakeRuntime: FakeAgentRuntime,
    private readonly hermesRuntime: HermesAgentRuntime,
    private readonly nativeRuntime: NativeAgentRuntime,
    private readonly proposals: AgentProposalsService,
  ) {}

  async status(user: JwtUser) {
    const setting = await this.ensureSettings(user);
    const [fake, hermes] = await Promise.all([
      this.fakeRuntime.health(),
      this.hermesRuntime.health(),
    ]);
    const runtimes = { fake, hermes, native: this.nativeRuntime.healthFor(setting) };
    const selected = runtimes[setting.runtimeKind];
    return {
      // tier2Scope = admins 时普通成员看到的是关着的（入口靠它隐藏）
      enabled: setting.enabled && this.tier2Open(setting, user),
      runtimeKind: setting.runtimeKind,
      selected,
      runtimes,
      fallbackAvailable: fake.available,
      persistenceEncrypted: encryptAgentContent(
        '',
        user.householdId,
        '00000000-0000-0000-0000-000000000000',
      ) != null,
      readToolsEnabled: setting.readToolsEnabled,
      proposalToolsEnabled: setting.proposalToolsEnabled,
      // ⌘K 打开时会读 status：家里关了「记录原话」就不往 assistant_utterances 里记
      captureUtterances: setting.captureUtterances,
    };
  }

  async getSettings(user: JwtUser) {
    return this.presentSettings(await this.ensureSettings(user));
  }

  async updateSettings(input: UpdateAgentSettingsInput, user: JwtUser) {
    const current = await this.ensureSettings(user);
    if (current.version !== input.expectedVersion) {
      throw new ConflictException('智能体设置已被其他成员更新，请刷新后重试');
    }
    if (input.enabled === true && !agentDataKey()) {
      throw new ServiceUnavailableException(
        '启用小管家前需要配置 AGENT_DATA_KEY',
      );
    }
    const tools = input.readToolsEnabled
      ? [...new Set(input.readToolsEnabled)].filter((tool) =>
          AGENT_READ_TOOLS.includes(tool as (typeof AGENT_READ_TOOLS)[number]),
        )
      : current.readToolsEnabled;
    if (input.readToolsEnabled && tools.length !== input.readToolsEnabled.length) {
      throw new ForbiddenException('设置中包含未开放的智能体工具');
    }
    const proposalTools = input.proposalToolsEnabled
      ? [...new Set(input.proposalToolsEnabled)].filter((tool) =>
          AGENT_PROPOSAL_TOOLS.includes(
            tool as (typeof AGENT_PROPOSAL_TOOLS)[number],
          ),
        )
      : current.proposalToolsEnabled;
    if (
      input.proposalToolsEnabled &&
      proposalTools.length !== input.proposalToolsEnabled.length
    ) {
      throw new ForbiddenException('设置中包含未开放的操作提案工具');
    }
    const provider = this.nextProviderSettings(input, current, user);
    const runtimeKind = input.runtimeKind ?? current.runtimeKind;
    if (runtimeKind === 'native' && current.runtimeKind !== 'native' && !provider.providerCheckOk) {
      throw new BadRequestException('切到「小管家自带」前先把云端模型测通');
    }
    const result = await this.settings.update(
      { id: current.id, version: input.expectedVersion },
      {
        ...provider,
        tier2Scope: input.tier2Scope ?? current.tier2Scope,
        enabled: input.enabled ?? current.enabled,
        runtimeKind,
        runtimeProfile:
          input.runtimeProfile == null
            ? current.runtimeProfile
            : trimmed(input.runtimeProfile, 'default'),
        modelAlias:
          input.modelAlias == null
            ? current.modelAlias
            : trimmed(input.modelAlias, 'hermes-agent'),
        retentionDays: input.retentionDays ?? current.retentionDays,
        dailyRoutineNotificationLimit:
          input.dailyRoutineNotificationLimit ??
          current.dailyRoutineNotificationLimit,
        routineNotificationsEnabled:
          input.routineNotificationsEnabled ??
          current.routineNotificationsEnabled,
        readToolsEnabled: tools,
        proposalToolsEnabled: proposalTools,
        tier0Enabled: input.tier0Enabled ?? current.tier0Enabled,
        tier1Enabled: input.tier1Enabled ?? current.tier1Enabled,
        tier1BaseUrl: optionalSetting(input.tier1BaseUrl, current.tier1BaseUrl),
        tier1Model: optionalSetting(input.tier1Model, current.tier1Model),
        tier2DailyLimit: input.tier2DailyLimit ?? current.tier2DailyLimit,
        tier2Redact: input.tier2Redact ?? current.tier2Redact,
        captureUtterances: input.captureUtterances ?? current.captureUtterances,
        updatedByMemberId: user.memberId,
        version: current.version + 1,
      },
    );
    if (!result.affected) {
      throw new ConflictException('智能体设置已被其他成员更新，请刷新后重试');
    }
    return this.presentSettings((await this.settings.findOneBy({ id: current.id }))!);
  }

  /**
   * 服务商相关的列：换成非 custom 的服务商时没传的地址 / 模型按预设填；key 加密后存；
   * 服务商、地址、模型、key 任一变了就清掉「测一下」的结果。
   */
  private nextProviderSettings(input: UpdateAgentSettingsInput, current: AgentSetting, user: JwtUser) {
    const providerKind = input.providerKind === undefined ? current.providerKind : input.providerKind;
    let providerBaseUrl = optionalSetting(input.providerBaseUrl, current.providerBaseUrl);
    let providerModel = optionalSetting(input.providerModel, current.providerModel);
    if (input.providerKind && input.providerKind !== 'custom') {
      const preset = AGENT_PROVIDER_PRESETS[input.providerKind];
      if (input.providerBaseUrl === undefined) providerBaseUrl = preset.baseUrl;
      if (input.providerModel === undefined) providerModel = preset.model;
    }
    let providerKeyEncrypted = current.providerKeyEncrypted;
    if (input.providerKey !== undefined) {
      providerKeyEncrypted = input.providerKey ? encryptProviderKey(input.providerKey.trim(), user.householdId) : null;
      if (input.providerKey && !providerKeyEncrypted) {
        throw new ServiceUnavailableException('保存 key 前需要配置 AGENT_DATA_KEY');
      }
    }
    const changed =
      providerKind !== current.providerKind ||
      providerBaseUrl !== current.providerBaseUrl ||
      providerModel !== current.providerModel ||
      input.providerKey !== undefined;
    return {
      providerKind,
      providerBaseUrl,
      providerModel,
      providerKeyEncrypted,
      providerCheckOk: changed ? false : current.providerCheckOk,
      providerCheckedAt: changed ? null : current.providerCheckedAt,
    };
  }

  /** 「测一下」：按当前配置发一条 max_tokens=1 的请求，记下时间与结果；服务商的报错原文（key 打码）原样回给页面。 */
  async checkProvider(user: JwtUser) {
    const current = await this.ensureSettings(user);
    const config = settingProviderConfig(current);
    if (!config) throw new BadRequestException('先选好服务商，填好地址、模型和 key');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let message: string | null = null;
    try {
      for await (const event of openAICompatibleProvider(config).chat({
        messages: [{ role: 'user', content: '你好' }],
        maxTokens: 1,
        signal: controller.signal,
      })) {
        void event;
      }
    } catch (error) {
      message = controller.signal.aborted
        ? '15 秒内没有响应'
        : error instanceof ProviderError
          ? error.body ? `${error.message}：${error.body}` : error.message
          : '测试请求失败';
      message = message.split(config.apiKey).join('***').slice(0, 500);
    } finally {
      clearTimeout(timer);
    }
    const result = await this.settings.update(
      { id: current.id, version: current.version },
      {
        providerCheckedAt: new Date(),
        providerCheckOk: message == null,
        updatedByMemberId: user.memberId,
        version: current.version + 1,
      },
    );
    if (!result.affected) {
      throw new ConflictException('智能体设置已被其他成员更新，请刷新后重新测一下');
    }
    return {
      ok: message == null,
      message,
      settings: this.presentSettings((await this.settings.findOneBy({ id: current.id }))!),
    };
  }

  async getProfile(user: JwtUser) {
    return this.presentProfile(await this.ensureProfile(user));
  }

  async updateProfile(input: UpdateAgentProfileInput, user: JwtUser) {
    const current = await this.ensureProfile(user);
    if (current.version !== input.expectedVersion) {
      throw new ConflictException('小管家档案已被其他操作更新，请刷新后重试');
    }
    const assistantName =
      input.assistantName == null
        ? current.assistantName
        : sanitizeAssistantName(input.assistantName);
    if (!assistantName) throw new BadRequestException('小管家称呼不能为空');
    const result = await this.profiles.update(
      {
        id: current.id,
        householdId: user.householdId,
        memberId: user.memberId,
        version: input.expectedVersion,
      },
      {
        enabled: input.enabled ?? current.enabled,
        assistantName,
        responseStyle: input.responseStyle ?? current.responseStyle,
        memoryEnabled: input.memoryEnabled ?? current.memoryEnabled,
        memorySuggestionEnabled:
          input.memorySuggestionEnabled ?? current.memorySuggestionEnabled,
        proactiveRoutinesEnabled:
          input.proactiveRoutinesEnabled ?? current.proactiveRoutinesEnabled,
        version: current.version + 1,
      },
    );
    if (!result.affected) {
      throw new ConflictException('小管家档案已被其他操作更新，请刷新后重试');
    }
    return this.presentProfile(
      (await this.profiles.findOneBy({ id: current.id }))!,
    );
  }

  async listConversations(user: JwtUser) {
    await this.expireOldConversations(user);
    const rows = await this.conversations.find({
      where: {
        householdId: user.householdId,
        createdByMemberId: user.memberId,
        status: 'active',
      },
      order: { updatedAt: 'DESC' },
      take: 30,
    });
    return Promise.all(rows.map((conversation) => this.conversationSummary(conversation)));
  }

  async createConversation(title: string | undefined, user: JwtUser) {
    const setting = await this.ensureSettings(user);
    const profile = await this.ensureProfile(user);
    if (!setting.enabled || !this.tier2Open(setting, user)) throw new ForbiddenException('家庭小管家当前未启用');
    if (!profile.enabled) throw new ForbiddenException('你的小管家当前未启用');
    if (!agentDataKey()) {
      throw new ServiceUnavailableException('对话加密尚未配置');
    }
    const expiresAt = new Date(Date.now() + setting.retentionDays * 86_400_000);
    const conversation = await this.conversations.save(
      this.conversations.create({
        householdId: user.householdId,
        createdByMemberId: user.memberId,
        agentProfileId: profile.id,
        source: 'app',
        title: title ? trimmed(title, '新对话').slice(0, 120) : '新对话',
        status: 'active',
        expiresAt,
      }),
    );
    return this.conversationSummary(conversation);
  }

  async detail(id: string, user: JwtUser) {
    const conversation = await this.requireConversation(id, user, false);
    // Read runs first: a completed run and its answer commit together; the later
    // message snapshot must not precede the run snapshot.
    const runs = await this.runs.find({
      where: {
        conversationId: conversation.id,
        householdId: user.householdId,
        requestedByMemberId: user.memberId,
      },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    const messages = await this.messages.find({
      where: {
        conversationId: conversation.id,
        householdId: user.householdId,
      },
      order: { createdAt: 'ASC' },
      take: 100,
    });
    const runIds = runs.map((run) => run.id);
    const [toolEvents, linkedMessages, retries] = runIds.length
      ? await Promise.all([
          this.toolEvents
            .createQueryBuilder('event')
            .where('event.householdId = :householdId', {
              householdId: user.householdId,
            })
            .andWhere('event.runId IN (:...runIds)', { runIds })
            .orderBy('event.startedAt', 'ASC')
            .getMany(),
          this.messages
            .createQueryBuilder('message')
            .select('message.runId', 'runId')
            .where('message.householdId = :householdId', {
              householdId: user.householdId,
            })
            .andWhere('message.conversationId = :conversationId', {
              conversationId: conversation.id,
            })
            .andWhere('message.role = :role', { role: 'user' })
            .andWhere('message.runId IN (:...runIds)', { runIds })
            .getRawMany<{ runId: string }>(),
          this.runs
            .createQueryBuilder('run')
            .select('run.retryOfRunId', 'retryOfRunId')
            .where('run.householdId = :householdId', {
              householdId: user.householdId,
            })
            .andWhere('run.retryOfRunId IN (:...runIds)', { runIds })
            .getRawMany<{ retryOfRunId: string }>(),
        ])
      : [[], [], []];
    const linkedRunIds = new Set(linkedMessages.map((entry) => entry.runId));
    const retriedRunIds = new Set(retries.map((entry) => entry.retryOfRunId));
    const retryParents = new Map(
      runs.flatMap((run) =>
        run.retryOfRunId ? [[run.id, run.retryOfRunId] as const] : [],
      ),
    );
    const hasLinkedInput = (runId: string) => {
      let current: string | undefined = runId;
      const visited = new Set<string>();
      while (current && !visited.has(current)) {
        if (linkedRunIds.has(current)) return true;
        visited.add(current);
        current = retryParents.get(current);
      }
      return false;
    };
    const proposals = await this.proposals.listForConversation(
      runs.map((run) => run.id),
      user,
    );
    return {
      ...(await this.conversationSummary(conversation)),
      messages: messages.flatMap((message) => {
        try {
          const content = decryptAgentContent(
            message.contentCiphertext,
            message.contentNonce,
            message.householdId,
            message.conversationId,
          );
          return content
            ? [
                {
                  id: message.id,
                  runId: message.runId,
                  role: message.role,
                  content,
                  createdAt: message.createdAt,
                },
              ]
            : [];
        } catch {
          return [];
        }
      }),
      runs: runs.map((run) =>
        this.presentRun(
          run,
          hasLinkedInput(run.id) && !retriedRunIds.has(run.id),
        ),
      ),
      toolEvents: toolEvents.map((event) => ({
        id: event.id,
        runId: event.runId,
        toolName: event.toolName,
        status: event.status,
        startedAt: event.startedAt,
        finishedAt: event.finishedAt,
        presentation: this.decryptPresentation(event, conversation.id),
      })),
      proposals,
    };
  }

  async archiveConversation(id: string, user: JwtUser) {
    const conversation = await this.requireConversation(id, user, false);
    if (conversation.status !== 'active') {
      return { id, archived: true as const };
    }
    await this.conversations.update(conversation.id, { status: 'archived' });
    return { id, archived: true as const };
  }

  async queueMessage(
    conversationId: string,
    message: string,
    clientRequestId: string,
    user: JwtUser,
  ) {
    const content = message.trim();
    const key = clientRequestId.trim();
    const setting = await this.ensureSettings(user);
    const profile = await this.ensureProfile(user);
    if (!setting.enabled || !this.tier2Open(setting, user)) throw new ForbiddenException('家庭小管家当前未启用');
    if (!profile.enabled) throw new ForbiddenException('你的小管家当前未启用');
    if (!agentDataKey()) {
      throw new ServiceUnavailableException('对话加密尚未配置');
    }
    const conversation = await this.requireConversation(conversationId, user, true);
    const allowedTools = await this.allowedTools(
      [
        ...setting.readToolsEnabled,
        ...setting.proposalToolsEnabled,
        ...(profile.memoryEnabled ? AGENT_MEMORY_TOOLS : []),
      ],
      user,
    );
    const quota = await this.quota(setting, user.householdId);

    const existing = await this.runs.findOneBy({
      householdId: user.householdId,
      clientRequestId: key,
    });
    if (existing) {
      if (
        existing.conversationId !== conversationId ||
        existing.requestedByMemberId !== user.memberId
      ) {
        throw new ConflictException('请求幂等键已用于其他对话');
      }
      return this.presentRun(existing);
    }

    let run: AgentRun;
    try {
      run = await this.dataSource.transaction(async (manager) => {
        const runs = manager.getRepository(AgentRun);
        const messages = manager.getRepository(AgentMessage);
        const created = await runs.save(
          runs.create({
            householdId: user.householdId,
            conversationId: conversation.id,
            requestedByMemberId: user.memberId,
            agentProfileId: profile.id,
            clientRequestId: key,
            runtimeKind: setting.runtimeKind,
            runtimeVersion: this.runtime(setting.runtimeKind).version,
            modelAlias: setting.modelAlias,
            allowedTools,
            authorizationExpiresAt: new Date(
              Date.now() + AGENT_TOOL_AUTHORIZATION_TTL_MS,
            ),
            startedAt: null,
            cancelRequestedAt: null,
            inputTokens: null,
            outputTokens: null,
            estimatedCost: null,
            ...quota,
          }),
        );
        const encrypted = encryptAgentContent(
          content,
          user.householdId,
          conversation.id,
        );
        if (encrypted) {
          await messages.save(
            messages.create({
              householdId: user.householdId,
              conversationId: conversation.id,
              memberId: user.memberId,
              runId: created.id,
              role: 'user',
              ...encrypted,
            }),
          );
        }
        if (conversation.title === '新对话') {
          await manager.getRepository(AgentConversation).update(conversation.id, {
            title: content.slice(0, 36),
          });
        } else {
          await manager.getRepository(AgentConversation).update(conversation.id, {
            updatedAt: new Date(),
          });
        }
        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const duplicate = await this.runs.findOneBy({
          householdId: user.householdId,
          clientRequestId: key,
        });
        if (duplicate) return this.presentRun(duplicate);
      }
      throw error;
    }
    this.dispatch(run, content);
    return this.presentRun(run);
  }

  async queueChannelMessage(
    channel: AgentMemberChannel,
    externalThreadRef: string,
    message: string,
    clientRequestId: string,
  ) {
    const content = message.trim();
    const key = clientRequestId.trim();
    if (!content || content.length > 2000) {
      throw new BadRequestException('消息内容无效');
    }
    if (!key || key.length > 180) {
      throw new BadRequestException('请求幂等键无效');
    }
    const member = channel.member;
    const user: JwtUser = {
      sub: member.accountId ?? member.id,
      accountId: member.accountId ?? member.id,
      memberId: member.id,
      householdId: channel.householdId,
      sid: `agent-channel:${channel.id}`,
      name: member.name,
      role: member.role,
    };
    const setting = await this.ensureSettings(user);
    const profile = await this.ensureProfile(user);
    if (!setting.enabled || !this.tier2Open(setting, user)) throw new ForbiddenException('家庭小管家当前未启用');
    if (!profile.enabled) throw new ForbiddenException('你的小管家当前未启用');
    if (!agentDataKey()) {
      throw new ServiceUnavailableException('对话加密尚未配置');
    }

    const externalThreadRefHash = createHash('sha256')
      .update(`${channel.id}\u0000${externalThreadRef}`, 'utf8')
      .digest('hex');
    let conversation = await this.conversations.findOneBy({
      householdId: channel.householdId,
      channelId: channel.id,
      externalThreadRefHash,
    });
    const expiresAt = new Date(Date.now() + setting.retentionDays * 86_400_000);
    if (!conversation) {
      try {
        conversation = await this.conversations.save(
          this.conversations.create({
            householdId: channel.householdId,
            createdByMemberId: member.id,
            agentProfileId: profile.id,
            source: 'channel',
            channelId: channel.id,
            externalThreadRefHash,
            title: `${channel.platform} 对话`,
            status: 'active',
            expiresAt,
          }),
        );
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        conversation = await this.conversations.findOneBy({
          householdId: channel.householdId,
          channelId: channel.id,
          externalThreadRefHash,
        });
      }
    }
    if (!conversation) throw new ConflictException('无法创建消息渠道会话');
    if (conversation.expiresAt.getTime() <= Date.now()) {
      await this.conversations.update(conversation.id, {
        status: 'active',
        expiresAt,
        updatedAt: new Date(),
      });
      conversation.status = 'active';
      conversation.expiresAt = expiresAt;
    } else if (conversation.status !== 'active') {
      throw new ConflictException('消息渠道会话已经结束');
    }

    const channelTools = await this.allowedTools([...setting.readToolsEnabled], user);
    const channelQuota = await this.quota(setting, channel.householdId);
    const existing = await this.runs.findOneBy({
      householdId: channel.householdId,
      clientRequestId: key,
    });
    if (existing) {
      if (
        existing.conversationId !== conversation.id ||
        existing.requestedByMemberId !== member.id
      ) {
        throw new ConflictException('请求幂等键已用于其他消息渠道会话');
      }
      return this.presentRun(existing);
    }

    let run: AgentRun;
    try {
      run = await this.dataSource.transaction(async (manager) => {
        const runs = manager.getRepository(AgentRun);
        const messages = manager.getRepository(AgentMessage);
        const created = await runs.save(
          runs.create({
            householdId: channel.householdId,
            conversationId: conversation!.id,
            requestedByMemberId: member.id,
            agentProfileId: profile.id,
            clientRequestId: key,
            runtimeKind: setting.runtimeKind,
            runtimeVersion: this.runtime(setting.runtimeKind).version,
            modelAlias: setting.modelAlias,
            allowedTools: channelTools,
            authorizationExpiresAt: new Date(
              Date.now() + AGENT_TOOL_AUTHORIZATION_TTL_MS,
            ),
            startedAt: null,
            cancelRequestedAt: null,
            inputTokens: null,
            outputTokens: null,
            estimatedCost: null,
            ...channelQuota,
          }),
        );
        const encrypted = encryptAgentContent(
          content,
          channel.householdId,
          conversation!.id,
        );
        if (encrypted) {
          await messages.save(
            messages.create({
              householdId: channel.householdId,
              conversationId: conversation!.id,
              memberId: member.id,
              runId: created.id,
              role: 'user',
              ...encrypted,
            }),
          );
        }
        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const duplicate = await this.runs.findOneBy({
          householdId: channel.householdId,
          clientRequestId: key,
        });
        if (duplicate) return this.presentRun(duplicate);
      }
      throw error;
    }
    this.dispatch(run, content);
    return this.presentRun(run);
  }

  async channelRun(runId: string, channelId: string) {
    const channel = await this.channels.findOneBy({ id: channelId });
    if (!channel) throw new NotFoundException('消息渠道绑定不存在');
    const run = await this.runs.findOneBy({
      id: runId,
      householdId: channel.householdId,
      requestedByMemberId: channel.memberId,
    });
    if (!run) throw new NotFoundException('智能体运行不存在');
    const conversation = await this.conversations.findOneBy({
      id: run.conversationId,
      householdId: channel.householdId,
      channelId: channel.id,
    });
    if (!conversation) throw new ForbiddenException('智能体运行不属于此消息渠道');
    const latest = await this.messages.findOne({
      where: {
        conversationId: conversation.id,
        householdId: channel.householdId,
        role: 'assistant',
        runId,
      },
      order: { createdAt: 'DESC' },
    });
    let content: string | null = null;
    if (latest) {
      try {
        content = decryptAgentContent(
          latest.contentCiphertext,
          latest.contentNonce,
          latest.householdId,
          latest.conversationId,
        );
      } catch {
        content = null;
      }
    }
    return {
      ...this.presentRun(run),
      content,
      readOnly: true,
    };
  }

  async cancel(runId: string, user: JwtUser) {
    const run = await this.runs.findOneBy({
      id: runId,
      householdId: user.householdId,
      requestedByMemberId: user.memberId,
    });
    if (!run) throw new NotFoundException('智能体运行不存在');
    if (['completed', 'failed', 'cancelled'].includes(run.status)) {
      return this.presentRun(run);
    }
    const finishedAt = new Date();
    await this.runs.update(run.id, {
      status: 'cancelled',
      cancelRequestedAt: finishedAt,
      finishedAt,
      errorCode: 'CANCELLED_BY_USER',
      errorMessage: null,
    });
    await this.runtime(run.runtimeKind).cancel(run.id);
    return this.presentRun((await this.runs.findOneBy({ id: run.id }))!);
  }

  async retry(runId: string, clientRequestId: string, user: JwtUser) {
    const key = clientRequestId.trim();
    const original = await this.runs.findOneBy({
      id: runId,
      householdId: user.householdId,
      requestedByMemberId: user.memberId,
    });
    if (!original) throw new NotFoundException('智能体运行不存在');
    if (!this.isRetryableStatus(original)) {
      throw new ConflictException('这次回答当前不能重试');
    }
    const conversation = await this.requireConversation(
      original.conversationId,
      user,
      true,
    );
    const setting = await this.ensureSettings(user);
    const profile = await this.ensureProfile(user);
    if (!setting.enabled || !this.tier2Open(setting, user)) throw new ForbiddenException('家庭小管家当前未启用');
    if (!profile.enabled) throw new ForbiddenException('你的小管家当前未启用');
    if (!agentDataKey()) {
      throw new ServiceUnavailableException('对话加密尚未配置');
    }
    const inputMessage = await this.findRetryInput(original, user);
    if (!inputMessage) throw new ConflictException('原始问题无法用于重试');
    const content = decryptAgentContent(
      inputMessage.contentCiphertext,
      inputMessage.contentNonce,
      inputMessage.householdId,
      inputMessage.conversationId,
    );
    if (!content) throw new ConflictException('原始问题无法用于重试');

    const duplicate = await this.runs.findOneBy({
      householdId: user.householdId,
      clientRequestId: key,
    });
    if (duplicate) {
      if (
        duplicate.retryOfRunId !== original.id ||
        duplicate.requestedByMemberId !== user.memberId
      ) {
        throw new ConflictException('请求幂等键已用于其他运行');
      }
      return this.presentRun(duplicate, false);
    }

    let run: AgentRun;
    try {
      run = await this.runs.save(
        this.runs.create({
          householdId: user.householdId,
          conversationId: conversation.id,
          requestedByMemberId: user.memberId,
          agentProfileId: profile.id,
          clientRequestId: key,
          retryOfRunId: original.id,
          runtimeKind: setting.runtimeKind,
          runtimeVersion: this.runtime(setting.runtimeKind).version,
          modelAlias: setting.modelAlias,
          allowedTools: await this.allowedTools(
            [
              ...setting.readToolsEnabled,
              ...setting.proposalToolsEnabled,
              ...(profile.memoryEnabled ? AGENT_MEMORY_TOOLS : []),
            ],
            user,
          ),
          authorizationExpiresAt: new Date(
            Date.now() + AGENT_TOOL_AUTHORIZATION_TTL_MS,
          ),
          startedAt: null,
          cancelRequestedAt: null,
          inputTokens: null,
          outputTokens: null,
          estimatedCost: null,
          ...(await this.quota(setting, user.householdId)),
        }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.runs.findOne({
          where: [
            { householdId: user.householdId, clientRequestId: key },
            { householdId: user.householdId, retryOfRunId: original.id },
          ],
          order: { createdAt: 'DESC' },
        });
        if (raced && raced.requestedByMemberId === user.memberId) {
          return this.presentRun(raced, false);
        }
      }
      throw error;
    }
    this.dispatch(run, content);
    return this.presentRun(run, false);
  }

  /**
   * 运行结束（完成、失败或取消）后推 assistant：对话页据此刷新，不再按 700ms 轮询。
   * 渠道消息、重试这些入口没有经过登录写请求的拦截器，统一在这里发。
   */
  private async processRun(runId: string, message: string) {
    try {
      await this.processRunUnpublished(runId, message);
    } finally {
      const run = await this.runs.findOneBy({ id: runId });
      if (run) {
        await this.recordUtterance(run, message).catch(() => undefined);
        this.eventBus.publish({ householdId: run.householdId, domains: ['assistant'] });
      }
    }
  }

  /**
   * 会话入口的原话也落 assistant_utterances（J2 的表，source = agent_chat，tier = 2），按 run 结果记 outcome：
   * 产生了提案 → proposed；失败 / 取消 → dismissed；只回答、没动作 → no_match。家里关了「记录原话」就不记；
   * 重试不是新的一句话，不再记。
   */
  private async recordUtterance(run: AgentRun, message: string) {
    if (run.retryOfRunId || !['completed', 'failed', 'cancelled'].includes(run.status)) return;
    const setting = await this.settings.findOneBy({ householdId: run.householdId });
    if (!setting?.captureUtterances) return;
    const text = message.trim().slice(0, 200);
    if (!text) return;
    let outcome: 'proposed' | 'dismissed' | 'no_match' = 'dismissed';
    if (run.status === 'completed') {
      const [row]: { proposed: boolean }[] = await this.dataSource.query(
        `SELECT EXISTS (
           SELECT 1 FROM agent_action_proposals WHERE "runId" = $1
           UNION ALL SELECT 1 FROM agent_proposal_groups WHERE "runId" = $1
         ) AS proposed`,
        [run.id],
      );
      outcome = row.proposed ? 'proposed' : 'no_match';
    }
    await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(AssistantUtteranceRecord)
      .values({
        householdId: run.householdId,
        memberId: run.requestedByMemberId,
        // 一个 run 只记一次
        clientId: run.id,
        text,
        source: 'agent_chat',
        tier: 2,
        outcome,
        createdAt: new Date(),
      })
      .orIgnore()
      .execute();
  }

  private async processRunUnpublished(
    runId: string,
    message: string,
  ) {
    const claimed = await this.runs.update(
      { id: runId, status: 'queued' },
      { status: 'running', startedAt: new Date() },
    );
    if (!claimed.affected) return;
    const run = await this.runs.findOneBy({ id: runId });
    if (!run) return;
    // 排队 → 运行中：对话页的状态跟着变
    this.eventBus.publish({ householdId: run.householdId, domains: ['assistant'] });
    try {
      const retryAncestorIds = await this.retryAncestorIds(run);
      const stored = await this.messages.find({
        where: { conversationId: run.conversationId, householdId: run.householdId },
        order: { createdAt: 'ASC' },
        take: 20,
      });
      const history = stored.flatMap((entry) => {
        if (entry.runId && retryAncestorIds.has(entry.runId)) return [];
        try {
          const content = decryptAgentContent(
            entry.contentCiphertext,
            entry.contentNonce,
            entry.householdId,
            entry.conversationId,
          );
          return content ? [{ role: entry.role, content }] : [];
        } catch {
          return [];
        }
      });
      if (
        history.at(-1)?.role === 'user' &&
        history.at(-1)?.content === message
      ) {
        history.pop();
      }
      let result;
      let fallback = false;
      try {
        result = await this.runtime(run.runtimeKind).chat({
          runId: run.id,
          modelAlias: run.modelAlias,
          message,
          allowedTools: run.allowedTools,
          history,
        });
      } catch (error) {
        const current = await this.runs.findOneBy({ id: run.id });
        if (current?.status === 'cancelled') return;
        if (run.runtimeKind !== 'hermes') throw error;
        fallback = true;
        result = await this.runtime('fake').chat({
          runId: run.id,
          modelAlias: run.modelAlias,
          message,
          allowedTools: run.allowedTools,
          history,
        });
        result.content = `Hermes 暂时不可用，下面由本地家庭摘要回答。\n\n${result.content}`;
      }
      const encrypted = encryptAgentContent(
        result.content,
        run.householdId,
        run.conversationId,
      );
      await this.dataSource.transaction(async (manager) => {
        const runs = manager.getRepository(AgentRun);
        const current = await runs.findOne({
          where: { id: run.id, householdId: run.householdId },
          lock: { mode: 'pessimistic_write' },
          loadEagerRelations: false,
        });
        if (!current || current.status === 'cancelled') return;
        if (encrypted) {
          const messages = manager.getRepository(AgentMessage);
          await messages.save(messages.create({
            householdId: run.householdId,
            conversationId: run.conversationId,
            memberId: null,
            runId: run.id,
            role: 'assistant',
            ...encrypted,
          }));
        }
        await runs.update(run.id, {
          status: 'completed',
          finishedAt: new Date(),
          inputTokens: result.inputTokens ?? null,
          outputTokens: result.outputTokens ?? null,
          errorCode: fallback ? 'HERMES_UNAVAILABLE_FALLBACK' : null,
          errorMessage: null,
        });
        await manager.getRepository(AgentConversation).update(run.conversationId, {
          updatedAt: new Date(),
        });
      });
    } catch (error) {
      const current = await this.runs.findOneBy({ id: run.id });
      if (!current || current.status === 'cancelled') return;
      await this.runs.update(run.id, {
        status: 'failed',
        finishedAt: new Date(),
        // native 循环的失败带自己的代码（超步数、超时、模型不可用……），其余照旧
        errorCode: error instanceof AgentRunError ? error.code : 'AGENT_RUN_FAILED',
        errorMessage:
          error instanceof AgentRunError
            ? error.message
            : error instanceof ServiceUnavailableException
              ? '智能体运行时暂时不可用'
              : '小管家暂时无法完成这次回答',
      });
    }
  }

  private runtime(kind: AgentRuntimeKind): AgentRuntime {
    if (kind === 'hermes') return this.hermesRuntime;
    if (kind === 'native') return this.nativeRuntime;
    // 测试开关：隔离测试库里 AGENT_TEST_RUNTIME=native 时，本地确定性助理改由 native 循环 + 剧本模型执行，
    // 全部 agent*.mjs 黑盒照原样再跑一遍（run 上记的仍是 fake）
    if (process.env.AGENT_TEST_RUNTIME === 'native' && isolatedTestMode()) return this.nativeRuntime;
    return this.fakeRuntime;
  }

  /**
   * 本次 run 能用的工具：家庭开着的读 / 提案工具（调用方给）∩ 模块开关（插件被关掉，它的工具一起消失）
   * ∩ 成员能力（manifest 里查询 / 动作声明的能力，例如 get_finance_summary 要 view_finance）。
   */
  /** 第 2 档对这个成员开没开：云端运行方式下 tier2Scope = admins 只给管理员（owner / admin）。 */
  private tier2Open(setting: AgentSetting, user: JwtUser) {
    return !CLOUD_RUNTIMES.includes(setting.runtimeKind) || setting.tier2Scope === 'all' || user.role !== 'member';
  }

  /**
   * 开 run 前的额度：云端运行方式按上海时区当天已开的第 2 档 run 数比 tier2DailyLimit，用完了这次就记成一条
   * 不执行的 failed run（errorCode = AGENT_DAILY_LIMIT，tier 留空不占额度）——既是审计，对话里也看得到原因。
   */
  private async quota(setting: AgentSetting, householdId: string) {
    const cloud = CLOUD_RUNTIMES.includes(setting.runtimeKind);
    if (cloud) {
      const [row]: { used: number }[] = await this.dataSource.query(
        `SELECT COUNT(*)::int AS used FROM agent_runs
          WHERE "householdId" = $1 AND tier = 2
            AND "createdAt" >= (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')`,
        [householdId],
      );
      if (row.used >= setting.tier2DailyLimit) {
        return {
          status: 'failed' as const,
          tier: null,
          redacted: false,
          finishedAt: new Date(),
          errorCode: DAILY_LIMIT_CODE,
          errorMessage: DAILY_LIMIT_TEXT,
        };
      }
    }
    return {
      status: 'queued' as const,
      tier: cloud ? 2 : null,
      redacted: setting.runtimeKind === 'native' && setting.tier2Redact,
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
    };
  }

  /** 排上队的交给运行时；被额度挡下的只记原话、推一下对话页。 */
  private dispatch(run: AgentRun, content: string) {
    if (run.status === 'queued') {
      void this.processRun(run.id, content);
      return;
    }
    void this.recordUtterance(run, content).catch(() => undefined);
    this.eventBus.publish({ householdId: run.householdId, domains: ['assistant'] });
  }

  private async allowedTools(candidates: readonly string[], user: JwtUser) {
    const off = await modulesTurnedOff(this.dataSource, user.householdId);
    const can = (capability: string) => hasCapability(user, capability as Capability);
    return candidates.filter((tool) => toolAccess(tool, off, can) === 'ok');
  }

  private isRetryableStatus(run: AgentRun) {
    return (
      run.status === 'failed' ||
      run.status === 'cancelled' ||
      (run.status === 'completed' &&
        run.errorCode === 'HERMES_UNAVAILABLE_FALLBACK')
    );
  }

  private async findRetryInput(run: AgentRun, user: JwtUser) {
    let current: AgentRun | null = run;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      const message = await this.messages.findOneBy({
        householdId: user.householdId,
        conversationId: run.conversationId,
        runId: current.id,
        role: 'user',
      });
      if (message) return message;
      current = current.retryOfRunId
        ? await this.runs.findOneBy({
            id: current.retryOfRunId,
            householdId: user.householdId,
            requestedByMemberId: user.memberId,
          })
        : null;
    }
    return null;
  }

  private async retryAncestorIds(run: AgentRun) {
    const ancestors = new Set<string>();
    let parentId = run.retryOfRunId;
    while (parentId && !ancestors.has(parentId)) {
      ancestors.add(parentId);
      const parent = await this.runs.findOneBy({
        id: parentId,
        householdId: run.householdId,
        requestedByMemberId: run.requestedByMemberId,
      });
      parentId = parent?.retryOfRunId ?? null;
    }
    return ancestors;
  }

  private decryptPresentation(event: AgentToolEvent, conversationId: string) {
    if (!event.presentationCiphertext || !event.presentationNonce) return null;
    try {
      const content = decryptAgentContent(
        event.presentationCiphertext,
        event.presentationNonce,
        event.householdId,
        conversationId,
      );
      return content ? (JSON.parse(content) as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  private async ensureSettings(user: JwtUser) {
    const existing = await this.settings.findOneBy({ householdId: user.householdId });
    if (existing) return existing;
    try {
      return await this.settings.save(
        this.settings.create({
          householdId: user.householdId,
          enabled: agentDataKey() != null,
          runtimeKind: 'fake',
          runtimeProfile: 'default',
          modelAlias: 'hermes-agent',
          retentionDays: 7,
          dailyRoutineNotificationLimit: 3,
          routineNotificationsEnabled: false,
          readToolsEnabled: [...AGENT_READ_TOOLS],
          proposalToolsEnabled: [...AGENT_PROPOSAL_TOOLS],
          version: 1,
          updatedByMemberId: user.memberId,
        }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.settings.findOneBy({ householdId: user.householdId });
        if (raced) return raced;
      }
      throw error;
    }
  }

  private async ensureProfile(user: JwtUser) {
    const existing = await this.profiles.findOneBy({
      householdId: user.householdId,
      memberId: user.memberId,
    });
    if (existing) return existing;
    try {
      return await this.profiles.save(
        this.profiles.create({
          householdId: user.householdId,
          memberId: user.memberId,
          enabled: true,
          assistantName: '小管家',
          responseStyle: 'balanced',
          memoryEnabled: true,
          memorySuggestionEnabled: false,
          proactiveRoutinesEnabled: false,
          version: 1,
        }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.profiles.findOneBy({
          householdId: user.householdId,
          memberId: user.memberId,
        });
        if (raced) return raced;
      }
      throw error;
    }
  }

  private async requireConversation(
    id: string,
    user: JwtUser,
    requireActive: boolean,
  ) {
    const conversation = await this.conversations.findOneBy({
      id,
      householdId: user.householdId,
      createdByMemberId: user.memberId,
    });
    if (!conversation) throw new NotFoundException('对话不存在');
    if (conversation.expiresAt.getTime() <= Date.now()) {
      if (conversation.status !== 'expired') {
        await this.conversations.update(conversation.id, { status: 'expired' });
      }
      throw new NotFoundException('对话已过期');
    }
    if (requireActive && conversation.status !== 'active') {
      throw new ConflictException('这个对话已经结束');
    }
    return conversation;
  }

  private async expireOldConversations(user: JwtUser) {
    await this.conversations
      .createQueryBuilder()
      .update()
      .set({ status: 'expired' })
      .where('"householdId" = :householdId', { householdId: user.householdId })
      .andWhere('"createdByMemberId" = :memberId', { memberId: user.memberId })
      .andWhere('"status" = :status', { status: 'active' })
      .andWhere('"expiresAt" <= now()')
      .execute();
  }

  private async conversationSummary(conversation: AgentConversation) {
    const latestRun = await this.runs.findOne({
      where: { conversationId: conversation.id },
      order: { createdAt: 'DESC' },
    });
    return {
      id: conversation.id,
      title: conversation.title,
      status: conversation.status,
      expiresAt: conversation.expiresAt,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      latestRun: latestRun ? this.presentRun(latestRun) : null,
    };
  }

  private presentSettings(setting: AgentSetting) {
    return {
      enabled: setting.enabled,
      runtimeKind: setting.runtimeKind,
      runtimeProfile: setting.runtimeProfile,
      modelAlias: setting.modelAlias,
      retentionDays: setting.retentionDays,
      dailyRoutineNotificationLimit: setting.dailyRoutineNotificationLimit,
      routineNotificationsEnabled: setting.routineNotificationsEnabled,
      readToolsEnabled: setting.readToolsEnabled,
      proposalToolsEnabled: setting.proposalToolsEnabled,
      tier0Enabled: setting.tier0Enabled,
      tier1Enabled: setting.tier1Enabled,
      tier1BaseUrl: setting.tier1BaseUrl,
      tier1Model: setting.tier1Model,
      tier2DailyLimit: setting.tier2DailyLimit,
      tier2Redact: setting.tier2Redact,
      captureUtterances: setting.captureUtterances,
      providerKind: setting.providerKind,
      providerBaseUrl: setting.providerBaseUrl,
      providerModel: setting.providerModel,
      providerKeyConfigured: setting.providerKeyEncrypted != null,
      providerKeyLast4: this.providerKeyLast4(setting),
      providerCheckedAt: setting.providerCheckedAt,
      providerCheckOk: setting.providerCheckOk,
      tier2Scope: setting.tier2Scope,
      version: setting.version,
      updatedAt: setting.updatedAt,
    };
  }

  /** key 只给末 4 位；解不开（换过 AGENT_DATA_KEY）就不给。 */
  private providerKeyLast4(setting: AgentSetting) {
    if (!setting.providerKeyEncrypted) return null;
    try {
      return decryptProviderKey(setting.providerKeyEncrypted, setting.householdId)?.slice(-4) ?? null;
    } catch {
      return null;
    }
  }

  private presentProfile(profile: AgentMemberProfile) {
    return {
      id: profile.id,
      memberId: profile.memberId,
      enabled: profile.enabled,
      assistantName: profile.assistantName,
      responseStyle: profile.responseStyle,
      memoryEnabled: profile.memoryEnabled,
      memorySuggestionEnabled: profile.memorySuggestionEnabled,
      proactiveRoutinesEnabled: profile.proactiveRoutinesEnabled,
      version: profile.version,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  private presentRun(run: AgentRun, hasRetryInput = false) {
    return {
      id: run.id,
      conversationId: run.conversationId,
      retryOfRunId: run.retryOfRunId,
      runtimeKind: run.runtimeKind,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      cancelRequestedAt: run.cancelRequestedAt,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      retryable: hasRetryInput && this.isRetryableStatus(run),
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
  }
}
