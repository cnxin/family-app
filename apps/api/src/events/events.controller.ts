import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, type JwtUser } from '../auth/jwt.guard';
import { EventsService } from './events.service';

/**
 * GET /events：SSE。认证走普通的 Authorization 请求头（客户端用 fetch + ReadableStream 读流），
 * 不把长期令牌放进 URL。
 */
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  stream(@CurrentUser() user: JwtUser & { exp?: number }, @Res() response: Response) {
    const opened = this.events.open(user, response, typeof user.exp === 'number' ? user.exp * 1000 : null);
    if (!opened) {
      response.status(429).json({
        error: { code: 'TOO_MANY_CONNECTIONS', message: '这个家庭同时打开的实时连接太多了，稍后再试' },
      });
    }
  }
}
