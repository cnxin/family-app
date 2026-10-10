import { Injectable, OnModuleInit } from '@nestjs/common';
import type { SmartHomeFacade } from '@family/contracts';
import { deviceStatusLine } from '@family/shared';
import { PluginFacadeRegistry } from '../system/plugin-facades.registry';
import { SmartHomeService } from './smart-home.service';

const isSceneDomain = (domain: string) => domain === 'scene' || domain === 'script';

/**
 * 智能家居门面的实现（J4 第四批，接口见 contracts/plugins/smart-home.facade.ts），SmartHomeModule 启动时注册。
 * 状态取自与控制页同一个 states()（连不上时是最近一次读到的）；一句状态用 @family/shared 的 deviceStatusLine（卡片同款）。
 */
export function smartHomeFacade(smartHome: SmartHomeService): SmartHomeFacade {
  return {
    async deviceStatuses(filter, actor) {
      const states = await smartHome.states(actor.householdId, actor.role);
      const room = filter.room?.trim().toLocaleLowerCase('zh-CN');
      const devices = states.devices
        .filter((device) => !isSceneDomain(device.primaryDomain))
        .filter((device) => !filter.deviceId || device.id === filter.deviceId)
        .filter((device) => !room || (device.area ?? '').toLocaleLowerCase('zh-CN').includes(room))
        .map((device) => ({
          id: device.id,
          name: device.displayName,
          room: device.area,
          status: deviceStatusLine(device).text,
          online: device.online,
        }));
      return {
        connection: !states.connection.configured
          ? 'not_configured'
          : states.connection.available
            ? 'connected'
            : 'unreachable',
        devices,
      };
    },
  };
}

/** 注册智能家居门面（J4 第四批：小管家读工具 get_device_status）。 */
@Injectable()
export class SmartHomeFacadeProvider implements OnModuleInit {
  constructor(
    private readonly registry: PluginFacadeRegistry,
    private readonly smartHome: SmartHomeService,
  ) {}

  onModuleInit() {
    this.registry.register('smart-home', smartHomeFacade(this.smartHome));
  }
}
