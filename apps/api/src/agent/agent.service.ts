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
import { JwtUser } from '../auth/jwt.guard';
import { agentDataKey } from '../common/config';
import {
  AgentConversation,
  AgentMessage,
  AgentRun,
  AgentRuntimeKind,
  AgentSetting,
  AgentMemberChannel,
} from '../entities';
import { decryptAgentContent, encryptAgentContent } from './agent.crypto';
import { FakeAgentRuntime, HermesAgentRuntime } from './agent-runtimes';
import {
  AGENT_PROPOSAL_TOOLS,
  AGENT_READ_TOOLS,
  AgentRuntime,
} from './agent.types';
import { AgentProposalsService } from './agent-proposals.service';

interface UpdateAgentSettingsInput {
  enabled?: boolean;
  runtimeKind?: AgentRuntimeKind;
  runtimeProfile?: string;
  modelAlias?: string;
  retentionDays?: number;
  readToolsEnabled?: string[];
  proposalToolsEnabled?: string[];
  expectedVersion: number;
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

function trimmed(value: string, fallback: string) {
  return value.trim() || fallback;
}

@Injectable()
export class AgentService {
  constructor(
    @InjectRepository(AgentSetting)
    private readonly settings: Repository<AgentSetting>,
    @InjectRepository(AgentConversation)
    private readonly conversations: Repository<AgentConversation>,
    @InjectRepository(AgentMessage)
    private readonly messages: Repository<AgentMessage>,
    @InjectRepository(AgentRun) private readonly runs: Repository<AgentRun>,
    @InjectRepository(AgentMemberChannel)
    private readonly channels: Repository<AgentMemberChannel>,
    private readonly dataSource: DataSource,
    private readonly fakeRuntime: FakeAgentRuntime,
    private readonly hermesRuntime: HermesAgentRuntime,
    private readonly proposals: AgentProposalsService,
  ) {}

  async status(user: JwtUser) {
    const setting = await this.ensureSettings(user);
    const [fake, hermes] = await Promise.all([
      this.fakeRuntime.health(),
      this.hermesRuntime.health(),
    ]);
    const selected = setting.runtimeKind === 'hermes' ? hermes : fake;
    return {
      enabled: setting.enabled,
      runtimeKind: setting.runtimeKind,
      selected,
      runtimes: { fake, hermes },
      fallbackAvailable: fake.available,
      persistenceEncrypted: encryptAgentContent(
        '',
        user.householdId,
        '00000000-0000-0000-0000-000000000000',
      ) != null,
      readToolsEnabled: setting.readToolsEnabled,
      proposalToolsEnabled: setting.proposalToolsEnabled,
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
    const result = await this.settings.update(
      { id: current.id, version: input.expectedVersion },
      {
        enabled: input.enabled ?? current.enabled,
        runtimeKind: input.runtimeKind ?? current.runtimeKind,
        runtimeProfile:
          input.runtimeProfile == null
            ? current.runtimeProfile
            : trimmed(input.runtimeProfile, 'default'),
        modelAlias:
          input.modelAlias == null
            ? current.modelAlias
            : trimmed(input.modelAlias, 'hermes-agent'),
        retentionDays: input.retentionDays ?? current.retentionDays,
        readToolsEnabled: tools,
        proposalToolsEnabled: proposalTools,
        updatedByMemberId: user.memberId,
        version: current.version + 1,
      },
    );
    if (!result.affected) {
      throw new ConflictException('智能体设置已被其他成员更新，请刷新后重试');
    }
    return this.presentSettings((await this.settings.findOneBy({ id: current.id }))!);
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
    if (!setting.enabled) throw new ForbiddenException('家庭小管家当前未启用');
    if (!agentDataKey()) {
      throw new ServiceUnavailableException('对话加密尚未配置');
    }
    const expiresAt = new Date(Date.now() + setting.retentionDays * 86_400_000);
    const conversation = await this.conversations.save(
      this.conversations.create({
        householdId: user.householdId,
        createdByMemberId: user.memberId,
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
    const [messages, runs] = await Promise.all([
      this.messages.find({
        where: {
          conversationId: conversation.id,
          householdId: user.householdId,
        },
        order: { createdAt: 'ASC' },
        take: 100,
      }),
      this.runs.find({
        where: {
          conversationId: conversation.id,
          householdId: user.householdId,
          requestedByMemberId: user.memberId,
        },
        order: { createdAt: 'DESC' },
        take: 50,
      }),
    ]);
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
      runs: runs.map((run) => this.presentRun(run)),
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
    if (!setting.enabled) throw new ForbiddenException('家庭小管家当前未启用');
    if (!agentDataKey()) {
      throw new ServiceUnavailableException('对话加密尚未配置');
    }
    const conversation = await this.requireConversation(conversationId, user, true);

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
              role: 'user',
              ...encrypted,
            }),
          );
        }
        const created = await runs.save(
          runs.create({
            householdId: user.householdId,
            conversationId: conversation.id,
            requestedByMemberId: user.memberId,
            clientRequestId: key,
            runtimeKind: setting.runtimeKind,
            runtimeVersion:
              setting.runtimeKind === 'hermes'
                ? this.hermesRuntime.version
                : this.fakeRuntime.version,
            modelAlias: setting.modelAlias,
            status: 'queued',
            allowedTools: [
              ...setting.readToolsEnabled,
              ...setting.proposalToolsEnabled,
            ],
            authorizationExpiresAt: new Date(Date.now() + 5 * 60_000),
            startedAt: null,
            finishedAt: null,
            cancelRequestedAt: null,
            inputTokens: null,
            outputTokens: null,
            estimatedCost: null,
            errorCode: null,
            errorMessage: null,
          }),
        );
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
    void this.processRun(run.id, content);
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
    if (!setting.enabled) throw new ForbiddenException('家庭小管家当前未启用');
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
              role: 'user',
              ...encrypted,
            }),
          );
        }
        return runs.save(
          runs.create({
            householdId: channel.householdId,
            conversationId: conversation!.id,
            requestedByMemberId: member.id,
            clientRequestId: key,
            runtimeKind: setting.runtimeKind,
            runtimeVersion:
              setting.runtimeKind === 'hermes'
                ? this.hermesRuntime.version
                : this.fakeRuntime.version,
            modelAlias: setting.modelAlias,
            status: 'queued',
            allowedTools: [...setting.readToolsEnabled],
            authorizationExpiresAt: new Date(Date.now() + 5 * 60_000),
            startedAt: null,
            finishedAt: null,
            cancelRequestedAt: null,
            inputTokens: null,
            outputTokens: null,
            estimatedCost: null,
            errorCode: null,
            errorMessage: null,
          }),
        );
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
    void this.processRun(run.id, content);
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

  private async processRun(runId: string, message: string) {
    const claimed = await this.runs.update(
      { id: runId, status: 'queued' },
      { status: 'running', startedAt: new Date() },
    );
    if (!claimed.affected) return;
    const run = await this.runs.findOneBy({ id: runId });
    if (!run) return;
    try {
      const stored = await this.messages.find({
        where: { conversationId: run.conversationId, householdId: run.householdId },
        order: { createdAt: 'ASC' },
        take: 20,
      });
      const history = stored.flatMap((entry) => {
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
        result = await this.fakeRuntime.chat({
          runId: run.id,
          modelAlias: run.modelAlias,
          message,
          allowedTools: run.allowedTools,
          history,
        });
        result.content = `Hermes 暂时不可用，下面由本地家庭摘要回答。\n\n${result.content}`;
      }
      const current = await this.runs.findOneBy({ id: run.id });
      if (!current || current.status === 'cancelled') return;
      const encrypted = encryptAgentContent(
        result.content,
        run.householdId,
        run.conversationId,
      );
      if (encrypted) {
        await this.messages.save(
          this.messages.create({
            householdId: run.householdId,
            conversationId: run.conversationId,
            memberId: null,
            runId: run.id,
            role: 'assistant',
            ...encrypted,
          }),
        );
      }
      await this.runs.update(run.id, {
        status: 'completed',
        finishedAt: new Date(),
        inputTokens: result.inputTokens ?? null,
        outputTokens: result.outputTokens ?? null,
        errorCode: fallback ? 'HERMES_UNAVAILABLE_FALLBACK' : null,
        errorMessage: null,
      });
      await this.conversations.update(run.conversationId, { updatedAt: new Date() });
    } catch (error) {
      const current = await this.runs.findOneBy({ id: run.id });
      if (!current || current.status === 'cancelled') return;
      await this.runs.update(run.id, {
        status: 'failed',
        finishedAt: new Date(),
        errorCode: 'AGENT_RUN_FAILED',
        errorMessage:
          error instanceof ServiceUnavailableException
            ? '智能体运行时暂时不可用'
            : '小管家暂时无法完成这次回答',
      });
    }
  }

  private runtime(kind: AgentRuntimeKind): AgentRuntime {
    return kind === 'hermes' ? this.hermesRuntime : this.fakeRuntime;
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
      readToolsEnabled: setting.readToolsEnabled,
      proposalToolsEnabled: setting.proposalToolsEnabled,
      version: setting.version,
      updatedAt: setting.updatedAt,
    };
  }

  private presentRun(run: AgentRun) {
    return {
      id: run.id,
      conversationId: run.conversationId,
      runtimeKind: run.runtimeKind,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      cancelRequestedAt: run.cancelRequestedAt,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
  }
}
