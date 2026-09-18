import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ASSET_CATEGORY_LABELS,
  ASSET_DOCUMENT_LABELS,
  WARRANTY_CATEGORIES,
  assetDateLabel,
  useAsset,
  useAssetDocumentAccess,
  useUpsertAsset,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { AssetForm } from '../components/asset-form';
import { ExpiryCard } from '../components/asset-expiry';
import { SoftLink } from '../components/soft-link';
import { ListSkeleton } from '../components/skeleton';
import { Button, Dialog, EmptyState, Page, Panel } from '../components/ui';
import { dueLabel } from './assets';

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-ink-soft">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px]">{value}</dd>
    </div>
  );
}

export function AssetDetailPage() {
  const id = useParams<{ id: string }>().id;
  const asset = useAsset(id);
  const save = useUpsertAsset();
  const openDocument = useAssetDocumentAccess();
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  if (asset.isPending) {
    return (
      <Page title="资产详情" subtitle="正在读档案">
        <Panel className="p-3">
          <ListSkeleton rows={4} />
        </Panel>
      </Page>
    );
  }

  if (asset.isError || !asset.data) {
    return (
      <Page title="资产详情" subtitle="这一项可能已经被移除">
        <Panel className="p-3">
          <EmptyState
            emoji="📦"
            title="打不开这项资产"
            hint={<SoftLink to="/house/assets" className="text-accent hover:underline">回资产列表 →</SoftLink>}
          />
        </Panel>
      </Page>
    );
  }

  const data = asset.data;
  const retired = data.status === 'retired';
  const showExpiry = data.category === 'subscription' || WARRANTY_CATEGORIES.includes(data.category);

  function toggleStatus() {
    save.mutate(
      { id: data.id, body: { status: retired ? 'active' : 'retired' } },
      {
        onSuccess: () => {
          setAsking(false);
          pushToast(retired ? `「${data.name}」恢复使用` : `「${data.name}」已停用，相关待发提醒一并取消`);
        },
      },
    );
  }

  async function open(documentId: string, title: string) {
    setOpeningId(documentId);
    try {
      // 先开一个空标签页再填地址：等接口回来再 window.open 会被浏览器当成弹窗拦掉。
      const tab = window.open('', '_blank', 'noopener,noreferrer');
      const access = await openDocument.mutateAsync(documentId);
      const url = access.url.startsWith('http') ? access.url : `/api${access.url}`;
      if (tab) tab.location.href = url;
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : `「${title}」暂时打不开`);
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <Page
      title={data.name}
      subtitle={
        <>
          <SoftLink to="/house/assets" className="text-accent hover:underline">
            ← 家庭资产
          </SoftLink>
          {' · '}
          {[ASSET_CATEGORY_LABELS[data.category], data.location || '没记存放位置']
            .filter(Boolean)
            .join(' · ')}
          {retired ? ' · 已停用' : ''}
        </>
      }
      actions={
        <div className="flex gap-1.5">
          <Button
            variant="ghost"
            className={'h-9 px-3 text-[13px] ' + (retired ? 'text-accent' : '')}
            onClick={() => setAsking(true)}
          >
            {retired ? '恢复使用' : '停用资产'}
          </Button>
          <Button variant="outline" className="h-9 px-3 text-[13px]" onClick={() => setEditing(true)}>
            编辑档案
          </Button>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {showExpiry ? <ExpiryCard asset={data} /> : null}

        <Panel title={`维护计划 ${data.maintenancePlans.length}`}>
          {data.maintenancePlans.length === 0 ? (
            <EmptyState emoji="🔧" title="还没有维护计划" hint="定期要做的保养可以排进来" />
          ) : (
            data.maintenancePlans.map((plan, index) => {
              const due = dueLabel(plan.nextDueDate);
              return (
                <div
                  key={plan.id}
                  aria-label={plan.title}
                  className={'px-3.5 py-3 ' + (index ? 'border-t border-border' : '')}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                      {plan.title}
                    </span>
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
                    {plan.consumables.length ? ` · ${plan.consumables.length} 项耗材` : ''}
                  </p>
                  {plan.note ? <p className="mt-1 text-[12px] text-ink-soft">{plan.note}</p> : null}
                </div>
              );
            })
          )}
        </Panel>

        {data.maintenanceRecords.length ? (
          <Panel title="维护记录" grow={false}>
            {data.maintenanceRecords.map((record, index) => {
              const plan = data.maintenancePlans.find((one) => one.id === record.planId);
              return (
                <div
                  key={record.id}
                  className={'px-3.5 py-2.5 ' + (index ? 'border-t border-border' : '')}
                >
                  <p className="text-[13px] font-medium">{plan?.title ?? '维护完成'}</p>
                  <p className="mt-0.5 text-[12px] text-ink-soft">
                    {new Intl.DateTimeFormat('zh-CN', {
                      year: 'numeric',
                      month: 'numeric',
                      day: 'numeric',
                    }).format(new Date(record.performedAt))}
                    {' · '}
                    {record.performedBy.name}
                    {record.cost ? ` · ¥${Number(record.cost)}` : ''}
                    {' · '}下次 {assetDateLabel(record.nextDueDateAfter)}
                  </p>
                  {record.consumablesSnapshot.length ? (
                    <p
                      className={
                        'mt-0.5 text-[12px] ' +
                        (record.inventoryConfirmation?.reversed
                          ? 'text-warm'
                          : record.inventoryConfirmation
                            ? 'text-accent'
                            : 'text-ink-soft')
                      }
                    >
                      {record.inventoryConfirmation?.reversed
                        ? '耗材扣库已撤销'
                        : record.inventoryConfirmation
                          ? `已扣减 ${record.consumablesSnapshot.length} 项耗材`
                          : `记了 ${record.consumablesSnapshot.length} 项耗材，这次没扣库`}
                    </p>
                  ) : null}
                  {record.note ? (
                    <p className="mt-0.5 text-[12px] text-ink-soft">{record.note}</p>
                  ) : null}
                </div>
              );
            })}
          </Panel>
        ) : null}
      </div>

      <aside className="flex shrink-0 flex-col gap-4 lg:w-[300px]">
        <Panel title="档案" grow={false}>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 px-3.5 py-3">
            <Info label="品牌" value={data.brand || '未记录'} />
            <Info label="型号" value={data.model || '未记录'} />
            <Info label="序列号" value={data.serialNumber || '未记录'} />
            <Info label="购入日期" value={assetDateLabel(data.purchaseDate)} />
            <Info
              label="购入价格"
              value={
                data.purchasePrice
                  ? `¥${Number(data.purchasePrice).toLocaleString('zh-CN')}`
                  : '未记录'
              }
            />
            <Info label="当前状态" value={retired ? '已停用' : '使用中'} />
          </dl>
          {data.note ? (
            <p className="border-t border-border px-3.5 py-2.5 text-[13px] text-ink-soft">
              {data.note}
            </p>
          ) : null}
        </Panel>

        <Panel title={`凭证与资料 ${data.documents.length}`} grow={false}>
          {data.documents.length === 0 ? (
            <p className="px-3.5 py-6 text-center text-[13px] text-ink-soft">
              发票、说明书、保修卡都可以收在这儿。
            </p>
          ) : (
            data.documents.map((document, index) => (
              <div
                key={document.id}
                className={
                  'flex items-center gap-2 px-3.5 py-2.5 ' + (index ? 'border-t border-border' : '')
                }
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px]">{document.title}</p>
                  <p className="text-[12px] text-ink-soft">
                    {ASSET_DOCUMENT_LABELS[document.type]} · {document.createdBy.name}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  className="h-8 shrink-0 px-2 text-[13px]"
                  aria-label={`打开资料${document.title}`}
                  disabled={openingId === document.id}
                  onClick={() => void open(document.id, document.title)}
                >
                  {openingId === document.id ? '打开中…' : '打开'}
                </Button>
              </div>
            ))
          )}
        </Panel>
      </aside>

      {editing ? <AssetForm editing={data} onClose={() => setEditing(false)} /> : null}

      {asking ? (
        <Dialog
          title={retired ? '恢复这项资产？' : '停用这项资产？'}
          onClose={() => setAsking(false)}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setAsking(false)}>
                取消
              </Button>
              <Button className="flex-1" disabled={save.isPending} onClick={toggleStatus}>
                {retired ? '恢复使用' : '确认停用'}
              </Button>
            </div>
          }
        >
          <p className="text-[13px] text-ink-soft">
            {retired
              ? '恢复之后可以继续排维护计划、设提醒。'
              : '停用会保留全部档案和历史，同时取消这项资产相关的待发送提醒。'}
          </p>
        </Dialog>
      ) : null}
    </Page>
  );
}
