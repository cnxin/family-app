import { EventBus } from '../events/event-bus';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CORE_TOOL_SOURCES, pluginToolSources } from '@family/contracts';
import { ToolInvocationError, type ToolOutcome, type ToolRegistry } from '@family/agent-core';
import { hasCapability, type Capability } from '../auth/capabilities';
import { JwtUser } from '../auth/jwt.guard';
import {
  AgentMemberProfile,
  AgentRun,
  AgentToolEvent,
  Member,
} from '../entities';
import { PluginFacadeRegistry } from '../system/plugin-facades.registry';
import { AgentProposalsService } from './agent-proposals.service';
import { encryptAgentContent } from './agent.crypto';
import { AgentMemoryService } from './agent-memory.service';
import { AgentProposalGroupsService } from './agent-proposal-groups.service';
import { createAgentToolRegistry, type AgentToolContext } from './tools';
import { SEARCH_RECIPES_LIMIT_ERROR } from './tools/recipes';
import { modulesTurnedOff, toolAccess } from './tool-access';

const MAX_RESPONSE_BYTES = 48_000;

function userFor(run: AgentRun, member: Member): JwtUser {
  return {
    sub: member.accountId ?? member.id,
    accountId: member.accountId ?? member.id,
    memberId: member.id,
    householdId: run.householdId,
    sid: `agent:${run.id}`,
    name: member.name,
    role: member.role,
  };
}

function resultPresentation(toolName: string, output: unknown) {
  const record =
    output && typeof output === 'object' && !Array.isArray(output)
      ? (output as Record<string, unknown>)
      : null;
  const rowsFor = (key: string) =>
    Array.isArray(output)
      ? output
      : record && Array.isArray(record[key])
        ? record[key]
        : [];

  if (toolName === 'get_tasks' || toolName === 'get_member_tasks') {
    const rows = rowsFor('tasks');
    return {
      kind: 'tasks',
      title: toolName === 'get_member_tasks' ? '成员任务' : '家庭任务',
      emptyText: '这段时间没有待办任务',
      targetPath: '/tasks',
      items: rows.slice(0, 8).map((entry) => {
        const item = entry as Record<string, unknown>;
        return {
          id: String(item.id ?? ''),
          title: String(item.title ?? '未命名任务'),
          detail: [item.dueDate, item.assigneeName ?? item.assignedMemberName]
            .filter(Boolean)
            .join(' · '),
          status:
            item.status === 'completed' || item.status === 'done'
              ? '已完成'
              : item.status === 'skipped'
                ? '已跳过'
                : '待完成',
          targetPath:
            typeof item.targetPath === 'string' ? item.targetPath : '/tasks',
        };
      }),
    };
  }
  if (toolName === 'get_shopping_list') {
    const rows = rowsFor('items');
    return {
      kind: 'shopping',
      title: '购物清单',
      emptyText: '购物清单已经处理完了',
      targetPath: '/shopping',
      items: rows.slice(0, 8).map((entry) => {
        const item = entry as Record<string, unknown>;
        return {
          id: String(item.id ?? ''),
          title: String(item.name ?? '未命名采购项'),
          detail:
            item.quantity == null
              ? String(item.unit ?? '')
              : `${String(item.quantity)} ${String(item.unit ?? '')}`.trim(),
          status: item.checked ? '已购买' : '待购买',
          targetPath:
            typeof item.targetPath === 'string' ? item.targetPath : '/shopping',
        };
      }),
    };
  }
  if (toolName === 'get_meal_plan') {
    const rows = rowsFor('items');
    const mealLabels: Record<string, string> = {
      breakfast: '早餐',
      lunch: '午餐',
      dinner: '晚餐',
    };
    return {
      kind: 'meals',
      title: '今日菜单',
      emptyText: '这一天还没有安排菜单',
      targetPath: '/kitchen',
      items: rows.slice(0, 3).map((entry) => {
        const item = entry as Record<string, unknown>;
        const dishes = Array.isArray(item.items)
          ? item.items
              .slice(0, 5)
              .map((dish) => String((dish as Record<string, unknown>).dishName ?? ''))
              .filter(Boolean)
          : [];
        return {
          id: String(item.id ?? ''),
          title: mealLabels[String(item.mealType)] ?? '用餐安排',
          detail: dishes.join('、') || '还没有菜品',
          status: item.chefName ? `${String(item.chefName)} 掌勺` : '待安排掌勺人',
          targetPath:
            typeof item.targetPath === 'string' ? item.targetPath : '/kitchen',
        };
      }),
    };
  }
  if (toolName === 'get_family_schedule') {
    const rows = rowsFor('events');
    return {
      kind: 'schedule',
      title: '家庭日程',
      emptyText: '这段时间没有家庭安排',
      targetPath: '/calendar',
      items: rows.slice(0, 8).map((entry) => {
        const item = entry as Record<string, unknown>;
        return {
          id: String(item.id ?? ''),
          title: String(item.title ?? '未命名日程'),
          detail: [
            item.date,
            ...(Array.isArray(item.participants) ? item.participants : []),
          ]
            .filter(Boolean)
            .join(' · '),
          status: String(item.status ?? '已安排'),
          targetPath:
            typeof item.targetPath === 'string' ? item.targetPath : '/calendar',
        };
      }),
    };
  }
  if (toolName === 'get_inventory_summary') {
    const rows = rowsFor('items');
    return {
      kind: 'inventory',
      title: '库存摘要',
      emptyText: '当前没有需要关注的库存',
      targetPath: '/shopping',
      items: rows.slice(0, 8).map((entry) => {
        const item = entry as Record<string, unknown>;
        return {
          id: String(item.id ?? ''),
          title: String(item.name ?? '未命名库存'),
          detail:
            `${String(item.quantity ?? 0)} ${String(item.unit ?? '')}`.trim(),
          status:
            item.alert === 'low_stock_and_expiring'
              ? '缺货且临期'
              : item.alert === 'expiring_soon'
                ? '临期'
                : item.alert === 'low_stock'
                  ? '库存偏低'
                  : '正常',
          targetPath: '/shopping',
        };
      }),
    };
  }
  if (toolName === 'search_recipes') {
    if (record?.error === SEARCH_RECIPES_LIMIT_ERROR) return null;
    const rows = rowsFor('recipes');
    return {
      kind: 'recipes',
      title: '菜谱搜索',
      emptyText: '没有找到匹配的家庭菜谱',
      targetPath: '/kitchen',
      items: rows.slice(0, 8).map((entry) => {
        const item = entry as Record<string, unknown>;
        return {
          id: String(item.id ?? ''),
          title: String(item.name ?? '未命名菜谱'),
          detail: [
            item.category,
            item.cookingTime ? `${String(item.cookingTime)} 分钟` : null,
          ]
            .filter(Boolean)
            .join(' · '),
          status: `难度 ${String(item.difficulty ?? '-')}`,
          targetPath:
            typeof item.targetPath === 'string' ? item.targetPath : '/kitchen',
        };
      }),
    };
  }
  if (toolName === 'get_dish_plan') {
    const rows = rowsFor('plans');
    const mealLabels: Record<string, string> = {
      breakfast: '早餐',
      lunch: '午餐',
      dinner: '晚餐',
    };
    return {
      kind: 'dish-plan',
      title: '点菜计划',
      emptyText: '这段时间还没有点菜安排',
      targetPath: '/kitchen',
      items: rows.slice(0, 8).map((entry) => {
        const item = entry as Record<string, unknown>;
        return {
          id: String(item.id ?? ''),
          title: String(item.recipeName ?? '未命名菜品'),
          detail: [item.date, mealLabels[String(item.mealType)] ?? item.mealType]
            .filter(Boolean)
            .join(' · '),
          status: String(item.status ?? '待处理'),
          targetPath:
            typeof item.targetPath === 'string' ? item.targetPath : '/kitchen',
        };
      }),
    };
  }
  if (toolName === 'get_weather') {
    const rows = rowsFor('forecasts');
    return {
      kind: 'weather',
      title: record?.city ? `${String(record.city)}天气` : '天气预报',
      emptyText:
        record?.error === 'weather_api_not_configured'
          ? '天气服务尚未配置'
          : '暂时无法取得天气预报',
      targetPath: '/assistant',
      items: rows.slice(0, 5).map((entry) => {
        const item = entry as Record<string, unknown>;
        return {
          id: String(item.date ?? ''),
          title: String(item.date ?? '天气'),
          detail: [item.weather, item.description].filter(Boolean).join(' · '),
          status: `${String(item.temp ?? '-')}°C`,
          targetPath: '/assistant',
        };
      }),
    };
  }
  if (toolName === 'get_member_profile' && record) {
    return {
      kind: 'member-profile',
      title: '成员档案',
      emptyText: '没有找到成员档案',
      targetPath: '/profile',
      items: [
        {
          id: String(record.id ?? ''),
          title:
            `${String(record.avatar ?? '')} ${String(record.name ?? '家庭成员')}`.trim(),
          detail: [record.role, record.responseStyle].filter(Boolean).join(' · '),
          status: record.memoryEnabled ? '记忆已开启' : '记忆未开启',
          targetPath: '/profile',
        },
      ],
    };
  }
  if (toolName === 'get_asset_detail' && record) {
    if (record.error) return null;
    const categoryLabels: Record<string, string> = {
      appliance: '家电',
      furniture: '家具',
      electronics: '数码',
      tool: '工具',
      other: '其他',
    };
    const warrantyStatus =
      record.warrantyStatus === 'active'
        ? Number(record.warrantyDaysRemaining) === 0
          ? '在保 · 今日到期'
          : `在保 · 剩余 ${String(record.warrantyDaysRemaining)} 天`
        : record.warrantyStatus === 'expired'
          ? `已过保 ${String(record.warrantyDaysExpired)} 天`
          : '未记录保修信息';
    const targetPath = `/asset/${String(record.id ?? '')}`;
    return {
      kind: 'asset-detail',
      title: '资产详情',
      emptyText: '没有找到资产详情',
      targetPath,
      items: [
        {
          id: String(record.id ?? ''),
          title: String(record.name ?? '未命名资产'),
          detail: [
            categoryLabels[String(record.category)] ?? record.category,
            record.location,
            record.brandModel,
          ]
            .filter(Boolean)
            .join(' · '),
          status: warrantyStatus,
          targetPath,
        },
      ],
      footer:
        [
          record.expiresAt ? `保修到期 ${String(record.expiresAt)}` : null,
          record.nextMaintenanceAt
            ? `下次维保 ${String(record.nextMaintenanceAt)}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ') || '暂无保修和维保日期',
    };
  }
  if (toolName === 'get_finance_summary' && record) {
    const rows = rowsFor('accounts');
    return {
      kind: 'finance',
      title: `${String(record.month ?? '本月')}家庭财务`,
      emptyText: '还没有建立家庭财务账户',
      targetPath: '/finance',
      items: rows.slice(0, 8).map((entry) => {
        const item = entry as Record<string, unknown>;
        return {
          id: String(item.id ?? ''),
          title: String(item.name ?? '未命名账户'),
          detail: `余额 ¥${Number(item.balance ?? 0).toFixed(2)}`,
          status: item.isActive === false ? '已停用' : '使用中',
          targetPath: '/finance',
        };
      }),
    };
  }
  return null;
}

function outputItemCount(output: unknown) {
  if (Array.isArray(output)) return output.length;
  if (!output || typeof output !== 'object') return output == null ? 0 : 1;
  const record = output as Record<string, unknown>;
  for (const key of [
    'tasks',
    'events',
    'items',
    'recipes',
    'plans',
    'forecasts',
  ]) {
    if (Array.isArray(record[key])) return record[key].length;
  }
  return 1;
}

@Injectable()
export class AgentToolsService {
  /** 30 个工具（J4.1，apps/api/src/agent/tools/）；MCP 控制器按它注册，内置运行时经 execute 调。 */
  readonly registry: ToolRegistry<AgentToolContext>;

  constructor(
    @InjectRepository(AgentRun) private readonly runs: Repository<AgentRun>,
    @InjectRepository(AgentToolEvent)
    private readonly events: Repository<AgentToolEvent>,
    private readonly eventBus: EventBus,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    @InjectRepository(AgentMemberProfile)
    memberProfiles: Repository<AgentMemberProfile>,
    proposals: AgentProposalsService,
    proposalGroups: AgentProposalGroupsService,
    agentMemory: AgentMemoryService,
    facades: PluginFacadeRegistry,
    private readonly dataSource: DataSource,
  ) {
    this.registry = createAgentToolRegistry({
      facades,
      members,
      memberProfiles,
      toolEvents: events,
      proposals,
      proposalGroups,
      agentMemory,
    });
  }

  /**
   * MCP、内置运行时与 native 循环共用的执行入口：鉴权（run 状态、授权名单、成员能力）→ 执行 → 落 agent_tool_events。
   * forModel=true（native 循环）时提案工具只返回 { proposalId }，调用记录里存的仍是完整提案。
   */
  async execute(
    toolName: string,
    input: Record<string, unknown>,
    options: { forModel?: boolean } = {},
  ): Promise<unknown> {
    if (!this.registry.get(toolName)) {
      throw new BadRequestException('未开放的智能体工具');
    }
    const runId = typeof input.runId === 'string' ? input.runId : '';
    const run = await this.runs.findOneBy({ id: runId });
    if (!run) throw new NotFoundException('智能体运行不存在');
    if (run.status !== 'running') {
      throw new ForbiddenException('智能体运行当前不可调用工具');
    }
    if (run.authorizationExpiresAt.getTime() <= Date.now()) {
      throw new ForbiddenException('智能体工具授权已过期');
    }
    if (!run.allowedTools.includes(toolName)) {
      throw new ForbiddenException('本次运行未授权这个工具');
    }
    const member = await this.members.findOne({
      where: { id: run.requestedByMemberId, householdId: run.householdId },
    });
    if (!member || member.disabledAt) {
      throw new ForbiddenException('发起成员已停用');
    }
    const user = userFor(run, member);
    // J4.2：授权名单之外再按家庭当前的模块开关与发起成员当前的能力核一遍（开会话后才关掉的也拦得住）
    const access = toolAccess(
      this.registry.resolve(toolName)!,
      await modulesTurnedOff(this.dataSource, run.householdId),
      (capability) => hasCapability(user, capability as Capability),
    );
    if (access === 'module_off') throw new ForbiddenException('这个模块已被家庭关闭');
    if (access === 'no_capability') throw new ForbiddenException('当前家庭角色不能使用这个工具');

    const startedAt = new Date();
    try {
      const { output, modelOutput } = await this.callTool(toolName, input, user, run);
      const serialized = JSON.stringify(output);
      if (Buffer.byteLength(serialized, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new BadRequestException('工具返回内容超过大小限制');
      }
      await this.saveEvent(run, toolName, input, 'completed', output, startedAt);
      // 工具调用是运行进度：推 assistant 让对话页刷新（原来客户端按 700ms 轮询）
      this.eventBus.publish({ householdId: run.householdId, domains: ['assistant'] });
      return options.forModel ? modelOutput : output;
    } catch (error) {
      await this.saveEvent(run, toolName, input, 'failed', null, startedAt);
      // 工具调用是运行进度：推 assistant 让对话页刷新（原来客户端按 700ms 轮询）
      this.eventBus.publish({ householdId: run.householdId, domains: ['assistant'] });
      throw error;
    }
  }

  /**
   * 经注册表执行：参数按工具的 zod 校验（MCP 入口已按同一份 schema 校验过）。
   * 提案工具交给模型的只有 proposalId；这里收下工具交出的完整提案原样返回，Hermes 看到的与 J4.1 前一致。
   */
  private async callTool(
    toolName: string,
    input: Record<string, unknown>,
    user: JwtUser,
    run: AgentRun,
  ) {
    const { runId: _runId, ...args } = input;
    let presented: unknown;
    try {
      const outcome = await this.registry.invoke(
        toolName,
        { user, run, onProposal: (value) => (presented = value) },
        args,
      );
      return outcome.kind === 'propose'
        ? { output: presented, modelOutput: outcome.result }
        : { output: outcome.result, modelOutput: outcome.result };
    } catch (error) {
      if (error instanceof ToolInvocationError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  /**
   * native 循环的工具执行：runId 由运行时给（模型传的同名参数被覆盖），走 execute 同一条路；
   * 出错不抛，变成 ok=false 的结果交回模型（agent-core 的 ToolOutcome）。
   */
  async executeForLoop(toolName: string, runId: string, rawArgs: unknown): Promise<ToolOutcome> {
    let args: unknown = rawArgs;
    if (typeof rawArgs === 'string') {
      try {
        args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
      } catch {
        return { ok: false, error: { code: 'invalid_arguments', message: '参数不是合法的 JSON' } };
      }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return { ok: false, error: { code: 'invalid_arguments', message: '参数必须是一个对象' } };
    }
    try {
      const result = await this.execute(toolName, { ...(args as Record<string, unknown>), runId }, { forModel: true });
      return this.registry.get(toolName)?.kind === 'propose'
        ? { ok: true, kind: 'propose', result: result as { proposalId: string } }
        : { ok: true, kind: 'read', result };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: error instanceof ForbiddenException ? 'tool_not_allowed' : 'tool_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async saveEvent(
    run: AgentRun,
    toolName: string,
    input: Record<string, unknown>,
    status: 'completed' | 'failed',
    output: unknown,
    startedAt: Date,
  ) {
    // 插件认领的工具，来源模块取 keys.ts 别名表（pluginToolSources）；内核工具取 contracts/plugins/core-assistant.ts
    const sourceModule: Record<string, string> = { ...pluginToolSources(), ...CORE_TOOL_SOURCES };
    const presentation =
      status === 'completed' ? resultPresentation(toolName, output) : null;
    const encryptedPresentation = presentation
      ? encryptAgentContent(
          JSON.stringify(presentation),
          run.householdId,
          run.conversationId,
        )
      : null;
    await this.events.save(
      this.events.create({
        householdId: run.householdId,
        runId: run.id,
        toolName,
        sourceModule: sourceModule[toolName] ?? 'agent',
        sourceId:
          typeof input.assetId === 'string'
            ? input.assetId
            : typeof input.travelPlanId === 'string'
              ? input.travelPlanId
              : null,
        status,
        inputSummary: {
          hasQuery: Boolean(input.query),
          start: typeof input.start === 'string' ? input.start : null,
          end: typeof input.end === 'string' ? input.end : null,
          startDate:
            typeof input.startDate === 'string' ? input.startDate : null,
          limit: typeof input.limit === 'number' ? input.limit : null,
        },
        outputSummary: {
          itemCount: outputItemCount(output),
          ok: status === 'completed',
          errorCode:
            output &&
            typeof output === 'object' &&
            !Array.isArray(output) &&
            typeof (output as Record<string, unknown>).error === 'string'
              ? (output as Record<string, unknown>).error
              : null,
        },
        presentationCiphertext:
          encryptedPresentation?.contentCiphertext ?? null,
        presentationNonce: encryptedPresentation?.contentNonce ?? null,
        presentationVersion: encryptedPresentation?.contentVersion ?? null,
        startedAt,
        finishedAt: new Date(),
      }),
    );
  }
}
