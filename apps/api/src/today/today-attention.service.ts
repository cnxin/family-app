import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { addDays, householdToday, monthRange } from '@family/shared';
import { allAttention, findPlugin, pluginAttention, type AttentionItem } from '@family/contracts';
import { hasCapability, type Capability } from '../auth/capabilities';
import type { JwtUser } from '../auth/jwt.guard';
import { Clock } from '../common/clock';
import {
  AttentionRegistry,
  ATTENTION_THRESHOLDS,
  type AttentionCandidate,
  type AttentionRuleContext,
} from './today-attention.rules';

/** 今天页里各域的排序位次（越小越靠前）。已迁插件取 manifest 的 attention.order。 */
const HANDWRITTEN_ORDER: Partial<Record<AttentionItem['domain'], number>> = {
  backups: 8,
};
const DOMAIN_ORDER: Partial<Record<AttentionItem['domain'], number>> = {
  ...HANDWRITTEN_ORDER,
  ...Object.fromEntries(pluginAttention().map(({ key, attention }) => [key, attention.order])),
};
const orderOf = (domain: AttentionItem['domain']) => DOMAIN_ORDER[domain] ?? Number.MAX_SAFE_INTEGER;

/**
 * 留意跟着哪个模块开关走（F3 shelf key 来自 contracts/src/system.ts）；settings 域不参与 override。
 * 已迁插件：manifest 里模块可开关的，就跟自己的 key 走。
 */
const HANDWRITTEN_OFF_KEYS: Partial<Record<AttentionItem['domain'], string>> = {
};
const OFF_KEYS: Partial<Record<AttentionItem['domain'], string>> = {
  ...HANDWRITTEN_OFF_KEYS,
  ...Object.fromEntries(
    pluginAttention()
      .filter(({ key }) => findPlugin(key)?.module.overridable)
      .map(({ key }) => [key, key]),
  ),
};

/**
 * 每种留意要什么能力才看得到（manifest / CORE_ATTENTION 里 kind 的 capability）。J1.7 前这四处写死在下面拼规则时：
 * 访客点菜 manage_guests、积分兑换 manage_points、超预算 manage_finance、备份 manage_integrations。
 */
const KIND_CAPABILITY = new Map<string, string>(
  allAttention().flatMap(({ key, attention }) =>
    attention.kinds.flatMap((kind) => (kind.capability ? [[`${key}:${kind.kind}`, kind.capability] as const] : [])),
  ),
);

@Injectable()
export class TodayAttentionService {
  constructor(
    private readonly db: DataSource,
    private readonly clock: Clock,
    private readonly registry: AttentionRegistry,
  ) {}

  async get(user: JwtUser): Promise<{ today: string; items: AttentionItem[] }> {
    const [household, overrides] = await Promise.all([
      this.db.query<{ timezone: string }[]>(
        'SELECT timezone FROM households WHERE id = $1',
        [user.householdId],
      ),
      this.db.query<{ key: string; override: 'on' | 'off' }[]>(
        'SELECT key, override FROM household_module_overrides WHERE household_id = $1',
        [user.householdId],
      ),
    ]);
    const timezone = household[0]?.timezone ?? 'Asia/Shanghai';
    const now = this.clock.now();
    const today = householdToday(timezone, now);
    const context: AttentionRuleContext = {
      householdId: user.householdId,
      memberId: user.memberId,
      timezone,
      now,
      today,
      horizons: {
        maintenance: addDays(today, ATTENTION_THRESHOLDS.maintenanceDays),
        renewal: addDays(today, ATTENTION_THRESHOLDS.renewalDays),
        warranty: addDays(today, ATTENTION_THRESHOLDS.warrantyDays),
        guests: addDays(today, ATTENTION_THRESHOLDS.guestDays),
        travel: addDays(today, ATTENTION_THRESHOLDS.travelDays),
        inventory: addDays(today, ATTENTION_THRESHOLDS.inventoryDays),
      },
      month: monthRange(today.slice(0, 7)),
    };
    const hidden = new Set(
      overrides.filter((row) => row.override === 'off').map((row) => row.key),
    );
    const allowed = (domain: AttentionItem['domain']) => {
      const key = OFF_KEYS[domain];
      return !key || !hidden.has(key);
    };
    const can = (capability: Capability) => hasCapability(user, capability);
    const permitted = (domain: string, kind: string) => {
      const capability = KIND_CAPABILITY.get(`${domain}:${kind}`);
      return !capability || can(capability as Capability);
    };

    // 模块关了不跑；一个来源产出的种类当前成员都看不到也不跑；跑出来的再按种类过一遍能力（智能家居一个来源出三种）
    const sources = this.registry
      .list()
      .filter((source) => allowed(source.domain) && source.kinds.some((kind) => permitted(source.domain, kind)));
    const candidates = (await Promise.all(sources.map((source) => source.run(context, can))))
      .flat()
      .filter((candidate) => permitted(candidate.domain, candidate.kind));
    return { today, items: this.merge(candidates) };
  }

  private merge(rows: AttentionCandidate[]): AttentionItem[] {
    const byDomain = new Map<AttentionItem['domain'], AttentionCandidate[]>();
    for (const row of rows) {
      byDomain.set(row.domain, [...(byDomain.get(row.domain) ?? []), row]);
    }
    return [...byDomain.entries()]
      .map(([domain, entries]) => {
        const sorted = entries.slice().sort(
          (a, b) => Number(b.overdue) - Number(a.overdue)
            || (a.dueOn ?? '9999-99-99').localeCompare(b.dueOn ?? '9999-99-99'),
        );
        const first = sorted[0];
        const kinds = [...new Set(sorted.map((entry) => entry.kind))];
        return {
          key: `${domain}:attention`,
          domain,
          kind: first.kind,
          kinds,
          count: entries.length,
          ...(entries.length === 1 ? { entity: { id: first.id, name: first.name } } : {}),
          ...(first.dueOn ? { dueOn: first.dueOn } : {}),
          overdue: entries.some((entry) => entry.overdue),
        } satisfies AttentionItem;
      })
      .sort(
        (a, b) => Number(b.overdue) - Number(a.overdue)
          || (a.dueOn ?? '9999-99-99').localeCompare(b.dueOn ?? '9999-99-99')
          || orderOf(a.domain) - orderOf(b.domain),
      );
  }
}
