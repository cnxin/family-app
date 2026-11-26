import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ExternalAccessSettingsService } from './external-access-settings.service';
import { ExternalAccessService } from './external-access.service';
import { externalAccessPollIntervalMs } from './tailscale.config';

/**
 * 外部访问定时巡检器：
 * 按 EXTERNAL_ACCESS_POLL_INTERVAL_MS（默认 1 小时）轮询已配置的家庭，
 * 将 14 天内密钥到期与 30 天未上线设备写入通知中心（经 ExternalAccessNotifierService 去重）。
 */
@Injectable()
export class ExternalAccessSchedulerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly settings: ExternalAccessSettingsService,
    private readonly externalAccess: ExternalAccessService,
  ) {}

  onApplicationBootstrap() {
    const interval = externalAccessPollIntervalMs();
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, interval);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async pollOnce() {
    if (this.running) return;
    this.running = true;
    try {
      const targets = await this.settings.listHouseholdsForPoll();
      for (const target of targets) {
        try {
          await this.externalAccess.overviewForBackground(
            target.householdId,
            target.role,
            true,
            true,
          );
        } catch {
          // 单个家庭控制面失败不阻塞其他家庭巡检
        }
      }
    } finally {
      this.running = false;
    }
  }
}
