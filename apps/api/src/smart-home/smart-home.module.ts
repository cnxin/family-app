import { Controller, Delete, Get, Headers, HttpCode, Module, Post, Put, Req, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  smartHomeRulesSchema,
  smartHomeWebhookBody,
  type SmartHomeRules,
  type SmartHomeWebhookBody,
  smartHomeCommandBody,
  smartHomeEntityId,
  smartHomeHouseholdParams,
  updateSmartHomeConnectorBody,
  upsertSmartHomeDeviceBody,
  type SmartHomeCommandBody,
  type UpdateSmartHomeConnectorBody,
  type UpsertSmartHomeDeviceBody,
} from '@family/contracts';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser, Public } from '../auth/jwt.guard';
import { ZodBody, ZodParam } from '../common/zod';
import {
  Integration,
  SmartHomeCommandRecord,
  SmartHomeDevice,
  SmartHomeEventRecord,
  SmartHomeWebhookSettings,
} from '../entities';
import { RemindersModule } from '../reminders/reminders.module';
import { ShoppingModule } from '../shopping/shopping.module';
import { TasksModule } from '../tasks/tasks.module';
import { SmartHomeLinkagesService } from './smart-home-linkages.service';
import { SmartHomeWebhookService } from './smart-home-webhook.service';
import { SmartHomeCommandsService } from './smart-home-commands.service';
import { SmartHomeLiveService } from './smart-home-live.service';
import { SmartHomeSettingsService } from './smart-home-settings.service';
import { SmartHomeService } from './smart-home.service';

/**
 * /smart-home：Home Assistant 接入（H3）。E1：连接设置、实体目录、白名单、状态快照；
 * E2：控制（幂等键 + 审计 + 逐次校验权限）与 HA 状态经 /events 推送（SmartHomeLiveService）。
 * 看全家都能看；设置、目录、白名单、审计只有管理员；能不能控按设备的 minRole（home-assistant-plan §4.4）。
 */
@Controller('smart-home')
export class SmartHomeController {
  constructor(
    private readonly settings: SmartHomeSettingsService,
    private readonly smartHome: SmartHomeService,
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
    this.smartHome.forget(user.householdId);
    void this.live.refresh(user.householdId);
    return result;
  }

  @Delete('connector-settings')
  @RequireCapabilities('manage_integrations')
  async resetConnectorSettings(@CurrentUser() user: JwtUser) {
    const result = await this.settings.reset(user);
    this.smartHome.forget(user.householdId);
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

  @Put('devices/:entityId')
  @RequireCapabilities('manage_integrations')
  async upsertDevice(
    @ZodParam('entityId', smartHomeEntityId) entityId: string,
    @ZodBody(upsertSmartHomeDeviceBody) body: UpsertSmartHomeDeviceBody,
    @CurrentUser() user: JwtUser,
  ) {
    const device = await this.smartHome.upsert(entityId, body, user);
    void this.live.refresh(user.householdId);
    return device;
  }

  @Delete('devices/:entityId')
  @RequireCapabilities('manage_integrations')
  async removeDevice(@ZodParam('entityId', smartHomeEntityId) entityId: string, @CurrentUser() user: JwtUser) {
    const result = await this.smartHome.remove(entityId, user);
    void this.live.refresh(user.householdId);
    return result;
  }

  @Post('devices/:entityId/command')
  command(
    @ZodParam('entityId', smartHomeEntityId) entityId: string,
    @ZodBody(smartHomeCommandBody) body: SmartHomeCommandBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.commands.execute(entityId, body, user);
  }

  @Get('commands')
  @RequireCapabilities('manage_integrations')
  recentCommands(@CurrentUser() user: JwtUser) {
    return this.commands.recent(user.householdId);
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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Integration,
      SmartHomeDevice,
      SmartHomeCommandRecord,
      SmartHomeWebhookSettings,
      SmartHomeEventRecord,
    ]),
    TasksModule,
    ShoppingModule,
    RemindersModule,
  ],
  controllers: [SmartHomeController, SmartHomeWebhookController],
  providers: [
    SmartHomeSettingsService,
    SmartHomeService,
    SmartHomeCommandsService,
    SmartHomeLiveService,
    SmartHomeWebhookService,
    SmartHomeLinkagesService,
  ],
})
export class SmartHomeModule {}
