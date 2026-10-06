import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ModuleHasDataRegistry } from '../system/module-has-data.registry';
import { homeAssistantServerDefaultConfigured } from './home-assistant.config';

// 智能家居：连接器配好了（家庭自己的一行：启用 + 地址 + 令牌；没有这一行才看服务器默认）且白名单非空。
// 服务器默认来自环境变量 / 令牌文件，不在库里，由 $2 传入。
const SMART_HOME_HAS_DATA = `SELECT 1 FROM smart_home_devices WHERE "householdId" = $1 AND (
    EXISTS (SELECT 1 FROM integrations i JOIN integration_secrets s ON s."integrationId" = i.id
      WHERE i."householdId" = $1 AND i.kind = 'home_assistant' AND i."isEnabled"
        AND NULLIF(i."baseUrl", '') IS NOT NULL)
    OR ($2::boolean AND NOT EXISTS (
      SELECT 1 FROM integrations WHERE "householdId" = $1 AND kind = 'home_assistant')))`;

/** manifest 的 hasData `{ kind: 'server', id: 'smart-home.hasData' }`：注册到内核，内核不再 import 本插件的配置。 */
@Injectable()
export class SmartHomeHasDataProvider implements OnModuleInit {
  constructor(
    private readonly registry: ModuleHasDataRegistry,
    private readonly db: DataSource,
  ) {}

  onModuleInit() {
    this.registry.register('smart-home.hasData', (householdId) => this.hasData(householdId));
  }

  private async hasData(householdId: string): Promise<boolean> {
    const [row]: { hasData: boolean }[] = await this.db.query(
      `SELECT EXISTS(${SMART_HOME_HAS_DATA} LIMIT 1) AS "hasData"`,
      [householdId, homeAssistantServerDefaultConfigured()],
    );
    return row.hasData;
  }
}
