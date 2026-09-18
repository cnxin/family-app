import { useState } from 'react';
import type { TravelPackingTemplate } from '@family/contracts';
import {
  TRAVEL_CATEGORY_EMOJI,
  travelKey,
  useTravelTemplateAction,
  useTravelTemplates,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { ListSkeleton } from './skeleton';
import { TemplateForm } from './travel-template-form';
import { Button, EmptyState, Panel } from './ui';

export function TemplatesPanel({
  creating,
  onCloseCreate,
}: {
  creating: boolean;
  onCloseCreate: () => void;
}) {
  const list = useTravelTemplates();
  const action = useTravelTemplateAction();
  const [editing, setEditing] = useState<TravelPackingTemplate | null>(null);

  const rows = list.data ?? [];

  return (
    <Panel className="p-3">
      {list.isPending ? (
        <ListSkeleton rows={3} />
      ) : list.isError ? (
        <EmptyState emoji="🧳" title="模板读不出来" hint="刷新一下，还不行就看看 API 服务" />
      ) : rows.length === 0 ? (
        <EmptyState
          emoji="🧳"
          title="还没有打包模板"
          hint="把家里每次都要带的东西存成模板，下次一键塞进清单"
        />
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((template) => {
            const archived = Boolean(template.archivedAt);
            return (
              <article
                key={template.id}
                aria-label={template.title}
                className={
                  'flex flex-col rounded-card border border-border px-3.5 py-3 ' +
                  (archived ? 'opacity-70' : '')
                }
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                    {template.title}
                  </span>
                  {archived ? (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-ink-soft">
                      已归档
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[12px] text-ink-soft">
                  {template.items.length} 项
                  {template.description ? ` · ${template.description}` : ''}
                </p>
                <p className="mt-1.5 line-clamp-2 text-[12px] text-ink-soft">
                  {template.items
                    .map(
                      (item) =>
                        `${TRAVEL_CATEGORY_EMOJI[item.category]}${item.title}${item.quantity > 1 ? `×${item.quantity}` : ''}`,
                    )
                    .join(' · ')}
                </p>
                {template.canManage ? (
                  <div className="mt-2 flex items-center gap-1.5 border-t border-border pt-2">
                    {archived ? null : (
                      <Button
                        variant="ghost"
                        className="h-8 px-2 text-[12px]"
                        aria-label={`编辑${template.title}`}
                        onClick={() => setEditing(template)}
                      >
                        编辑
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      className={'h-8 px-2 text-[12px] ' + (archived ? 'text-accent' : '')}
                      aria-label={`${archived ? '恢复' : '归档'}${template.title}`}
                      disabled={action.isPending}
                      onClick={() =>
                        action.mutate(
                          {
                            id: template.id,
                            action: archived ? 'restore' : 'archive',
                            expectedVersion: template.version,
                            idempotencyKey: travelKey(
                              `travel:template:${archived ? 'restore' : 'archive'}:${template.id}`,
                            ),
                          },
                          {
                            onSuccess: () =>
                              pushToast(archived ? '模板恢复了' : '模板归档了，已经用过的清单不受影响'),
                          },
                        )
                      }
                    >
                      {archived ? '恢复' : '归档'}
                    </Button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {creating || editing ? (
        <TemplateForm
          editing={editing}
          onClose={() => {
            onCloseCreate();
            setEditing(null);
          }}
        />
      ) : null}
    </Panel>
  );
}
