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
    return server;
  }
}
