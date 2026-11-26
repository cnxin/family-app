import { Controller, Delete, Get, HttpCode, Module, Post, Put, Req } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Request } from 'express';
import {
  externalAccessDeviceParams,
  externalAccessOverviewQuery,
  testExternalAccessSettingsBody,
  updateExternalAccessSettingsBody,
  type ExternalAccessOverviewQuery,
  type TestExternalAccessSettingsBody,
  type UpdateExternalAccessSettingsBody,
} from '@family/contracts';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, type JwtUser } from '../auth/jwt.guard';
import { ZodBody, ZodParam, ZodQuery } from '../common/zod';
import { Integration, IntegrationSecret, Member, Notification } from '../entities';
import { SystemModule } from '../system/system.module';
import { TodayModule } from '../today/today.module';
import { ExternalAccessAttentionSource } from './external-access-attention';
import { ExternalAccessHasDataProvider } from './external-access-has-data';
import { ExternalAccessNotifierService } from './external-access-notifier.service';
import { ExternalAccessSchedulerService } from './external-access-scheduler.service';
import { ExternalAccessSettingsService } from './external-access-settings.service';
import { ExternalAccessService } from './external-access.service';

/**
 * /external-access：外部访问（Tailscale 控制面只读面板 + Serve 入口识别，M5-E 阶段 1）。
 * - 设置、测试、概览、设备列表与单台设备明细均要求 manage_integrations；
 * - /external-access/session 对所有正式成员开放（访客无 JWT，非管理员隐藏 login）。
 */
@Controller('external-access')
export class ExternalAccessController {
  constructor(
    private readonly settings: ExternalAccessSettingsService,
    private readonly externalAccess: ExternalAccessService,
  ) {}

  @Get('settings')
  @RequireCapabilities('manage_integrations')
  getSettings(@CurrentUser() user: JwtUser) {
    return this.settings.present(user);
  }

  @Put('settings')
  @RequireCapabilities('manage_integrations')
  async updateSettings(
    @ZodBody(updateExternalAccessSettingsBody) body: UpdateExternalAccessSettingsBody,
    @CurrentUser() user: JwtUser,
  ) {
    const result = await this.settings.update(body, user);
    this.externalAccess.forget(user.householdId);
    return result;
  }

  @Delete('settings')
  @RequireCapabilities('manage_integrations')
  async resetSettings(@CurrentUser() user: JwtUser) {
    const result = await this.settings.reset(user);
    this.externalAccess.forget(user.householdId);
    return result;
  }

  @Post('settings/test')
  @HttpCode(200)
  @RequireCapabilities('manage_integrations')
  testSettings(
    @ZodBody(testExternalAccessSettingsBody) body: TestExternalAccessSettingsBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.externalAccess.test(body, user);
  }

  @Get('overview')
  @RequireCapabilities('manage_integrations')
  overview(
    @ZodQuery(externalAccessOverviewQuery) query: ExternalAccessOverviewQuery,
    @CurrentUser() user: JwtUser,
  ) {
    return this.externalAccess.overview(user, query.refresh === 'true');
  }

  @Get('devices')
  @RequireCapabilities('manage_integrations')
  devices(
    @ZodQuery(externalAccessOverviewQuery) query: ExternalAccessOverviewQuery,
    @CurrentUser() user: JwtUser,
  ) {
    return this.externalAccess.devices(user, query.refresh === 'true');
  }

  @Get('devices/:id')
  @RequireCapabilities('manage_integrations')
  device(
    @ZodParam('id', externalAccessDeviceParams.shape.id) id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.externalAccess.device(user, id);
  }

  @Get('session')
  session(@Req() request: Request, @CurrentUser() user: JwtUser) {
    return this.externalAccess.session(request, user);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([Integration, IntegrationSecret, Member, Notification]),
    TodayModule,
    SystemModule,
  ],
  controllers: [ExternalAccessController],
  providers: [
    ExternalAccessSettingsService,
    ExternalAccessNotifierService,
    ExternalAccessService,
    ExternalAccessSchedulerService,
    ExternalAccessHasDataProvider,
    ExternalAccessAttentionSource,
  ],
})
export class ExternalAccessModule {}
