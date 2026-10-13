import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { CalendarRangeDto, CreateCalendarEventDto, UpdateCalendarEventDto } from './calendar.dto';
import { CalendarService } from './calendar.service';

@Controller()
export class CalendarController {
  constructor(private readonly service: CalendarService) {}

  @Get('calendar')
  list(@Query() query: CalendarRangeDto, @CurrentUser() user: JwtUser) {
    return this.service.list(query.start, query.end, user);
  }

  @Post('calendar-events')
  create(@Body() dto: CreateCalendarEventDto, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user);
  }

  @Patch('calendar-events/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCalendarEventDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete('calendar-events/:id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.remove(id, user);
  }
}
