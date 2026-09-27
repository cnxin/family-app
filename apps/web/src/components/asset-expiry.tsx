import { useState } from 'react';
import type { HomeAsset } from '@family/contracts';
import {
  RENEWAL_INTERVAL_LABELS,
  assetDateLabel,
  daysUntil,
  useRenewAsset,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog } from './ui';

type Tone = 'good' | 'warn' | 'bad' | 'plain';

const TONE_BOX: Record<Tone, string> = {
  good: 'bg-accent-soft text-accent',
  warn: 'bg-warm-soft text-warm',
  bad: 'bg-danger/10 text-danger',
  plain: 'bg-muted text-ink-soft',
};

/** 保修状态：到期前 30 天开始提醒，过期了就直说过了多少天。 */
function warrantyState(date: string | null): { title: string; detail: string; tone: Tone } {
  if (!date) return { title: '没记保修期限', detail: '可以在档案里补一个保修到期日', tone: 'plain' };
  const days = daysUntil(date);
  if (days < 0) return { title: '保修已到期', detail: `过去 ${-days} 天了`, tone: 'bad' };
  if (days === 0) return { title: '保修今天到期', detail: '要报修的话今天就得联系售后', tone: 'warn' };
  return {
    title: '还在保修期内',
    detail: `还剩 ${days} 天`,
    tone: days <= 30 ? 'warn' : 'good',
  };
}

/** 续费状态：14 天内算「快到了」——订阅扣款一般提前几天就该心里有数。 */
function renewalState(date: string | null): { title: string; detail: string; tone: Tone } {
  if (!date) return { title: '没记续费日期', detail: '可以在档案里补一个下次续费日期', tone: 'plain' };
  const days = daysUntil(date);
  if (days < 0) return { title: '续费日期已过', detail: `过去 ${-days} 天了，确认一下还在不在订`, tone: 'bad' };
  if (days === 0) return { title: '今天续费', detail: '确认一下是继续还是退订', tone: 'warn' };
  return {
    title: days <= 14 ? '快要续费了' : '订阅还在有效期内',
    detail: `${days} 天后续费`,
    tone: days <= 14 ? 'warn' : 'good',
  };
}

export function ExpiryCard({ asset }: { asset: HomeAsset }) {
  const renew = useRenewAsset();
  const [asking, setAsking] = useState(false);
  const subscription = asset.category === 'subscription';
  const state = subscription ? renewalState(asset.renewsOn) : warrantyState(asset.warrantyExpiresOn);
  const cycle = asset.renewalIntervalMonths
    ? RENEWAL_INTERVAL_LABELS[asset.renewalIntervalMonths]
    : '周期没设';

  return (
    <section className={`rounded-card px-4 py-3.5 ${TONE_BOX[state.tone]}`}>
      <p className="text-[15px] font-semibold">{state.title}</p>
      <p className="mt-0.5 text-[13px] opacity-90">{state.detail}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-current/15 pt-2.5 text-[13px]">
        <span>
          {subscription ? '下次续费' : '保修到期日'}：
          {assetDateLabel(subscription ? asset.renewsOn : asset.warrantyExpiresOn)}
          {subscription ? ` · ${cycle}` : ''}
        </span>
        {subscription && asset.status === 'active' && asset.renewalIntervalMonths ? (
          <Button
            variant="outline"
            className="h-8 px-3 text-[13px]"
            disabled={renew.isPending}
            onClick={() => setAsking(true)}
          >
            标记已续费
          </Button>
        ) : null}
      </div>

      {asking ? (
        <Dialog
          title="确认已经续费"
          onClose={() => setAsking(false)}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setAsking(false)}>
                再等等
              </Button>
              <Button
                className="flex-1"
                disabled={renew.isPending}
                onClick={() =>
                  renew.mutate(
                    { id: asset.id },
                    {
                      onSuccess: (saved) => {
                        setAsking(false);
                        pushToast(`已记下这次续费，下次是 ${assetDateLabel(saved.renewsOn)}`);
                      },
                    },
                  )
                }
              >
                {renew.isPending ? '记录中…' : '标记已续费'}
              </Button>
            </div>
          }
        >
          <p className="text-[13px] text-ink-soft">
            「{asset.name}」已经续过费了？下次日期会按{cycle}往后顺延。
          </p>
        </Dialog>
      ) : null}
    </section>
  );
}

