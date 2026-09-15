import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssetsService } from '../assets/assets.module';
import { JwtUser } from '../auth/jwt.guard';
import { CalendarService } from '../calendar/calendar.module';
import { openweatherApiKey, openweatherBaseUrl } from '../common/config';
import {
  AgentMemberProfile,
  AgentRun,
  AgentToolEvent,
  Dish,
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
import { FinanceService } from '../finance/finance.module';
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
import { AgentProposalGroupsService } from './agent-proposal-groups.service';
import { addDays, daysBetween, todayInShanghai } from '@family/shared';

const MAX_RESULT_ITEMS = 20;
const MAX_EXTENDED_RESULT_ITEMS = 50;
const MAX_RESPONSE_BYTES = 48_000;
const SEARCH_RECIPES_RUN_LIMIT = 2;
const SEARCH_RECIPES_LIMIT_ERROR = 'recipe_search_limit_reached';

function dateOnly(value: unknown, fallback: string) {
  const normalized = typeof value === 'string' ? value : fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new BadRequestException('日期必须使用 YYYY-MM-DD 格式');
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw new BadRequestException('日期不是有效的日历日期');
  }
  return normalized;
}

function limited(value: unknown, fallback = 10) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_RESULT_ITEMS);
}

function boundedInteger(
  value: unknown,
  fallback: number,
  maximum: number,
  label: string,
) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new BadRequestException(`${label}必须是 1 到 ${maximum} 之间的整数`);
  }
  return parsed;
}

function normalizedTerms(value: unknown, maximum: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toLocaleLowerCase('zh-CN'))
    .filter(Boolean)
    .slice(0, maximum);
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
  constructor(
    @InjectRepository(AgentRun) private readonly runs: Repository<AgentRun>,
    @InjectRepository(AgentToolEvent)
    private readonly events: Repository<AgentToolEvent>,
    @InjectRepository(Member) private readonly members: Repository<Member>,
    @InjectRepository(AgentMemberProfile)
    private readonly memberProfiles: Repository<AgentMemberProfile>,
    @InjectRepository(Dish) private readonly dishes: Repository<Dish>,
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
    private readonly proposalGroups: AgentProposalGroupsService,
    private readonly agentMemory: AgentMemoryService,
    private readonly finance: FinanceService,
    private readonly assets: AssetsService,
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
    if (toolName === 'propose_plan') {
      return this.proposalGroups.createFromRun(input, run, user);
    }
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
      const date = todayInShanghai();
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
      const start = dateOnly(input.start, todayInShanghai());
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
      const start = dateOnly(input.start, todayInShanghai());
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
    if (toolName === 'get_member_tasks') {
      const memberId =
        typeof input.memberId === 'string' ? input.memberId : user.memberId;
      const member = await this.requireHouseholdMember(memberId, user);
      const status = input.status ?? 'pending';
      if (!['pending', 'completed', 'all'].includes(String(status))) {
        throw new BadRequestException('不支持的任务状态');
      }
      const limit = boundedInteger(
        input.limit,
        20,
        MAX_EXTENDED_RESULT_ITEMS,
        '返回条数',
      );
      const start = addDays(todayInShanghai(), -90);
      const end = addDays(todayInShanghai(), 90);
      const rows = await this.tasks.list(start, end, user);
      const matched = rows.filter((row) => {
        if (row.assigneeId !== member.id) return false;
        if (status === 'pending') return row.status === 'pending';
        if (status === 'completed') return row.status === 'done';
        return true;
      });
      return {
        tasks: matched.slice(0, limit).map((row) => ({
          id: row.id,
          taskId: row.taskId,
          title: row.task.title,
          dueDate: row.dueDate,
          status: row.status === 'done' ? 'completed' : row.status,
          priority: row.task.rewardPoints > 0 ? 'rewarded' : 'normal',
          assignedToMemberId: member.id,
          assignedMemberName: member.name,
          targetPath: `/tasks?date=${row.dueDate}&taskId=${row.taskId}`,
          untrustedContent: true,
        })),
        total: matched.length,
      };
    }
    if (toolName === 'get_family_schedule') {
      const startDate = dateOnly(input.startDate, todayInShanghai());
      const days = boundedInteger(input.days, 7, 30, '查询天数');
      const endDate = addDays(startDate, days - 1);
      const entries = await this.calendar.list(startDate, endDate, user);
      return {
        events: entries.slice(0, MAX_EXTENDED_RESULT_ITEMS).map((entry) => {
          const metadata = entry.metadata as Record<string, unknown>;
          const participants = [
            metadata.createdByName,
            metadata.assigneeName,
            metadata.hostMemberName,
          ].filter(
            (value): value is string =>
              typeof value === 'string' && Boolean(value),
          );
          return {
            id: entry.id,
            title: entry.title,
            eventDate: entry.date,
            date: entry.date,
            eventType: entry.module,
            participants: [...new Set(participants)],
            status: entry.status,
            summary: entry.summary ? String(entry.summary).slice(0, 200) : null,
            targetPath: entry.targetPath,
            untrustedContent: true,
          };
        }),
        total: entries.length,
      };
    }
    if (toolName === 'get_inventory_summary') {
      const filter = input.filter ?? 'low_stock';
      if (!['low_stock', 'expiring_soon', 'all'].includes(String(filter))) {
        throw new BadRequestException('不支持的库存过滤条件');
      }
      return this.inventorySummary(user.householdId, String(filter));
    }
    if (toolName === 'get_shopping_list') {
      const date = dateOnly(input.date, todayInShanghai());
      const status = input.status;
      if (
        status != null &&
        !['pending', 'purchased', 'all'].includes(String(status))
      ) {
        throw new BadRequestException('不支持的购物清单状态');
      }
      const includeChecked = input.includeChecked === true || status === 'all';
      const rows = await this.shopping.list(user.householdId, date);
      return rows
        .filter((row) => {
          if (status === 'pending') return !row.checked;
          if (status === 'purchased') return row.checked;
          return includeChecked || !row.checked;
        })
        .slice(0, limited(input.limit))
        .map((row) => ({
          id: row.id,
          date: row.date,
          name: row.ingredient?.name ?? row.customName ?? '未命名采购项',
          quantity: row.totalQty == null ? null : Number(row.totalQty),
          unit: row.unit,
          checked: row.checked,
          status: row.checked ? 'purchased' : 'pending',
          source: row.source,
          inventoryLinked: row.inventoryItemId != null,
          targetPath: `/shopping?date=${row.date}`,
          untrustedContent: true,
        }));
    }
    if (toolName === 'search_recipes') {
      const searchCount = await this.events.countBy({
        runId: run.id,
        toolName: 'search_recipes',
      });
      if (searchCount >= SEARCH_RECIPES_RUN_LIMIT) {
        return {
          error: SEARCH_RECIPES_LIMIT_ERROR,
          message:
            '本次对话已达菜谱搜索上限，请基于已有搜索结果继续规划',
          recipes: [],
          total: 0,
        };
      }
      return this.searchRecipes(input, user);
    }
    if (toolName === 'get_dish_plan') {
      const startDate = dateOnly(input.startDate, todayInShanghai());
      const days = boundedInteger(input.days, 7, 30, '查询天数');
      const dates = Array.from({ length: days }, (_, index) =>
        addDays(startDate, index),
      );
      const menuGroups = await Promise.all(
        dates.map((date) =>
          this.menus.listExistingByDate(user.householdId, date),
        ),
      );
      const plans = menuGroups
        .flat()
        .flatMap((menu) =>
          menu.items
            .filter((item) => item.status !== 'rejected')
            .map((item) => ({
              id: item.id,
              date: menu.date,
              mealType: menu.mealType,
              recipeName: item.dish.name,
              recipeId: item.dishId,
              recipeVariantId: item.recipeVariantId,
              status: item.status,
              requestedByMemberId: item.requestedById,
              targetPath: `/kitchen?date=${menu.date}&mealType=${menu.mealType}`,
              untrustedContent: true,
            })),
        );
      return {
        plans: plans.slice(0, MAX_EXTENDED_RESULT_ITEMS),
        total: plans.length,
      };
    }
    if (toolName === 'get_weather') {
      return this.weatherForecast(input);
    }
    if (toolName === 'get_member_profile') {
      const memberId =
        typeof input.memberId === 'string' ? input.memberId : user.memberId;
      const member = await this.requireHouseholdMember(memberId, user);
      const profile = await this.memberProfiles.findOneBy({
        householdId: user.householdId,
        memberId: member.id,
      });
      return {
        id: member.id,
        name: member.name,
        role: member.role,
        avatar: member.avatarEmoji,
        prefersCooking: member.prefersCooking,
        assistantName: profile?.assistantName ?? null,
        memoryEnabled: profile?.memoryEnabled ?? null,
        responseStyle: profile?.responseStyle ?? null,
        untrustedContent: true,
      };
    }
    if (toolName === 'get_asset_detail') {
      const assetId =
        typeof input.assetId === 'string' ? input.assetId.trim() : '';
      if (!assetId) {
        return {
          error: 'asset_id_required',
          message: '缺少 assetId，请先确认用户指的是哪件资产，不得自行选择',
        };
      }
      const asset = await this.assets.get(assetId, user.householdId);
      const expiresAt = asset.warrantyExpiresOn;
      const warrantyDelta = expiresAt
        ? daysBetween(todayInShanghai(), expiresAt)
        : null;
      const nextMaintenanceAt = asset.maintenancePlans
        .filter((plan) => plan.isEnabled)
        .map((plan) => plan.nextDueDate)
        .sort()[0] ?? null;
      return {
        id: asset.id,
        name: asset.name,
        category: asset.category,
        status: asset.status,
        location: asset.location,
        brand: asset.brand,
        model: asset.model,
        brandModel: [asset.brand, asset.model].filter(Boolean).join(' ') || null,
        purchaseDate: asset.purchaseDate,
        expiresAt,
        warrantyStatus:
          warrantyDelta == null
            ? 'unknown'
            : warrantyDelta >= 0
              ? 'active'
              : 'expired',
        isUnderWarranty:
          warrantyDelta == null ? null : warrantyDelta >= 0,
        warrantyDaysRemaining:
          warrantyDelta != null && warrantyDelta >= 0 ? warrantyDelta : null,
        warrantyDaysExpired:
          warrantyDelta != null && warrantyDelta < 0
            ? Math.abs(warrantyDelta)
            : null,
        nextMaintenanceAt,
        targetPath: `/asset/${asset.id}`,
        untrustedContent: true,
      };
    }
    if (toolName === 'get_finance_summary') {
      const month = typeof input.month === 'string' ? input.month : undefined;
      return this.finance.summary(month, user);
    }
    if (toolName === 'get_meal_plan') {
      const date = dateOnly(input.date, todayInShanghai());
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
      const planId =
        typeof input.travelPlanId === 'string' ? input.travelPlanId.trim() : '';
      if (!planId) {
        return {
          error: 'travel_plan_id_required',
          message: '缺少 travelPlanId，请先确认用户指的是哪个行程，不得自行选择',
        };
      }
      const plan = await this.travel.detail(planId, user);
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

  private async requireHouseholdMember(memberId: string, user: JwtUser) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        memberId,
      )
    ) {
      throw new BadRequestException('成员 ID 格式无效');
    }
    const member = await this.members.findOneBy({
      id: memberId,
      householdId: user.householdId,
    });
    if (!member || member.disabledAt) {
      throw new NotFoundException('家庭成员不存在');
    }
    return member;
  }

  private async inventorySummary(householdId: string, filter: string) {
    const rows = await this.inventory
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.batches', 'batch', 'batch.quantity > 0')
      .where('item.householdId = :householdId', { householdId })
      .orderBy('item.name', 'ASC')
      .getMany();
    const expiryBoundary = addDays(todayInShanghai(), 7);
    const matched = rows
      .map((item) => {
        const expiryDates = (item.batches ?? [])
          .filter((batch) => Number(batch.quantity) > 0 && batch.expiresOn)
          .map((batch) => batch.expiresOn as string)
          .sort();
        const expiresAt = expiryDates[0] ?? null;
        const lowStock = Number(item.quantity) <= Number(item.lowStockThreshold);
        const expiringSoon = expiresAt != null && expiresAt <= expiryBoundary;
        return {
          id: item.id,
          name: item.name,
          quantity: Number(item.quantity),
          unit: item.unit,
          lowStockThreshold: Number(item.lowStockThreshold),
          expiresAt,
          alert:
            lowStock && expiringSoon
              ? 'low_stock_and_expiring'
              : lowStock
                ? 'low_stock'
                : expiringSoon
                  ? 'expiring_soon'
                  : 'normal',
          targetPath: '/shopping',
          lowStock,
          expiringSoon,
        };
      })
      .filter((item) => {
        if (filter === 'low_stock') return item.lowStock;
        if (filter === 'expiring_soon') return item.expiringSoon;
        return true;
      });
    return {
      items: matched
        .slice(0, MAX_EXTENDED_RESULT_ITEMS)
        .map((item) => ({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          lowStockThreshold: item.lowStockThreshold,
          expiresAt: item.expiresAt,
          alert: item.alert,
          targetPath: item.targetPath,
          untrustedContent: true,
        })),
      total: matched.length,
    };
  }

  private async searchRecipes(
    input: Record<string, unknown>,
    user: JwtUser,
  ) {
    const query =
      typeof input.query === 'string'
        ? input.query.trim().toLocaleLowerCase('zh-CN').slice(0, 80)
        : '';
    const ingredients = normalizedTerms(input.ingredients, 10);
    const tags = normalizedTerms(input.tags, 10);
    const limit = boundedInteger(
      input.limit,
      10,
      MAX_EXTENDED_RESULT_ITEMS,
      '返回条数',
    );
    const dishes = await this.dishes
      .createQueryBuilder('dish')
      .leftJoinAndSelect('dish.ingredients', 'dishIngredient')
      .leftJoinAndSelect('dishIngredient.ingredient', 'dishIngredientEntity')
      .leftJoinAndSelect('dish.recipeVariants', 'recipeVariant')
      .leftJoinAndSelect('recipeVariant.ingredients', 'variantIngredient')
      .leftJoinAndSelect('variantIngredient.ingredient', 'variantIngredientEntity')
      .where('dish.householdId = :householdId', {
        householdId: user.householdId,
      })
      .andWhere('dish.isActive = true')
      .orderBy('dish.createdAt', 'DESC')
      .getMany();
    const matches = dishes
      .map((dish) => {
        const variants = (dish.recipeVariants ?? []).filter(
          (variant) => !variant.isArchived,
        );
        const ingredientNames = [
          ...(dish.ingredients ?? []).map((entry) => entry.ingredient.name),
          ...variants.flatMap((variant) =>
            (variant.ingredients ?? []).map((entry) => entry.ingredient.name),
          ),
        ];
        const normalizedIngredientNames = ingredientNames.map((name) =>
          name.toLocaleLowerCase('zh-CN'),
        );
        const haystack = [
          dish.name,
          dish.category,
          ...variants.map((variant) => variant.name),
          ...ingredientNames,
        ]
          .join('\n')
          .toLocaleLowerCase('zh-CN');
        if (query && !haystack.includes(query)) return null;
        if (
          ingredients.some(
            (term) =>
              !normalizedIngredientNames.some((name) => name.includes(term)),
          )
        ) {
          return null;
        }
        const category = dish.category.toLocaleLowerCase('zh-CN');
        if (tags.some((tag) => !category.includes(tag))) return null;
        const preferredVariant =
          variants.find((variant) => variant.isDefault) ?? variants[0];
        return {
          id: dish.id,
          name: dish.name,
          category: dish.category,
          cookingTime: preferredVariant?.estMinutes ?? dish.estMinutes,
          difficulty: dish.difficulty,
          tags: [dish.category],
          ingredients: [...new Set(ingredientNames)].slice(0, 20),
          defaultRecipeVariantId: preferredVariant?.id ?? null,
          targetPath: `/kitchen?dishId=${dish.id}`,
          untrustedContent: true,
        };
      })
      .filter((dish): dish is NonNullable<typeof dish> => dish != null);
    return { recipes: matches.slice(0, limit), total: matches.length };
  }

  private async weatherForecast(input: Record<string, unknown>) {
    const city =
      typeof input.city === 'string' && input.city.trim()
        ? input.city.trim().slice(0, 80)
        : '深圳';
    const days = boundedInteger(input.days, 3, 5, '预报天数');
    const apiKey = openweatherApiKey();
    if (!apiKey) return { error: 'weather_api_not_configured' };

    try {
      const url = new URL(`${openweatherBaseUrl()}/forecast`);
      url.searchParams.set('q', city);
      url.searchParams.set('cnt', String(days * 8));
      url.searchParams.set('appid', apiKey);
      url.searchParams.set('units', 'metric');
      url.searchParams.set('lang', 'zh_cn');
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return { error: 'weather_api_unavailable' };
      const payload = (await response.json()) as Record<string, unknown>;
      const rawEntries = Array.isArray(payload.list) ? payload.list : [];
      const groups = new Map<
        string,
        { temperatures: number[]; weather: string; description: string }
      >();
      for (const rawEntry of rawEntries) {
        if (!rawEntry || typeof rawEntry !== 'object') continue;
        const entry = rawEntry as Record<string, unknown>;
        const date =
          typeof entry.dt_txt === 'string' ? entry.dt_txt.slice(0, 10) : '';
        const main =
          entry.main && typeof entry.main === 'object'
            ? (entry.main as Record<string, unknown>)
            : null;
        const temperature = Number(main?.temp);
        const weatherEntry =
          Array.isArray(entry.weather) &&
          entry.weather[0] &&
          typeof entry.weather[0] === 'object'
            ? (entry.weather[0] as Record<string, unknown>)
            : null;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(temperature)) {
          continue;
        }
        const current = groups.get(date) ?? {
          temperatures: [],
          weather: '',
          description: '',
        };
        current.temperatures.push(temperature);
        if (!current.weather && typeof weatherEntry?.main === 'string') {
          current.weather = weatherEntry.main.slice(0, 80);
        }
        if (!current.description && typeof weatherEntry?.description === 'string') {
          current.description = weatherEntry.description.slice(0, 120);
        }
        groups.set(date, current);
      }
      const forecasts = [...groups.entries()]
        .slice(0, days)
        .map(([date, group]) => ({
          date,
          temp: Number(
            (
              group.temperatures.reduce((sum, value) => sum + value, 0) /
              group.temperatures.length
            ).toFixed(1),
          ),
          minTemp: Number(Math.min(...group.temperatures).toFixed(1)),
          maxTemp: Number(Math.max(...group.temperatures).toFixed(1)),
          weather: group.weather,
          description: group.description,
          untrustedContent: true,
        }));
      if (!forecasts.length) return { error: 'weather_api_unavailable' };
      const payloadCity =
        payload.city && typeof payload.city === 'object'
          ? (payload.city as Record<string, unknown>).name
          : null;
      return {
        city:
          typeof payloadCity === 'string' && payloadCity.trim()
            ? payloadCity.trim().slice(0, 80)
            : city,
        forecasts,
        untrustedContent: true,
      };
    } catch {
      return { error: 'weather_api_unavailable' };
    }
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
      get_member_tasks: 'task',
      get_family_schedule: 'calendar',
      get_inventory_summary: 'inventory',
      search_recipes: 'recipe',
      get_dish_plan: 'menu',
      get_weather: 'weather',
      get_member_profile: 'member',
      get_asset_detail: 'asset',
      recall_preferences: 'agent_memory',
      remember_preference: 'agent_memory',
      propose_task: 'task',
      propose_reminder: 'reminder',
      propose_poll: 'poll',
      propose_menu: 'menu',
      propose_shopping_items: 'shopping',
      propose_plan: 'agent_plan',
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
