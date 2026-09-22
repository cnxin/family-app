import { useEffect, useMemo, useState } from 'react';
import type { AttentionItem } from '@family/contracts';
import { addDays, startOfHouseholdDay } from '@family/shared';
import { attentionCopy } from '../lib/attention-copy';
import { Button, Card, buttonClass } from './ui';
import { SoftLink } from './soft-link';

const snoozeKey = (memberId: string) => `fa.snooze.${memberId}`;
type Snoozed = Record<string, { until: number }>;

function read(memberId: string): Snoozed {
  if (!memberId || typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(snoozeKey(memberId)) ?? '{}') as Snoozed;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function write(memberId: string, value: Snoozed) {
  try {
    window.localStorage.setItem(snoozeKey(memberId), JSON.stringify(value));
  } catch {
    // 写不进去时，这次点击仍先在内存里藏起来
  }
}

/** 下一日的家庭零点，不能用 24 小时毫秒相加。 */
export function nextHouseholdMidnight(today: string, timezone: string) {
  return startOfHouseholdDay(timezone, addDays(today, 1)).getTime();
}

export function useAttentionSnooze(items: AttentionItem[], memberId: string) {
  const [now, setNow] = useState(() => Date.now());
  const [storedFor, setStoredFor] = useState(memberId);
  const [stored, setStored] = useState<Snoozed>(() => read(memberId));
  if (storedFor !== memberId) {
    setStoredFor(memberId);
    setStored(read(memberId));
  }
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === snoozeKey(memberId) || event.key === null) setStored(read(memberId));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [memberId]);
  const visible = useMemo(
    () => items.filter((item) => !stored[item.key] || stored[item.key].until <= now),
    [items, now, stored],
  );
  useEffect(() => {
    const deadlines = items
      .map((item) => stored[item.key]?.until)
      .filter((until): until is number => typeof until === 'number' && until > now);
    if (!deadlines.length) return undefined;
    const delay = Math.max(0, Math.min(...deadlines) - now) + 20;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(delay, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [items, now, stored]);
  const snooze = (key: string, until: number) => {
    const next = { ...stored, [key]: { until } };
    write(memberId, next);
    setStored(next);
    setNow((value) => value + 1);
  };
  return { visible, snooze };
}

export function AttentionCard({ item, today, onSnooze }: { item: AttentionItem; today: string; onSnooze: () => void }) {
  const copy = attentionCopy(item, today);
  return (
    <div data-attention-card className="contents">
      <Card className="flex min-h-[132px] flex-col justify-between p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-accent">{copy.domainLabel}</p>
            <p className="mt-1 text-[15px] font-semibold text-ink">{copy.title}</p>
          </div>
          <span className={`shrink-0 text-xs ${item.overdue ? 'text-danger' : 'text-ink-soft'}`}>{copy.timeText}</span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <SoftLink to={copy.path} className={buttonClass('primary', 'min-h-11')}>{copy.actionLabel}</SoftLink>
          <Button type="button" variant="ghost" className="min-h-11 px-3" onClick={onSnooze}>稍后</Button>
        </div>
      </Card>
    </div>
  );
}

export function AttentionSection({
  items,
  today,
  onSnooze,
}: {
  items: AttentionItem[];
  today: string;
  onSnooze: (key: string) => void;
}) {
  if (!items.length) return null;
  const shown = items.slice(0, 5);
  const rest = items.length - shown.length;
  return (
    <section aria-labelledby="attention-title">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 id="attention-title" className="text-[13px] font-semibold tracking-wide text-ink-soft">需要留意</h2>
      </div>
      <div className="grid gap-3">
        {shown.map((item) => <AttentionCard key={item.key} item={item} today={today} onSnooze={() => onSnooze(item.key)} />)}
        {rest > 0 ? <p className="rounded-lg bg-muted px-3 py-2 text-xs text-ink-soft">还有 {rest} 件需要留意</p> : null}
      </div>
    </section>
  );
}
