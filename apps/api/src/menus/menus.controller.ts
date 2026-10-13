import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  AddItemsDto,
  UpdateItemDto,
  AssignChefDto,
  MenuDateRangeDto,
  MenuQueryDto,
} from './menus.dto';
import { MenusService } from './menus.service';

@Controller()
export class MenusController {
  constructor(private readonly service: MenusService) {}

  @Get('menu-dates')
  dateCounts(@Query() query: MenuDateRangeDto, @CurrentUser() user: JwtUser) {
    return this.service.listDateCounts(user.householdId, query.start, query.end);
  }

  @Get('menus')
  async get(@CurrentUser() user: JwtUser, @Query() query: MenuQueryDto) {
    if (query.mealType) {
      return this.service.findOrCreate(
        user.householdId,
        query.date,
        query.mealType,
      );
    }
    return this.service.listByDate(user.householdId, query.date);
  }

  @Post('menus/:id/items')
  @RequireCapabilities('place_meal_order')
  addItems(
    @Param('id') id: string,
    @Body() dto: AddItemsDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.addItems(id, dto, user.householdId, user.memberId);
  }

  @Patch('menu-items/:id')
  updateItem(
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updateItem(id, dto, user);
  }

  @Patch('menus/:id/chef')
  @RequireCapabilities('update_meal_status')
  assignChef(
    @Param('id') id: string,
    @Body() dto: AssignChefDto,
    @CurrentUser() user: JwtUser,
  ) {
    if (!Object.prototype.hasOwnProperty.call(dto, 'chefId')) {
      throw new BadRequestException('需要指定主厨成员或明确设为未指定');
    }
    return this.service.assignChef(id, dto.chefId ?? null, user);
  }

  @Post('menus/:id/complete')
  @RequireCapabilities('update_meal_status')
  complete(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.complete(id, user);
  }

  @Get('menus/:id/events')
  events(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.listEvents(id, user.householdId);
  }
}
