import {
  Controller,
  Delete,
  Get,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Public } from '../auth/jwt.guard';
import { agentMcpKey } from '../common/config';
import { AgentToolsService } from './agent-tools.service';
import { AGENT_MEMORY_KEYS } from './agent.types';

function authorized(request: Request) {
  const configured = agentMcpKey();
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
  if (!configured || !supplied) return false;
  const left = Buffer.from(configured, 'utf8');
  const right = Buffer.from(supplied, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function rpcError(response: Response, status: number, message: string) {
  response.status(status).json({
    jsonrpc: '2.0',
    error: { code: status === 405 ? -32000 : -32603, message },
    id: null,
  });
}

@Controller('internal/agent/mcp')
@Public()
export class AgentMcpController {
  constructor(private readonly tools: AgentToolsService) {}

  @Post()
  async handle(@Req() request: Request, @Res() response: Response) {
    if (!authorized(request)) {
      rpcError(response, 401, 'Unauthorized');
      return;
    }
    const server = this.createServer();
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
      response.on('close', () => {
        void transport.close();
        void server.close();
      });
    } catch {
      if (!response.headersSent) rpcError(response, 500, 'Internal server error');
    }
  }

  @Get()
  methodNotAllowedGet(@Res() response: Response) {
    rpcError(response, 405, 'Method not allowed');
  }

  @Delete()
  methodNotAllowedDelete(@Res() response: Response) {
    rpcError(response, 405, 'Method not allowed');
  }

  private createServer() {
    const server = new McpServer({ name: 'family-app', version: '1.0.0' });
    const register = (
      name: string,
      description: string,
      inputSchema: Record<string, z.ZodTypeAny>,
    ) => {
      server.registerTool(
        name,
        { description, inputSchema },
        async (input: Record<string, unknown>) => ({
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(await this.tools.execute(name, input)),
            },
          ],
        }),
      );
    };
    const runId = z.string().uuid().describe('Family App issued short-lived run ID');
    register('get_today_summary', '读取当前家庭的今日事项摘要', { runId });
    register('get_calendar', '读取最多 32 天的家庭日历', {
      runId,
      start: z.string().optional(),
      end: z.string().optional(),
    });
    register('get_tasks', '查询全家所有成员最多 32 天的家庭任务和完成状态；用户询问全家或家庭任务时使用，询问本人任务时应使用 get_member_tasks', {
      runId,
      start: z.string().optional(),
      end: z.string().optional(),
      includeCompleted: z.boolean().optional(),
      limit: z.number().int().min(1).max(20).optional(),
    });
    register('get_shopping_list', '读取指定日期的家庭购物清单', {
      runId,
      date: z.string().optional(),
      includeChecked: z.boolean().optional(),
      status: z.enum(['pending', 'purchased', 'all']).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    });
    register('get_meal_plan', '读取指定日期已有的家庭三餐菜单', {
      runId,
      date: z.string().optional(),
    });
    register('get_inventory_alerts', '读取当前家庭的低库存提醒', {
      runId,
      limit: z.number().int().min(1).max(20).optional(),
    });
    register('search_knowledge', '搜索家庭知识库的标题与摘要', {
      runId,
      query: z.string().max(80).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    });
    register('get_travel_checklist', '读取计划中行程的协作清单', {
      runId,
      travelPlanId: z.string().uuid().optional(),
    });
    register('get_watch_candidates', '读取家庭片单中的待看候选', {
      runId,
      limit: z.number().int().min(1).max(20).optional(),
    });
    register('get_recent_memories', '读取最近家庭回忆的非敏感摘要', {
      runId,
      limit: z.number().int().min(1).max(20).optional(),
    });
    register('get_member_tasks', '查询当前成员本人（默认）或指定同家庭成员的待办/已完成任务；用户说“我的任务”时必须使用本工具，不应使用 get_tasks', {
      runId,
      memberId: z.string().uuid().optional(),
      status: z.enum(['pending', 'completed', 'all']).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    });
    register('get_family_schedule', '查询未来最多 30 天的家庭日程', {
      runId,
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      days: z.number().int().min(1).max(30).optional(),
    });
    register('get_inventory_summary', '查询家庭低库存和临期库存摘要', {
      runId,
      filter: z.enum(['low_stock', 'expiring_soon', 'all']).optional(),
    });
    register('search_recipes', '按关键词、食材或分类搜索家庭菜谱', {
      runId,
      query: z.string().max(80).optional(),
      ingredients: z.array(z.string().min(1).max(64)).max(10).optional(),
      tags: z.array(z.string().min(1).max(32)).max(10).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    });
    register('get_dish_plan', '查询未来最多 30 天的点菜计划', {
      runId,
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      days: z.number().int().min(1).max(30).optional(),
    });
    register('get_weather', '这是实时天气的唯一数据来源。回答任何城市的温度、降水或预报前必须调用本工具；不得依据模型自身知识生成天气结论，工具不可用时只能明确说明天气服务不可用', {
      runId,
      city: z.string().min(1).max(80).optional(),
      days: z.number().int().min(1).max(5).optional(),
    });
    register('get_member_profile', '查询同一家庭成员的非敏感档案', {
      runId,
      memberId: z.string().uuid().optional(),
    });
    register('recall_preferences', '读取当前成员可见且已确认的小管家偏好', {
      runId,
      scope: z.enum(['member_private', 'household']).optional(),
      memoryKey: z.enum(AGENT_MEMORY_KEYS).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    });
    register('remember_preference', '当当前成员说“记住我……”或要求记住自己的偏好、习惯时，必须立即调用本工具，创建归属当前成员的 member_private 候选并等待其在 Family App 内确认；无需且不得追问是否适用于全家', {
      runId,
      memoryKey: z.enum(AGENT_MEMORY_KEYS),
      content: z.string().min(1).max(2000),
    });
    register('propose_task', '生成家庭任务提案，等待成员在 Family App 内确认', {
      runId,
      title: z.string().min(1).max(120),
      note: z.string().max(1000).nullable().optional(),
      startsOn: z.string(),
      recurrence: z.enum(['once', 'daily', 'weekly', 'monthly']).optional(),
      repeatInterval: z.number().int().min(1).max(365).optional(),
      endsOn: z.string().nullable().optional(),
      defaultAssigneeId: z.string().uuid().nullable().optional(),
      rewardPoints: z.number().int().min(0).max(10_000).optional(),
    });
    register('propose_reminder', '为现有家庭事项生成提醒提案', {
      runId,
      sourceModule: z.enum([
        'menu',
        'task',
        'calendar',
        'poll',
        'maintenance',
        'travel',
      ]),
      sourceId: z.string().uuid(),
      occurrenceDate: z.string().nullable().optional(),
      remindAt: z.string(),
      recipientIds: z.array(z.string().uuid()).min(1).max(20),
    });
    register('propose_poll', '生成家庭投票提案', {
      runId,
      title: z.string().min(1).max(120),
      description: z.string().max(1000).nullable().optional(),
      category: z
        .enum(['general', 'meal', 'activity', 'movie', 'shopping'])
        .optional(),
      voteMode: z.enum(['single', 'multiple']).optional(),
      maxChoices: z.number().int().min(1).max(12).optional(),
      closesAt: z.string().nullable().optional(),
      options: z
        .array(
          z.object({
            label: z.string().min(1).max(120),
            description: z.string().max(500).nullable().optional(),
          }),
        )
        .min(2)
        .max(12),
    });
    register('propose_menu', '生成指定日期和餐次的菜单点菜提案', {
      runId,
      date: z.string(),
      mealType: z.enum(['breakfast', 'lunch', 'dinner']),
      items: z
        .array(
          z.object({
            dishId: z.string().uuid(),
            recipeVariantId: z.string().uuid().optional(),
            note: z.string().max(200).optional(),
          }),
        )
        .min(1)
        .max(12),
    });
    register('propose_shopping_items', '生成手动购物清单提案，不直接修改库存', {
      runId,
      date: z.string(),
      items: z
        .array(
          z.object({
            customName: z.string().min(1).max(120),
            totalQty: z.number().positive().max(99_999).optional(),
            unit: z.string().max(32).optional(),
          }),
        )
        .min(1)
        .max(20),
    });
    return server;
  }
}
