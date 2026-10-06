import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  pluginHasDataSql,
  SHELF_MODULE_KEYS,
  type ModuleOverride,
  type ShelfModuleKey,
  type SystemModuleState,
} from '@family/contracts';
import { JwtUser } from '../auth/jwt.guard';
import { agentDataKey } from '../common/config';
import { homeAssistantServerDefaultConfigured } from '../smart-home/home-assistant.config';

// 静态 SQL 注册表：标识符不来自请求，只有家庭 ID / 默认启用值通过参数传入。
// 同域多表 UNION 后只取存在性；每个分支都必须带当前家庭边界。
// 已迁到 manifest 的插件由 pluginHasDataSql 生成（同样只有 $1），这里只留还没迁的。
const sources: Partial<
  Record<Exclude<ShelfModuleKey, 'activity' | 'assistant' | 'smart-home'>, string>
> = {
};

// 智能家居：连接器配好了（家庭自己的一行：启用 + 地址 + 令牌；没有这一行才看服务器默认）且白名单非空。
// 服务器默认来自环境变量 / 令牌文件，不在库里，由 $2 传入。
const smartHomeSource = `SELECT 1 FROM smart_home_devices WHERE "householdId" = $1 AND (
    EXISTS (SELECT 1 FROM integrations i JOIN integration_secrets s ON s."integrationId" = i.id
      WHERE i."householdId" = $1 AND i.kind = 'home_assistant' AND i."isEnabled"
        AND NULLIF(i."baseUrl", '') IS NOT NULL)
    OR ($2::boolean AND NOT EXISTS (
      SELECT 1 FROM integrations WHERE "householdId" = $1 AND kind = 'home_assistant')))`;

@Injectable()
export class SystemModulesService {
  constructor(private readonly db: DataSource) {}

  private async hasData(
    key: ShelfModuleKey,
    householdId: string,
  ): Promise<boolean> {
    if (key === 'activity') return true;
    const query =
      key === 'assistant'
        ? `SELECT 1 FROM agent_settings WHERE "householdId" = $1 AND enabled
         UNION ALL SELECT 1 FROM households WHERE id = $1 AND $2::boolean
           AND NOT EXISTS (SELECT 1 FROM agent_settings WHERE "householdId" = $1 LIMIT 1)`
        : key === 'smart-home'
          ? smartHomeSource
          : (pluginHasDataSql(key) ?? sources[key]);
    if (!query) throw new Error(`模块 ${key} 没有 hasData 判定`);
    const parameters =
      key === 'assistant'
        ? [householdId, agentDataKey() != null]
        : key === 'smart-home'
          ? [householdId, homeAssistantServerDefaultConfigured()]
          : [householdId];
    const [row]: { hasData: boolean }[] = await this.db.query(
      `SELECT EXISTS(${query} LIMIT 1) AS "hasData"`,
      parameters,
    );
    return row.hasData;
  }

  async list(user: JwtUser): Promise<{ modules: SystemModuleState[] }> {
    const [states, overrides] = await Promise.all([
      Promise.all(
        SHELF_MODULE_KEYS.map(async (key) => ({
          key,
          hasData: await this.hasData(key, user.householdId),
        })),
      ),
      this.db.query<{ key: ShelfModuleKey; override: ModuleOverride }[]>(
        'SELECT key, override FROM household_module_overrides WHERE household_id = $1',
        [user.householdId],
      ),
    ]);
    const byKey = new Map(overrides.map((row) => [row.key, row.override]));
    return {
      modules: states.map((state) => ({
        ...state,
        override: byKey.get(state.key) ?? null,
      })),
    };
  }

  async update(
    key: ShelfModuleKey,
    override: ModuleOverride,
    user: JwtUser,
  ): Promise<SystemModuleState> {
    if (override === null) {
      await this.db.query(
        'DELETE FROM household_module_overrides WHERE household_id = $1 AND key = $2',
        [user.householdId, key],
      );
    } else {
      await this.db.query(
        `INSERT INTO household_module_overrides (household_id, key, override, updated_by)
        VALUES ($1, $2, $3, $4) ON CONFLICT (household_id, key)
        DO UPDATE SET override = EXCLUDED.override, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [user.householdId, key, override, user.memberId],
      );
    }
    return {
      key,
      override,
      hasData: await this.hasData(key, user.householdId),
    };
  }
}
