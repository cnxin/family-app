import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { addDays, householdToday, monthRange } from '@family/shared';
import type { AttentionItem } from '@family/contracts';
import { hasCapability, type Capability } from '../auth/capabilities';
import type { JwtUser } from '../auth/jwt.guard';
import { Clock } from '../common/clock';
import {
  AssetMaintenanceAttentionRule,
  AssetRenewalAttentionRule,
  AssetWarrantyAttentionRule,
  ATTENTION_THRESHOLDS,
  BackupAttentionRule,
  FinanceBudgetAttentionRule,
  GuestMealRequestAttentionRule,
  GuestMenuAttentionRule,
  InventoryExpiryAttentionRule,
  PointsRedemptionAttentionRule,
  PollAttentionRule,
  TravelChecklistAttentionRule,
  type AttentionCandidate,
  type AttentionRule,
  type AttentionRuleContext,
} from './today-attention.rules';

const DOMAIN_ORDER: AttentionItem['domain'][] = [
  'assets',
  'guests',
  'travel',
  'inventory',
  'polls',
  'points',
  'finance',
  'backups',
  'smart-home',
];

/** F3 shelf key 来自 contracts/src/system.ts；settings 域不参与 override。 */
const OFF_KEYS: Partial<Record<AttentionItem['domain'], string>> = {
  assets: 'assets',
  guests: 'guests',
  travel: 'travel',
  inventory: 'inventory',
  polls: 'polls',
  points: 'points',
  finance: 'finance',
};

@Injectable()
export class TodayAttentionService {
  constructor(
    private readonly db: DataSource,
    private readonly clock: Clock,
    private readonly assetMaintenance: AssetMaintenanceAttentionRule,
    private readonly assetRenewal: AssetRenewalAttentionRule,
    private readonly assetWarranty: AssetWarrantyAttentionRule,
    private readonly guestMenu: GuestMenuAttentionRule,
    private readonly guestRequests: GuestMealRequestAttentionRule,
    private readonly travelChecklist: TravelChecklistAttentionRule,
    private readonly inventoryExpiry: InventoryExpiryAttentionRule,
    private readonly poll: PollAttentionRule,
    private readonly pointsRedemption: PointsRedemptionAttentionRule,
    private readonly financeBudget: FinanceBudgetAttentionRule,
    private readonly backup: BackupAttentionRule,
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
    const rules: AttentionRule[] = [];

    if (allowed('assets')) {
      rules.push(this.assetMaintenance, this.assetRenewal, this.assetWarranty);
    }
    if (allowed('guests')) {
      rules.push(this.guestMenu);
      if (can('manage_guests')) rules.push(this.guestRequests);
    }
    if (allowed('travel')) rules.push(this.travelChecklist);
    if (allowed('inventory')) rules.push(this.inventoryExpiry);
    if (allowed('polls')) rules.push(this.poll);
    if (allowed('points') && can('manage_points')) rules.push(this.pointsRedemption);
    if (allowed('finance') && can('manage_finance')) rules.push(this.financeBudget);
    if (can('manage_integrations')) rules.push(this.backup);

    const candidates = (await Promise.all(rules.map((rule) => rule.run(context)))).flat();
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
        return {
          key: `${domain}:attention`,
          domain,
          kind: first.kind,
          count: entries.length,
          ...(entries.length === 1 ? { entity: { id: first.id, name: first.name } } : {}),
          ...(first.dueOn ? { dueOn: first.dueOn } : {}),
          overdue: entries.some((entry) => entry.overdue),
        } satisfies AttentionItem;
      })
      .sort(
        (a, b) => Number(b.overdue) - Number(a.overdue)
          || (a.dueOn ?? '9999-99-99').localeCompare(b.dueOn ?? '9999-99-99')
          || DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain),
      );
  }
}
