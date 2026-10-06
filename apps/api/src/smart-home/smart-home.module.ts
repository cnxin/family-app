import { Controller, Delete, Get, Headers, HttpCode, Module, Patch, Post, Put, Req, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  createSmartHomeLinkBody,
  updateSmartHomeLinkBody,
  uuid,
  type CreateSmartHomeLinkBody,
  type UpdateSmartHomeLinkBody,
  smartHomeRulesSchema,
  smartHomeWebhookBody,
  type SmartHomeRules,
  type SmartHomeWebhookBody,
  smartHomeCommandBody,
  smartHomeHouseholdParams,
  smartHomeHistoryQuery,
  type SmartHomeHistoryQuery,
  smartHomeCommandsQuery,
  type SmartHomeCommandsQuery,
  addSmartHomeDeviceBody,
  updateSmartHomeConnectorBody,
  updateSmartHomeDeviceBody,
  type AddSmartHomeDeviceBody,
  type SmartHomeCommandBody,
  type UpdateSmartHomeConnectorBody,
  type UpdateSmartHomeDeviceBody,
} from '@family/contracts';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser, Public } from '../auth/jwt.guard';
import { ZodBody, ZodParam, ZodQuery } from '../common/zod';
import {
  Integration,
  SmartHomeCommandRecord,
  SmartHomeDevice,
  SmartHomeEventRecord,
  SmartHomeLink,
  SmartHomeLinkRun,
  SmartHomeMergeReportRecord,
  SmartHomeWebhookSettings,
} from '../entities';
import { SmartHomeLinksService } from './smart-home-links.service';
import { TodayModule } from '../today/today.module';
import { SystemModule } from '../system/system.module';
import { SmartHomeAttentionSource } from './smart-home-attention';
import { SmartHomeHasDataProvider } from './smart-home-has-data';
import { SmartHomeLinkagesService } from './smart-home-linkages.service';
import { SmartHomeWebhookService } from './smart-home-webhook.service';
import { SmartHomeCommandsService } from './smart-home-commands.service';
import { SmartHomeLiveService } from './smart-home-live.service';
import { SmartHomeMergeService } from './smart-home-merge.service';
import { SmartHomeSettingsService } from './smart-home-settings.service';
import { SmartHomeService } from './smart-home.service';
import { SmartHomeWhitelistService } from './smart-home-whitelist.service';
import { SmartHomePanelService } from './smart-home-panel.service';

/**
 * /smart-home：Home Assistant 接入（H3）。E1：连接设置、实体目录、白名单、状态快照；
 * E2：控制（幂等键 + 审计 + 逐次校验权限）与 HA 状态经 /events 推送（SmartHomeLiveService）。
 * 智能家居页重做 R1：白名单按设备（:id 是 smart_home_devices.id），旧的按实体登记的行由 SmartHomeMergeService 归并。
 * 看全家都能看；设置、目录、白名单、审计只有管理员；能不能控按设备的 minRole（home-assistant-plan §4.4）。
 */
@Controller('smart-home')
export class SmartHomeController {
  constructor(
    private readonly settings: SmartHomeSettingsService,
    private readonly smartHome: SmartHomeService,
    private readonly whitelist: SmartHomeWhitelistService,
    private readonly panels: SmartHomePanelService,
    private readonly commands: SmartHomeCommandsService,
    private readonly live: SmartHomeLiveService,
  ) {}

  @Get('connector-settings')
  @RequireCapabilities('manage_integrations')
  connectorSettings(@CurrentUser() user: JwtUser) {
    return this.settings.present(user.householdId);
  }

  @Put('connector-settings')
  @RequireCapabilities('manage_integrations')
  async updateConnectorSettings(
    @ZodBody(updateSmartHomeConnectorBody) body: UpdateSmartHomeConnectorBody,
    @CurrentUser() user: JwtUser,
  ) {
    const result = await this.settings.update(body, user);
    this.smartHome.forgetAll(user.householdId);
    void this.live.refresh(user.householdId);
    return result;
  }

  @Delete('connector-settings')
  @RequireCapabilities('manage_integrations')
  async resetConnectorSettings(@CurrentUser() user: JwtUser) {
    const result = await this.settings.reset(user);
    this.smartHome.forgetAll(user.householdId);
    void this.live.refresh(user.householdId);
    return result;
  }

  @Post('connector-settings/test')
  @RequireCapabilities('manage_integrations')
  testConnectorSettings(@CurrentUser() user: JwtUser) {
    return this.smartHome.test(user.householdId);
  }

  @Get('entity-directory')
  @RequireCapabilities('manage_integrations')
  entityDirectory(@CurrentUser() user: JwtUser) {
    return this.smartHome.directory(user.householdId);
  }

  @Get('devices')
  devices(@CurrentUser() user: JwtUser) {
    return this.smartHome.list(user.householdId);
  }

  @Get('devices/:id/panel')
  panel(@ZodParam('id', uuid) id: string, @CurrentUser() user: JwtUser) {
    return this.panels.panel(id, user);
  }

  @Get('devices/:id/history')
  history(
    @ZodParam('id', uuid) id: string,
    @ZodQuery(smartHomeHistoryQuery) query: SmartHomeHistoryQuery,
    @CurrentUser() user: JwtUser,
  ) {
    return this.panels.history(id, query.entityId, user);
  }

  @Get('devices/merge-report')
  @RequireCapabilities('manage_integrations')
  mergeReport(@CurrentUser() user: JwtUser) {
    return this.smartHome.mergeReport(user.householdId);
  }

  @Post('devices')
  @RequireCapabilities('manage_integrations')
  async addDevice(@ZodBody(addSmartHomeDeviceBody) body: AddSmartHomeDeviceBody, @CurrentUser() user: JwtUser) {
    const device = await this.whitelist.add(body, user);
    void this.live.refresh(user.householdId);
    return device;
  }

  @Patch('devices/:id')
  @RequireCapabilities('manage_integrations')
  async updateDevice(
    @ZodParam('id', uuid) id: string,
    @ZodBody(updateSmartHomeDeviceBody) body: UpdateSmartHomeDeviceBody,
    @CurrentUser() user: JwtUser,
  ) {
    const device = await this.whitelist.update(id, body, user);
    void this.live.refresh(user.householdId);
    return device;
  }

  @Delete('devices/:id')
  @RequireCapabilities('manage_integrations')
  async removeDevice(@ZodParam('id', uuid) id: string, @CurrentUser() user: JwtUser) {
    const result = await this.whitelist.remove(id, user);
    void this.live.refresh(user.householdId);
    return result;
  }

  @Post('devices/:id/command')
  command(
    @ZodParam('id', uuid) id: string,
    @ZodBody(smartHomeCommandBody) body: SmartHomeCommandBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.commands.execute(id, body, user);
  }

  @Get('commands')
  @RequireCapabilities('manage_integrations')
  recentCommands(@ZodQuery(smartHomeCommandsQuery) query: SmartHomeCommandsQuery, @CurrentUser() user: JwtUser) {
    return this.commands.recent(user.householdId, query.source);
  }

  @Get('states')
  states(@CurrentUser() user: JwtUser) {
    return this.smartHome.states(user.householdId, user.role);
  }
}

/**
 * E3：HA → 小管家。webhook 是公开端点（签名 + 时间戳，见 SmartHomeWebhookService）；
 * 密钥与联动设置只有管理员。
 */
@Controller('smart-home')
export class SmartHomeWebhookController {
  constructor(private readonly webhook: SmartHomeWebhookService) {}

  @Public()
  @Post('webhook/:householdId')
  @HttpCode(200)
  receive(
    @ZodParam('householdId', smartHomeHouseholdParams.shape.householdId) householdId: string,
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-family-timestamp') timestamp: string | undefined,
    @Headers('x-family-signature') signature: string | undefined,
    @ZodBody(smartHomeWebhookBody) body: SmartHomeWebhookBody,
  ) {
    return this.webhook.receive(householdId, request.rawBody, { timestamp, signature }, body);
  }

  @Get('webhook-settings')
  @RequireCapabilities('manage_integrations')
  settings(@CurrentUser() user: JwtUser) {
    return this.webhook.view(user.householdId);
  }

  @Post('webhook-settings/secret')
  @RequireCapabilities('manage_integrations')
  rotate(@CurrentUser() user: JwtUser) {
    return this.webhook.rotate(user);
  }

  @Put('webhook-settings/rules')
  @RequireCapabilities('manage_integrations')
  updateRules(@ZodBody(smartHomeRulesSchema) rules: SmartHomeRules, @CurrentUser() user: JwtUser) {
    return this.webhook.updateRules(rules, user);
  }

  @Get('webhook-settings/events')
  @RequireCapabilities('manage_integrations')
  events(@CurrentUser() user: JwtUser) {
    return this.webhook.recentEvents(user.householdId);
  }
}

/** E4：小管家 → HA 的联动规则（管理员）。执行在 SmartHomeLinksService 里（家务打勾 / 日程开始前）。 */
@Controller('smart-home/links')
export class SmartHomeLinksController {
  constructor(private readonly links: SmartHomeLinksService) {}

  @Get()
  @RequireCapabilities('manage_integrations')
  list(@CurrentUser() user: JwtUser) {
    return this.links.list(user.householdId);
  }

  @Post()
  @RequireCapabilities('manage_integrations')
  create(@ZodBody(createSmartHomeLinkBody) body: CreateSmartHomeLinkBody, @CurrentUser() user: JwtUser) {
    return this.links.create(body, user);
  }

  @Patch(':id')
  @RequireCapabilities('manage_integrations')
  update(
    @ZodParam('id', uuid) id: string,
    @ZodBody(updateSmartHomeLinkBody) body: UpdateSmartHomeLinkBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.links.update(id, body, user);
  }

  @Delete(':id')
  @RequireCapabilities('manage_integrations')
  remove(@ZodParam('id', uuid) id: string, @CurrentUser() user: JwtUser) {
    return this.links.remove(id, user);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Integration,
      SmartHomeDevice,
      SmartHomeCommandRecord,
      SmartHomeWebhookSettings,
      SmartHomeEventRecord,
      SmartHomeLink,
      SmartHomeLinkRun,
      SmartHomeMergeReportRecord,
    ]),
    TodayModule,
    SystemModule,
  ],
  controllers: [SmartHomeController, SmartHomeWebhookController, SmartHomeLinksController],
  providers: [
    SmartHomeSettingsService,
    SmartHomeService,
    SmartHomeWhitelistService,
    SmartHomePanelService,
    SmartHomeCommandsService,
    SmartHomeLiveService,
    SmartHomeMergeService,
    SmartHomeWebhookService,
    SmartHomeLinkagesService,
    SmartHomeLinksService,
    SmartHomeAttentionSource,
    SmartHomeHasDataProvider,
  ],
})
export class SmartHomeModule {}
