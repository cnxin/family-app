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

  /**
   * 工具名单、描述、参数全部来自注册表（J4.1，apps/api/src/agent/tools/），顺序 = 注册顺序；
   * MCP 入参 = runId + 工具参数。tools/list 的输出与 J4.1 之前逐字节一致（agent-tools.check.ts 比对快照）。
   */
  private createServer() {
    const server = new McpServer({ name: 'family-app', version: '1.0.0' });
    const runId = z.string().uuid().describe('Family App issued short-lived run ID');
    for (const tool of this.tools.registry.list()) {
      const inputSchema: Record<string, z.ZodTypeAny> = { runId, ...tool.schema.shape };
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema },
        async (input: Record<string, unknown>) => ({
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(await this.tools.execute(tool.name, input)),
            },
          ],
        }),
      );
    }
    return server;
  }
}
