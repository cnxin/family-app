import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ASSET_CATEGORY_LABELS,
  WARRANTY_CATEGORIES,
  assetDateLabel,
  useAsset,
  useUpsertAsset,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { AssetForm } from '../components/asset-form';
import { ExpiryCard } from '../components/asset-expiry';
import { AssetPlansPanel } from '../components/asset-plans';
import { AssetDocumentsPanel } from '../components/asset-documents';
import { SoftLink } from '../components/soft-link';
import { ListSkeleton } from '../components/skeleton';
import { Button, Dialog, EmptyState, Page, Panel } from '../components/ui';

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
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);

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

        <AssetPlansPanel asset={data} />

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

        <AssetDocumentsPanel asset={data} />
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
