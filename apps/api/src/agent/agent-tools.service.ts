import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import { CalendarService } from '../calendar/calendar.module';
import {
  AgentRun,
  AgentToolEvent,
  InventoryItem,
  Member,
} from '../entities';
import { KnowledgeService } from '../knowledge/knowledge.module';
import { MediaService } from '../media/media.module';
import { MemoriesService } from '../memories/memories.module';
import { MenusService } from '../menus/menus.module';
import { ShoppingService } from '../shopping/shopping.module';
import { TasksService } from '../tasks/tasks.module';
import { TravelService } from '../travel/travel.module';
import {
  AGENT_MEMORY_KEYS,
  AGENT_READ_TOOLS,
  AgentMemoryKey,
  AgentReadToolName,
  AgentToolName,
  isAgentMemoryTool,
} from './agent.types';
import {
  AgentProposalsService,
  isAgentProposalTool,
} from './agent-proposals.service';
import { encryptAgentContent } from './agent.crypto';
import { AgentMemoryService } from './agent-memory.service';

const MAX_RESULT_ITEMS = 20;
const MAX_RESPONSE_BYTES = 48_000;

function dateOnly(value: unknown, fallback: string) {
  const normalized = typeof value === 'string' ? value : fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new BadRequestException('日期必须使用 YYYY-MM-DD 格式');
  }
  return normalized;
}

function limited(value: unknown, fallback = 10) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_RESULT_ITEMS);
}

function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

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
  if (!Array.isArray(output)) return null;
  if (toolName === 'get_tasks') {
    return {
      kind: 'tasks',
      title: '家庭任务',
      emptyText: '这段时间没有待办任务',
      targetPath: '/tasks',
      items: output.slice(0, 8).map((entry) => {
        const item = entry as Record<string, unknown>;
        return {
          id: String(item.id ?? ''),
          title: String(item.title ?? '未命名任务'),
          detail: [item.dueDate, item.assigneeName].filter(Boolean).join(' · '),
          status: item.status === 'completed' ? '已完成' : '待完成',
          targetPath: typeof item.targetPath === 'string' ? item.targetPath : '/tasks',
        };
      }),
    };
  }
  if (toolName === 'get_shopping_list') {
    return {
      kind: 'shopping',
      title: '购物清单',
      emptyText: '购物清单已经处理完了',
      targetPath: '/shopping',
      items: output.slice(0, 8).map((entry) => {
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
      items: output.slice(0, 3).map((entry) => {
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
  return null;
}

@Injectable()
export class AgentToolsService {
  constructor(
    @InjectRepository(AgentRun) private readonly runs: Repository<AgentRun>,
    @InjectRepository(AgentToolEvent)
    private readonly events: Repository<AgentToolEvent>,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    @InjectRepository(InventoryItem)
    private readonly inventory: Repository<InventoryItem>,
    private readonly calendar: CalendarService,
    private readonly knowledge: KnowledgeService,
    private readonly travel: TravelService,
    private readonly media: MediaService,
    private readonly memories: MemoriesService,
    private readonly menus: MenusService,
    private readonly shopping: ShoppingService,
    private readonly tasks: TasksService,
    private readonly proposals: AgentProposalsService,
    private readonly agentMemory: AgentMemoryService,
  ) {}

  async execute(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    if (
      !AGENT_READ_TOOLS.includes(toolName as AgentReadToolName) &&
      !isAgentProposalTool(toolName) &&
      !isAgentMemoryTool(toolName)
    ) {
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

    const startedAt = new Date();
    const user = userFor(run, member);
    try {
      const output = await this.callTool(toolName as AgentToolName, input, user, run);
      const serialized = JSON.stringify(output);
      if (Buffer.byteLength(serialized, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new BadRequestException('工具返回内容超过大小限制');
      }
      await this.saveEvent(run, toolName, input, 'completed', output, startedAt);
      return output;
    } catch (error) {
      await this.saveEvent(run, toolName, input, 'failed', null, startedAt);
      throw error;
    }
  }

  private async callTool(
    toolName: AgentToolName,
    input: Record<string, unknown>,
    user: JwtUser,
    run: AgentRun,
  ) {
    if (isAgentProposalTool(toolName)) {
      return this.proposals.createFromRun(toolName, input, run, user);
    }
    if (isAgentMemoryTool(toolName)) {
      if (toolName === 'recall_preferences') {
        const memoryKey =
          typeof input.memoryKey === 'string' &&
          AGENT_MEMORY_KEYS.includes(input.memoryKey as AgentMemoryKey)
            ? (input.memoryKey as AgentMemoryKey)
            : undefined;
        if (input.memoryKey != null && !memoryKey) {
          throw new BadRequestException('不支持的记忆分类键');
        }
        return this.agentMemory.search(
          {
            scope:
              input.scope === 'household' ? 'household' : 'member_private',
            memoryKey,
            limit: limited(input.limit),
          },
          user,
        );
      }
      return this.agentMemory.createCandidate(
        {
          content: typeof input.content === 'string' ? input.content : '',
          memoryKey: input.memoryKey as AgentMemoryKey,
          sourceType: 'agent_tool',
          sourceId: run.id,
          sourceConversationId: run.conversationId,
          confidenceSource: 'summary_candidate',
        },
        user,
      );
    }
    if (toolName === 'get_today_summary') {
      const date = today();
      const [entries, alerts] = await Promise.all([
        this.calendar.list(date, date, user),
        this.inventoryAlerts(user.householdId, 8),
      ]);
      return {
        date,
        entries: entries.slice(0, MAX_RESULT_ITEMS).map((entry) => ({
          module: entry.module,
          date: entry.date,
          title: entry.title,
          status: entry.status,
          summary: entry.summary ? String(entry.summary).slice(0, 200) : null,
          targetPath: entry.targetPath,
        })),
        inventoryAlerts: alerts,
      };
    }
    if (toolName === 'get_calendar') {
      const start = dateOnly(input.start, today());
      const end = dateOnly(input.end, addDays(start, 6));
      const days = Math.round(
        (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
          86_400_000,
      );
      if (days < 0 || days > 31) {
        throw new BadRequestException('智能体日历单次最多查询 32 天');
      }
      const entries = await this.calendar.list(start, end, user);
      return entries.slice(0, MAX_RESULT_ITEMS).map((entry) => ({
        module: entry.module,
        date: entry.date,
        title: entry.title,
        status: entry.status,
        summary: entry.summary ? String(entry.summary).slice(0, 200) : null,
        targetPath: entry.targetPath,
      }));
    }
    if (toolName === 'get_tasks') {
      const start = dateOnly(input.start, today());
      const end = dateOnly(input.end, addDays(start, 6));
      const days = Math.round(
        (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
          86_400_000,
      );
      if (days < 0 || days > 31) {
        throw new BadRequestException('智能体任务单次最多查询 32 天');
      }
      const includeCompleted = input.includeCompleted === true;
      const rows = await this.tasks.list(start, end, user);
      return rows
        .filter((row) => includeCompleted || row.status === 'pending')
        .slice(0, limited(input.limit))
        .map((row) => ({
          id: row.id,
          taskId: row.taskId,
          title: row.task.title,
          dueDate: row.dueDate,
          status: row.status,
          assigneeName: row.assignee?.name ?? row.task.defaultAssignee?.name ?? null,
          rewardPoints: row.task.rewardPoints,
          targetPath: `/tasks?date=${row.dueDate}&taskId=${row.taskId}`,
        }));
    }
    if (toolName === 'get_shopping_list') {
      const date = dateOnly(input.date, today());
      const includeChecked = input.includeChecked === true;
      const rows = await this.shopping.list(user.householdId, date);
      return rows
        .filter((row) => includeChecked || !row.checked)
        .slice(0, limited(input.limit))
        .map((row) => ({
          id: row.id,
          date: row.date,
          name: row.ingredient?.name ?? row.customName ?? '未命名采购项',
          quantity: row.totalQty == null ? null : Number(row.totalQty),
          unit: row.unit,
          checked: row.checked,
          source: row.source,
          inventoryLinked: row.inventoryItemId != null,
          targetPath: `/shopping?date=${row.date}`,
        }));
    }
    if (toolName === 'get_meal_plan') {
      const date = dateOnly(input.date, today());
      const menus = await this.menus.listExistingByDate(user.householdId, date);
      const mealOrder = { breakfast: 0, lunch: 1, dinner: 2 } as const;
      return menus
        .sort((left, right) => mealOrder[left.mealType] - mealOrder[right.mealType])
        .map((menu) => ({
          id: menu.id,
          date: menu.date,
          mealType: menu.mealType,
          status: menu.status,
          chefName: menu.chef?.name ?? null,
          items: menu.items
            .filter((item) => item.status !== 'rejected')
            .slice(0, MAX_RESULT_ITEMS)
            .map((item) => ({
              id: item.id,
              dishName: item.dish.name,
              status: item.status,
              requestedByName: item.requestedBy.name,
              assignedToName: item.assignedTo?.name ?? null,
            })),
          targetPath: `/kitchen?date=${menu.date}&mealType=${menu.mealType}`,
        }));
    }
    if (toolName === 'get_inventory_alerts') {
      return this.inventoryAlerts(user.householdId, limited(input.limit));
    }
    if (toolName === 'search_knowledge') {
      const query = typeof input.query === 'string' ? input.query.trim().slice(0, 80) : '';
      const rows = await this.knowledge.list(
        { status: 'active', q: query || undefined, limit: limited(input.limit) },
        user,
      );
      return rows.map((article) => ({
        id: article.id,
        title: article.title,
        category: article.category,
        summary: article.summary?.slice(0, 300) ?? null,
        tags: article.tags,
        referenceUrl: article.referenceUrl,
        targetPath: `/knowledge?articleId=${article.id}`,
        untrustedContent: true,
      }));
    }
    if (toolName === 'get_travel_checklist') {
      const planId = typeof input.travelPlanId === 'string' ? input.travelPlanId : '';
      const plan = planId
        ? await this.travel.detail(planId, user)
        : (await this.travel.listPlans({ status: 'active' }, user))[0];
      if (!plan) return null;
      return {
        id: plan.id,
        title: plan.title,
        destination: plan.destination,
        startDate: plan.startDate,
        endDate: plan.endDate,
        status: plan.status,
        items: plan.items.slice(0, MAX_RESULT_ITEMS).map((item) => ({
          id: item.id,
          title: item.title,
          category: item.category,
          quantity: item.quantity,
          status: item.status,
          assignedMemberName: item.assignedMember?.name ?? null,
        })),
        targetPath: `/travel?planId=${plan.id}`,
      };
    }
    if (toolName === 'get_watch_candidates') {
      const rows = await this.media.list({ status: 'all' }, user);
      return rows
        .filter((entry) => !['completed', 'dropped'].includes(entry.status))
        .slice(0, limited(input.limit))
        .map((entry) => ({
          id: entry.id,
          title: entry.mediaTitle.title,
          type: entry.mediaTitle.type,
          year: entry.mediaTitle.year,
          status: entry.status,
          scheduledFor: entry.scheduledFor,
          targetPath: `/media?mediaId=${entry.id}`,
        }));
    }
    const rows = await this.memories.list(
      { status: 'active', limit: limited(input.limit) },
      user,
    );
    return rows.map((memory) => ({
      id: memory.id,
      title: memory.title,
      happenedOn: memory.happenedOn,
      category: memory.category,
      tags: memory.tags,
      targetPath: `/memories?memoryId=${memory.id}`,
      untrustedContent: true,
    }));
  }

  private async inventoryAlerts(householdId: string, limit: number) {
    const rows = await this.inventory
      .createQueryBuilder('item')
      .where('item.householdId = :householdId', { householdId })
      .andWhere('item.quantity <= item.lowStockThreshold')
      .orderBy('item.quantity', 'ASC')
      .addOrderBy('item.name', 'ASC')
      .take(limit)
      .getMany();
    return rows.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: Number(item.quantity),
      unit: item.unit,
      lowStockThreshold: Number(item.lowStockThreshold),
      targetPath: '/shopping',
    }));
  }

  private async saveEvent(
    run: AgentRun,
    toolName: string,
    input: Record<string, unknown>,
    status: 'completed' | 'failed',
    output: unknown,
    startedAt: Date,
  ) {
    const sourceModule: Record<string, string> = {
      get_today_summary: 'calendar',
      get_calendar: 'calendar',
      get_tasks: 'task',
      get_shopping_list: 'shopping',
      get_meal_plan: 'menu',
      get_inventory_alerts: 'inventory',
      search_knowledge: 'knowledge',
      get_travel_checklist: 'travel',
      get_watch_candidates: 'media',
      get_recent_memories: 'memory',
      recall_preferences: 'agent_memory',
      remember_preference: 'agent_memory',
      propose_task: 'task',
      propose_reminder: 'reminder',
      propose_poll: 'poll',
      propose_menu: 'menu',
      propose_shopping_items: 'shopping',
    };
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
          typeof input.travelPlanId === 'string' ? input.travelPlanId : null,
        status,
        inputSummary: {
          hasQuery: Boolean(input.query),
          start: typeof input.start === 'string' ? input.start : null,
          end: typeof input.end === 'string' ? input.end : null,
          limit: typeof input.limit === 'number' ? input.limit : null,
        },
        outputSummary: {
          itemCount: Array.isArray(output) ? output.length : output ? 1 : 0,
          ok: status === 'completed',
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
