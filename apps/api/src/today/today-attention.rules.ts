import { Injectable } from '@nestjs/common';
import type { AttentionItem } from '@family/contracts';
import type { Capability } from '../auth/capabilities';

export const ATTENTION_THRESHOLDS = {
  maintenanceDays: 7,
  renewalDays: 3,
  warrantyDays: 30,
  guestDays: 7,
  travelDays: 7,
  inventoryDays: 3,
  backupWorkerOfflineSeconds: 90,
} as const;

export type AttentionRuleContext = {
  householdId: string;
  memberId: string;
  timezone: string;
  now: Date;
  today: string;
  horizons: {
    maintenance: string;
    renewal: string;
    warranty: string;
    guests: string;
    travel: string;
    inventory: string;
  };
  month: { start: string; end: string };
};

export type AttentionCandidate = {
  domain: AttentionItem['domain'];
  kind: string;
  id: string;
  name: string;
  dueOn?: string;
  overdue: boolean;
};

/**
 * 往今天页挂留意规则的唯一入口（H3 E5 智能家居起，J1.7 起全部 12 个域 / 内核来源）。各域模块在自己目录里
 * register，今天页只认这个接口，不 import 任何域的代码。模块开关、排序、能力门槛都按 manifest
 * （内核的按 CORE_ATTENTION）里的 attention 声明统一判，规则自己只管「判什么」。
 */
export interface AttentionSource {
  domain: AttentionItem['domain'];
  /** 这个来源会产出的留意种类，必须与 manifest / CORE_ATTENTION 声明的 kind 一致（check-plugins 断言）。 */
  kinds: readonly string[];
  run(context: AttentionRuleContext, can: (capability: Capability) => boolean): Promise<AttentionCandidate[]>;
}

@Injectable()
export class AttentionRegistry {
  private readonly sources: AttentionSource[] = [];

  register(source: AttentionSource) {
    this.sources.push(source);
  }

  list(): readonly AttentionSource[] {
    return this.sources;
  }
}
