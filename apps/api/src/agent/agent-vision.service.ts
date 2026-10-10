// 小管家内核的「云端看图」（J4 第四批，K2 截图记账用）：用家庭配置的第 2 档模型发一条带图片的请求。
// - 谁能用：vision-access.ts（第 2 档开着、测通过、服务商收图片、对这个成员开放），否则 403；
// - 计入每日上限：与对话同一把锁（agent-quota.ts），用完了 429 + 固定文案，同时记一条被挡下的审计 run；
// - 审计：每次识别记一条 tier = 2 的 run（挂在一个归档的「截图记账」会话上，不出现在对话列表；不存图片、不存回答）；
// - 图片本身不脱敏（做不到），文字只有固定的提示词，没有家庭数据；run.redacted 照家庭的脱敏开关记。
// 结果怎么解析由调用方给（parse 返回 null 算没认出来，重试一次仍不行 → 422）。
import {
  BadGatewayException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { ProviderError, type ModelImage } from '@family/agent-core';
import type { JwtUser } from '../auth/jwt.guard';
import { AgentConversation, AgentRun } from '../entities';
import { AgentService } from './agent.service';
import { DAILY_LIMIT_TEXT, tier2Quota } from './agent-quota';
import { openAICompatibleProvider, settingProviderConfig } from './native/provider-factory';
import { visionAvailable } from './vision-access';

export const VISION_RUNTIME_VERSION = 'vision-1';
const VISION_TIMEOUT_MS = 60_000;

export interface VisionRequest<T> {
  /** 审计会话的标题（「截图记账」） */
  title: string;
  image: ModelImage;
  system: string;
  prompt: string;
  maxTokens: number;
  parse(text: string): T | null;
  /** 两次都没认出来时给成员看的话 */
  unrecognized: string;
}

@Injectable()
export class AgentVisionService {
  constructor(
    private readonly agent: AgentService,
    private readonly dataSource: DataSource,
    @InjectRepository(AgentRun) private readonly runs: Repository<AgentRun>,
  ) {}

  /** 当前成员能不能用看图（记一笔表单的「传截图」按钮也看 /agent/status 里的同一个判断）。 */
  async available(user: JwtUser) {
    return visionAvailable(await this.agent.settingsFor(user), user);
  }

  async recognize<T>(user: JwtUser, request: VisionRequest<T>): Promise<T> {
    const setting = await this.agent.settingsFor(user);
    const config = settingProviderConfig(setting);
    if (!visionAvailable(setting, user) || !config) {
      throw new ForbiddenException('截图识别要用云端模型：第 2 档对你开放、配的模型能看图并且测通过才行');
    }
    const profile = await this.agent.profileFor(user);
    const run = await this.dataSource.transaction(async (manager) => {
      const quota = await tier2Quota(manager, setting, user.householdId, true);
      const conversation = await manager.getRepository(AgentConversation).save(
        manager.getRepository(AgentConversation).create({
          householdId: user.householdId,
          createdByMemberId: user.memberId,
          agentProfileId: profile.id,
          source: 'app',
          title: request.title,
          status: 'archived',
          expiresAt: new Date(Date.now() + setting.retentionDays * 86_400_000),
        }),
      );
      const runs = manager.getRepository(AgentRun);
      return runs.save(
        runs.create({
          householdId: user.householdId,
          conversationId: conversation.id,
          requestedByMemberId: user.memberId,
          agentProfileId: profile.id,
          clientRequestId: `vision:${randomUUID()}`,
          runtimeKind: 'native',
          runtimeVersion: VISION_RUNTIME_VERSION,
          modelAlias: config.model,
          allowedTools: [],
          authorizationExpiresAt: new Date(),
          cancelRequestedAt: null,
          inputTokens: null,
          outputTokens: null,
          estimatedCost: null,
          ...quota,
          ...(quota.status === 'queued'
            ? { status: 'running' as const, startedAt: new Date(), redacted: setting.tier2Redact }
            : { startedAt: null }),
        }),
      );
    });
    if (run.status === 'failed') throw new HttpException(DAILY_LIMIT_TEXT, HttpStatus.TOO_MANY_REQUESTS);

    const provider = openAICompatibleProvider(config);
    let inputTokens = 0;
    let outputTokens = 0;
    const finish = (patch: Partial<AgentRun>) =>
      this.runs.update(run.id, { inputTokens, outputTokens, finishedAt: new Date(), ...patch });
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let text = '';
        for await (const event of provider.chat({
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.prompt, images: [request.image] },
          ],
          maxTokens: request.maxTokens,
          signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
        })) {
          if (event.type === 'text_delta') text += event.text;
          else if (event.type === 'usage') {
            inputTokens += event.inputTokens;
            outputTokens += event.outputTokens;
          }
        }
        const parsed = request.parse(text);
        if (parsed !== null) {
          await finish({ status: 'completed', errorCode: null, errorMessage: null });
          return parsed;
        }
      }
    } catch (error) {
      const message = error instanceof ProviderError ? error.message : error instanceof Error ? error.message : String(error);
      await finish({ status: 'failed', errorCode: 'AGENT_PROVIDER_ERROR', errorMessage: message.slice(0, 160) });
      throw new BadGatewayException(`模型服务没接住这张图：${message.slice(0, 120)}`);
    }
    await finish({ status: 'failed', errorCode: 'VISION_UNRECOGNIZED', errorMessage: request.unrecognized });
    throw new UnprocessableEntityException(request.unrecognized);
  }
}
