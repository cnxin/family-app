import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  findPlugin,
  pluginHasDataSql,
  SHELF_MODULE_KEYS,
  type ModuleOverride,
  type ShelfModuleKey,
  type SystemModuleState,
} from '@family/contracts';
import { JwtUser } from '../auth/jwt.guard';
import { agentDataKey } from '../common/config';
import { ModuleHasDataRegistry } from './module-has-data.registry';

// hasData 全部来自插件 manifest（J1）：tables 由 pluginHasDataSql 生成静态 SQL（标识符不来自请求，只有家庭 ID 走 $1，
// 同域多表 UNION 后只取存在性，每个分支都带家庭边界）；server 由插件在自己的模块里注册到 ModuleHasDataRegistry。
// 内核自己的两个：家庭动态永远有，小管家看 agent 开关。

@Injectable()
export class SystemModulesService {
  constructor(
    private readonly db: DataSource,
    private readonly hasDataProviders: ModuleHasDataRegistry,
  ) {}

  private async hasData(
    key: ShelfModuleKey,
    householdId: string,
  ): Promise<boolean> {
    if (key === 'activity') return true;
    const declared = findPlugin(key)?.module.hasData;
    if (declared?.kind === 'server') {
      const provider = this.hasDataProviders.get(declared.id);
      if (!provider) throw new Error(`模块 ${key} 的 hasData 判定 ${declared.id} 没有注册`);
      return provider(householdId);
    }
    const query =
      key === 'assistant'
        ? `SELECT 1 FROM agent_settings WHERE "householdId" = $1 AND enabled
         UNION ALL SELECT 1 FROM households WHERE id = $1 AND $2::boolean
           AND NOT EXISTS (SELECT 1 FROM agent_settings WHERE "householdId" = $1 LIMIT 1)`
        : pluginHasDataSql(key);
    if (!query) throw new Error(`模块 ${key} 没有 hasData 判定`);
    const parameters =
      key === 'assistant'
        ? [householdId, agentDataKey() != null]
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
