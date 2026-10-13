import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  TravelListQueryDto,
  TravelTemplateListQueryDto,
  CreateTravelPlanDto,
  UpdateTravelPlanDto,
  TravelVersionOperationDto,
  CreateTravelItemDto,
  UpdateTravelItemDto,
  TravelItemVersionOperationDto,
  CreateTravelTemplateDto,
  UpdateTravelTemplateDto,
  ApplyTravelTemplateDto,
} from './travel.dto';
import { TravelService } from './travel.service';

@Controller()
export class TravelController {
  constructor(private readonly service: TravelService) {}

  @Get('travel-plans')
  listPlans(@Query() query: TravelListQueryDto, @CurrentUser() user: JwtUser) {
    return this.service.listPlans(query, user);
  }

  @Get('travel-plans/:id')
  detail(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.detail(id, user);
  }

  @Post('travel-plans')
  createPlan(@Body() dto: CreateTravelPlanDto, @CurrentUser() user: JwtUser) {
    return this.service.createPlan(dto, user);
  }

  @Patch('travel-plans/:id')
  updatePlan(
    @Param('id') id: string,
    @Body() dto: UpdateTravelPlanDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updatePlan(id, dto, user);
  }

  @Post('travel-plans/:id/complete')
  completePlan(
    @Param('id') id: string,
    @Body() dto: TravelVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.completePlan(id, dto, user);
  }

  @Post('travel-plans/:id/reopen')
  reopenPlan(
    @Param('id') id: string,
    @Body() dto: TravelVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.reopenPlan(id, dto, user);
  }

  @Post('travel-plans/:id/cancel')
  cancelPlan(
    @Param('id') id: string,
    @Body() dto: TravelVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.cancelPlan(id, dto, user);
  }

  @Post('travel-plans/:id/archive')
  archivePlan(
    @Param('id') id: string,
    @Body() dto: TravelVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.archivePlan(id, dto, user);
  }

  @Post('travel-plans/:id/restore')
  restorePlan(
    @Param('id') id: string,
    @Body() dto: TravelVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.restorePlan(id, dto, user);
  }

  @Post('travel-plans/:planId/items')
  createItem(
    @Param('planId') planId: string,
    @Body() dto: CreateTravelItemDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.createItem(planId, dto, user);
  }

  @Patch('travel-plans/:planId/items/:itemId')
  updateItem(
    @Param('planId') planId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateTravelItemDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updateItem(planId, itemId, dto, user);
  }

  @Post('travel-plans/:planId/items/:itemId/complete')
  completeItem(
    @Param('planId') planId: string,
    @Param('itemId') itemId: string,
    @Body() dto: TravelItemVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.completeItem(planId, itemId, dto, user);
  }

  @Post('travel-plans/:planId/items/:itemId/restore')
  restoreItem(
    @Param('planId') planId: string,
    @Param('itemId') itemId: string,
    @Body() dto: TravelItemVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.restoreItem(planId, itemId, dto, user);
  }

  @Post('travel-plans/:planId/items/:itemId/skip')
  skipItem(
    @Param('planId') planId: string,
    @Param('itemId') itemId: string,
    @Body() dto: TravelItemVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.skipItem(planId, itemId, dto, user);
  }

  @Post('travel-plans/:planId/items/:itemId/archive')
  archiveItem(
    @Param('planId') planId: string,
    @Param('itemId') itemId: string,
    @Body() dto: TravelItemVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.archiveItem(planId, itemId, dto, user);
  }

  @Get('travel-templates')
  listTemplates(
    @Query() query: TravelTemplateListQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.listTemplates(query, user);
  }

  @Post('travel-templates')
  createTemplate(
    @Body() dto: CreateTravelTemplateDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.createTemplate(dto, user);
  }

  @Patch('travel-templates/:id')
  updateTemplate(
    @Param('id') id: string,
    @Body() dto: UpdateTravelTemplateDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updateTemplate(id, dto, user);
  }

  @Post('travel-templates/:id/archive')
  archiveTemplate(
    @Param('id') id: string,
    @Body() dto: TravelVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.archiveTemplate(id, dto, user);
  }

  @Post('travel-templates/:id/restore')
  restoreTemplate(
    @Param('id') id: string,
    @Body() dto: TravelVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.restoreTemplate(id, dto, user);
  }

  @Post('travel-plans/:planId/templates/:templateId/apply')
  applyTemplate(
    @Param('planId') planId: string,
    @Param('templateId') templateId: string,
    @Body() dto: ApplyTravelTemplateDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.applyTemplate(planId, templateId, dto, user);
  }
}
