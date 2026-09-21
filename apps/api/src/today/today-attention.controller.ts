import { Controller, Get } from '@nestjs/common';
import { CurrentUser, type JwtUser } from '../auth/jwt.guard';
import { TodayAttentionService } from './today-attention.service';

@Controller('today')
export class TodayAttentionController {
  constructor(private readonly attention: TodayAttentionService) {}

  @Get('attention')
  get(@CurrentUser() user: JwtUser) {
    return this.attention.get(user);
  }
}
