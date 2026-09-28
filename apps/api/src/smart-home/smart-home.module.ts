import { Controller, Delete, Get, Module, Post, Put } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  smartHomeCommandBody,
  smartHomeEntityId,
  updateSmartHomeConnectorBody,
  upsertSmartHomeDeviceBody,
  type SmartHomeCommandBody,
  type UpdateSmartHomeConnectorBody,
  type UpsertSmartHomeDeviceBody,
} from '@family/contracts';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { ZodBody, ZodParam } from '../common/zod';
import { Integration, SmartHomeCommandRecord, SmartHomeDevice } from '../entities';
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

@Module({
  imports: [TypeOrmModule.forFeature([Integration, SmartHomeDevice, SmartHomeCommandRecord])],
  controllers: [SmartHomeController],
  providers: [SmartHomeSettingsService, SmartHomeService, SmartHomeCommandsService, SmartHomeLiveService],
})
export class SmartHomeModule {}
