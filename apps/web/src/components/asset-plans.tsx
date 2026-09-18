import { useState } from 'react';
import type { HomeAsset, MaintenanceConsumable, MaintenancePlan } from '@family/contracts';
import {
  assetDateLabel,
  useRemoveMaintenanceConsumable,
  useUpdateMaintenancePlan,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { dueLabel } from '../pages/assets';
import { CompletionForm } from './asset-completion-form';
import { ConsumableForm, PlanForm } from './asset-plan-forms';
import { SoftLink } from './soft-link';
import { Button, Dialog, EmptyState, Panel } from './ui';

function ConsumableRow({
  consumable,
  disabled,
  onEdit,
  onRemove,
}: {
  consumable: MaintenanceConsumable;
  disabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  // 关联时记下的单位和库存现在的单位对不上，扣库就会算错——这种时候先说出来
  const mismatch = consumable.unit !== consumable.inventoryItem.unit;
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px]">
          {consumable.inventoryItem.name} · 每次 {Number(consumable.quantity)} {consumable.unit}
        </p>
        <p className={'text-[12px] ' + (mismatch ? 'text-warm' : 'text-ink-soft')}>
          {mismatch
            ? `库存单位已经变成 ${consumable.inventoryItem.unit}`
            : `现有 ${Number(consumable.inventoryItem.quantity)} ${consumable.inventoryItem.unit}`}
        </p>
      </div>
      <Button
        variant="ghost"
        className="h-7 shrink-0 px-2 text-[12px]"
        disabled={disabled}
        aria-label={`编辑耗材${consumable.inventoryItem.name}`}
        onClick={onEdit}
      >
        改
      </Button>
      <Button
        variant="ghost"
        className="h-7 shrink-0 px-2 text-[12px] text-danger"
        disabled={disabled}
        aria-label={`移除耗材${consumable.inventoryItem.name}`}
        onClick={onRemove}
      >
        移除
      </Button>
    </div>
  );
}

export function AssetPlansPanel({ asset }: { asset: HomeAsset }) {
  const update = useUpdateMaintenancePlan();
  const removeConsumable = useRemoveMaintenanceConsumable();
  const [adding, setAdding] = useState(false);
  const [completing, setCompleting] = useState<MaintenancePlan | null>(null);
  const [editingConsumable, setEditingConsumable] = useState<{
    plan: MaintenancePlan;
    consumable: MaintenanceConsumable | null;
  } | null>(null);
  const [removing, setRemoving] = useState<MaintenanceConsumable | null>(null);

  const active = asset.status === 'active';

  function togglePlan(plan: MaintenancePlan) {
    update.mutate(
      { assetId: asset.id, planId: plan.id, body: { isEnabled: !plan.isEnabled } },
      {
        onSuccess: () =>
          pushToast(
            plan.isEnabled ? `「${plan.title}」已停用，待发的提醒一并取消` : `「${plan.title}」已启用`,
          ),
      },
    );
  }

  return (
    <Panel
      title={`维护计划 ${asset.maintenancePlans.length}`}
      right={
        active ? (
          <Button variant="ghost" className="h-7 px-2 text-[12px]" onClick={() => setAdding(true)}>
            + 新增计划
          </Button>
        ) : null
      }
    >
      {asset.maintenancePlans.length === 0 ? (
        <EmptyState emoji="🔧" title="还没有维护计划" hint="定期要做的保养可以排进来" />
      ) : (
        asset.maintenancePlans.map((plan, index) => {
          const due = dueLabel(plan.nextDueDate);
          return (
            <article
              key={plan.id}
              aria-label={plan.title}
              className={'px-3.5 py-3 ' + (index ? 'border-t border-border' : '')}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{plan.title}</span>
                <span
                  className={
                    'shrink-0 rounded-full px-2 py-0.5 text-[11px] ' +
                    (!plan.isEnabled
                      ? 'bg-muted text-ink-soft'
                      : due.urgent
                        ? 'bg-danger/10 text-danger'
                        : 'bg-warm-soft text-warm')
                  }
                >
                  {plan.isEnabled ? due.text : '已停用'}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-ink-soft">
                每 {plan.frequencyDays} 天 · 下次 {assetDateLabel(plan.nextDueDate)}
              </p>
              {plan.note ? <p className="mt-1 text-[12px] text-ink-soft">{plan.note}</p> : null}

              <div className="mt-2 flex flex-col gap-1.5">
                {plan.consumables.map((consumable) => (
                  <ConsumableRow
                    key={consumable.id}
                    consumable={consumable}
                    disabled={!active}
                    onEdit={() => setEditingConsumable({ plan, consumable })}
                    onRemove={() => setRemoving(consumable)}
                  />
                ))}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Button
                  variant="outline"
                  className="h-8 px-2.5 text-[12px]"
                  disabled={!active || !plan.isEnabled}
                  onClick={() => setCompleting(plan)}
                >
                  完成维护
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 px-2.5 text-[12px]"
                  disabled={!active}
                  aria-label={`给${plan.title}关联耗材`}
                  onClick={() => setEditingConsumable({ plan, consumable: null })}
                >
                  关联耗材
                </Button>
                {active && plan.isEnabled ? (
                  <SoftLink
                    to={`/schedule/reminders?sourceModule=maintenance&sourceId=${plan.id}`}
                    className="rounded-lg px-2.5 py-1.5 text-[12px] text-ink-soft hover:bg-muted hover:text-ink"
                  >
                    设置提醒
                  </SoftLink>
                ) : null}
                <Button
                  variant="ghost"
                  className={'h-8 px-2.5 text-[12px] ' + (plan.isEnabled ? '' : 'text-accent')}
                  disabled={update.isPending}
                  aria-label={`${plan.isEnabled ? '停用' : '启用'}${plan.title}`}
                  onClick={() => togglePlan(plan)}
                >
                  {plan.isEnabled ? '停用' : '启用'}
                </Button>
              </div>
            </article>
          );
        })
      )}

      {adding ? (
        <PlanForm assetId={asset.id} assetName={asset.name} onClose={() => setAdding(false)} />
      ) : null}

      {completing ? (
        <CompletionForm
          assetId={asset.id}
          plan={completing}
          onClose={() => setCompleting(null)}
        />
      ) : null}

      {editingConsumable ? (
        <ConsumableForm
          assetId={asset.id}
          plan={editingConsumable.plan}
          editing={editingConsumable.consumable}
          onClose={() => setEditingConsumable(null)}
        />
      ) : null}

      {removing ? (
        <Dialog
          title={`不再用「${removing.inventoryItem.name}」？`}
          onClose={() => setRemoving(null)}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setRemoving(null)}>
                取消
              </Button>
              <Button
                className="flex-1"
                disabled={removeConsumable.isPending}
                onClick={() =>
                  removeConsumable.mutate(
                    { assetId: asset.id, consumableId: removing.id },
                    {
                      onSuccess: () => {
                        setRemoving(null);
                        pushToast('耗材关联已移除');
                      },
                    },
                  )
                }
              >
                移除关联
              </Button>
            </div>
          }
        >
          <p className="text-[13px] text-ink-soft">
            只解除维护计划和这个库存项的关联，已有的维护记录和购物项都留着。
          </p>
        </Dialog>
      ) : null}
    </Panel>
  );
}
