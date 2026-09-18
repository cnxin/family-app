import { useState } from 'react';
import type { TravelPackingTemplate, TravelPlan } from '@family/contracts';
import { travelKey, useApplyTravelTemplate, useTravelTemplates } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Dialog } from './ui';

/**
 * 应用模板：同一个模板对同一个行程只能应用一次（后端唯一约束），已经用过的在这儿置灰。
 * 要同时带行程和模板两个版本号，任一被人改过都会 409。
 */
export function ApplyTemplateDialog({ plan, onClose }: { plan: TravelPlan; onClose: () => void }) {
  const templates = useTravelTemplates();
  const apply = useApplyTravelTemplate();
  const [picked, setPicked] = useState<TravelPackingTemplate | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const usable = (templates.data ?? []).filter((one) => !one.archivedAt);

  function confirm() {
    if (!picked) return;
    setMessage(null);
    apply.mutate(
      {
        planId: plan.id,
        templateId: picked.id,
        expectedPlanVersion: plan.version,
        expectedTemplateVersion: picked.version,
        idempotencyKey: travelKey(`travel:template:apply:${plan.id}:${picked.id}`),
      },
      {
        onSuccess: () => {
          pushToast(`加了 ${picked.items.length} 项到清单`);
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没加进去'),
      },
    );
  }

  return (
    <Dialog
      title={picked ? `用「${picked.title}」？` : '选一个打包模板'}
      maxWidth={520}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          {picked ? (
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setPicked(null)}>
                换一个
              </Button>
              <Button className="flex-1" disabled={apply.isPending} onClick={confirm}>
                {apply.isPending ? '添加中…' : '加到清单'}
              </Button>
            </div>
          ) : null}
        </div>
      }
    >
      {picked ? (
        <p className="text-[13px] text-ink-soft">
          会往「{plan.title}」的清单里加 {picked.items.length} 项。同一个模板只能用一次，不会重复加。
        </p>
      ) : templates.isPending ? (
        <p className="text-[13px] text-ink-soft">正在读模板…</p>
      ) : usable.length === 0 ? (
        <p className="text-[13px] text-ink-soft">还没有可用的打包模板，先去「打包模板」建一个。</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {usable.map((template) => {
            const used = plan.appliedTemplateIds.includes(template.id);
            return (
              <button
                key={template.id}
                type="button"
                aria-label={template.title}
                disabled={used}
                onClick={() => setPicked(template)}
                className={
                  'rounded-lg border px-3 py-2 text-left transition-colors duration-150 ' +
                  (used ? 'border-border opacity-50' : 'border-border hover:bg-muted')
                }
              >
                <p className="truncate text-[14px]">{template.title}</p>
                <p className="text-[12px] text-ink-soft">
                  {template.items.length} 项{used ? ' · 已经用过了' : ''}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
