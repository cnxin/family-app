import { Controller, Delete, Get, Module, Post, Put } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  smartHomeEntityId,
  updateSmartHomeConnectorBody,
  upsertSmartHomeDeviceBody,
  type UpdateSmartHomeConnectorBody,
  type UpsertSmartHomeDeviceBody,
} from '@family/contracts';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { ZodBody, ZodParam } from '../common/zod';
import { Integration, SmartHomeDevice } from '../entities';
import { SmartHomeSettingsService } from './smart-home-settings.service';
import { SmartHomeService } from './smart-home.service';

/**
 * /smart-home：Home Assistant 接入（H3）。E1 只读：连接设置、实体目录、白名单、状态快照。
 * 看全家都能看；设置、目录、白名单只有管理员（home-assistant-plan §4.4）。
 */
@Controller('smart-home')
export class SmartHomeController {
  constructor(
    private readonly settings: SmartHomeSettingsService,
    private readonly smartHome: SmartHomeService,
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
    return result;
  }

  @Delete('connector-settings')
  @RequireCapabilities('manage_integrations')
  async resetConnectorSettings(@CurrentUser() user: JwtUser) {
    const result = await this.settings.reset(user);
    this.smartHome.forget(user.householdId);
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
  upsertDevice(
    @ZodParam('entityId', smartHomeEntityId) entityId: string,
    @ZodBody(upsertSmartHomeDeviceBody) body: UpsertSmartHomeDeviceBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.smartHome.upsert(entityId, body, user);
  }

  @Delete('devices/:entityId')
  @RequireCapabilities('manage_integrations')
  removeDevice(@ZodParam('entityId', smartHomeEntityId) entityId: string, @CurrentUser() user: JwtUser) {
    return this.smartHome.remove(entityId, user);
  }

  @Get('states')
  states(@CurrentUser() user: JwtUser) {
    return this.smartHome.states(user.householdId);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Integration, SmartHomeDevice])],
  controllers: [SmartHomeController],
  providers: [SmartHomeSettingsService, SmartHomeService],
})
export class SmartHomeModule {}
