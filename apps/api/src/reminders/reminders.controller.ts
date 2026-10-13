import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  ReminderSourceRangeDto,
  ReminderQueryDto,
  CreateReminderDto,
  UpdateReminderDto,
} from './reminders.dto';
import { RemindersService } from './reminders.service';

@Controller()
export class RemindersController {
  constructor(private readonly service: RemindersService) {}

  @Get('reminder-sources')
  listSources(
    @Query() query: ReminderSourceRangeDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.listSources(query, user);
  }

  @Get('reminders')
  list(@Query() query: ReminderQueryDto, @CurrentUser() user: JwtUser) {
    return this.service.list(query, user);
  }

  @Post('reminders')
  create(@Body() dto: CreateReminderDto, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user);
  }

  @Patch('reminders/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateReminderDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete('reminders/:id')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.cancel(id, user);
  }
}
