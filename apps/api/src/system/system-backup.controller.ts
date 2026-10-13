import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { UpdateBackupPolicyDto, QueueBackupRunDto } from './system.dto';
import { SystemBackupService } from './system-backup.service';

@Controller('system/backups')
export class SystemBackupController {
  constructor(private readonly service: SystemBackupService) {}

  @Get()
  dashboard(@CurrentUser() user: JwtUser) {
    return this.service.dashboard(user);
  }

  @Put('policy')
  updatePolicy(
    @Body() dto: UpdateBackupPolicyDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updatePolicy(dto, user);
  }

  @Post('runs')
  queueBackup(@Body() dto: QueueBackupRunDto, @CurrentUser() user: JwtUser) {
    return this.service.queueBackup(dto, user);
  }

  @Post('capacity-checks')
  queueCapacityCheck(
    @Body() dto: QueueBackupRunDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.queueCapacityCheck(dto, user);
  }

  @Post('runs/:id/restore-drills')
  queueRestoreDrill(
    @Param('id') id: string,
    @Body() dto: QueueBackupRunDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.queueRestoreDrill(id, dto, user);
  }

  @Patch('runs/:id/cancel')
  cancelRun(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.cancelRun(id, user);
  }
}
