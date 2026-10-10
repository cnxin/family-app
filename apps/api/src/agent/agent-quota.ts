// 第 2 档（云端）的每日上限：J4.3 起按 run 次数算，J4.5 加锁，第四批起截图识别（AgentVisionService）也走这里。
import type { EntityManager } from 'typeorm';
import type { AgentRuntimeKind, AgentSetting } from '../entities';

export const CLOUD_RUNTIMES: readonly AgentRuntimeKind[] = ['hermes', 'native'];
export const DAILY_LIMIT_CODE = 'AGENT_DAILY_LIMIT';
export const DAILY_LIMIT_TEXT = '今天小管家的云端额度用完了，明天再问';

/**
 * 开 run 前的额度：云端按上海时区当天已开的第 2 档 run 数比 tier2DailyLimit，用完了这次就记成一条
 * 不执行的 failed run（errorCode = AGENT_DAILY_LIMIT，tier 留空不占额度）——既是审计，对话里也看得到原因。
 * 必须在插入 run 的同一个事务里调（J4.5）：先锁住这户的设置行（SELECT … FOR UPDATE），同一户并发开 run
 * 在这里排队，计数与插入之间不会被别人插进来；10 个并发也只放行额度内的。上限取锁住那一刻的值。
 * cloud 缺省按运行方式判；截图识别总是走云端模型，调用方传 true。
 */
export async function tier2Quota(
  manager: EntityManager,
  setting: AgentSetting,
  householdId: string,
  cloud = CLOUD_RUNTIMES.includes(setting.runtimeKind),
) {
  if (cloud) {
    const [locked]: { limit: number }[] = await manager.query(
      `SELECT "tier2DailyLimit" AS "limit" FROM agent_settings WHERE "householdId" = $1 FOR UPDATE`,
      [householdId],
    );
    const [row]: { used: number }[] = await manager.query(
      `SELECT COUNT(*)::int AS used FROM agent_runs
        WHERE "householdId" = $1 AND tier = 2
          AND "createdAt" >= (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')`,
      [householdId],
    );
    if (row.used >= (locked?.limit ?? setting.tier2DailyLimit)) {
      return {
        status: 'failed' as const,
        tier: null,
        redacted: false,
        finishedAt: new Date(),
        errorCode: DAILY_LIMIT_CODE,
        errorMessage: DAILY_LIMIT_TEXT,
      };
    }
  }
  return {
    status: 'queued' as const,
    tier: cloud ? 2 : null,
    redacted: setting.runtimeKind === 'native' && setting.tier2Redact,
    finishedAt: null,
    errorCode: null,
    errorMessage: null,
  };
}
