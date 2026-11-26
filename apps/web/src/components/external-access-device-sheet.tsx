import { useRef } from 'react';
import type { ExternalAccessDeviceDetail, ExternalAccessDeviceSummary } from '@family/contracts';
import { copyText, selectText } from '../lib/clipboard';
import {
  TONE_PILL,
  deviceStatusBadge,
  formatDateOnly,
  formatDateTime,
  formatKeyExpiry,
  formatRelativeSeen,
  osLabel,
} from '../lib/external-access-copy';
import { useExternalAccessDevice } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { useMediaQuery } from '../lib/use-media-query';
import { QueryFailure } from './query-state';
import { ListSkeleton } from './skeleton';
import { DetentSheet } from './ui/detent-sheet';
import { Button, Dialog } from './ui';

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2.5 text-[13px] last:border-b-0">
      <span className="shrink-0 text-ink-soft">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-ink">{value}</span>
    </div>
  );
}

function AddressChip({ address }: { address: string }) {
  const codeRef = useRef<HTMLElement>(null);
  async function copy() {
    const ok = await copyText(address);
    if (ok) {
      navigator.vibrate?.(10);
      pushToast(`已复制 ${address}`, undefined, 'success');
      return;
    }
    selectText(codeRef.current);
    pushToast('已选中地址，请手动复制', undefined, 'info');
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2">
      <code ref={codeRef} className="min-w-0 truncate font-mono text-[12px] text-ink">
        {address}
      </code>
      <Button variant="ghost" className="h-8 shrink-0 px-2.5 text-[12px]" onClick={() => void copy()}>
        复制
      </Button>
    </div>
  );
}

function DetailBody({
  detail,
  timeZone,
}: {
  detail: ExternalAccessDeviceDetail;
  timeZone: string;
}) {
  const expiry = formatKeyExpiry(detail);

  return (
    <div className="flex flex-col gap-4">
      <section>
        <p className="mb-1.5 text-[12px] font-medium text-ink-soft">Tailscale 地址</p>
        {detail.addresses.length ? (
          <div className="flex flex-col gap-1.5">
            {detail.addresses.map((address) => (
              <AddressChip key={address} address={address} />
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-ink-soft">控制面未返回地址</p>
        )}
      </section>

      {detail.tags.length ? (
        <section>
          <p className="mb-1.5 text-[12px] font-medium text-ink-soft">ACL 标签</p>
          <div className="flex flex-wrap gap-1.5">
            {detail.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-border bg-muted px-2.5 py-0.5 font-mono text-[11px] text-ink"
              >
                {tag}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-card border border-border bg-surface px-3.5 py-1">
        <InfoRow label="主机名" value={detail.hostname || '—'} />
        <InfoRow label="所属账号" value={detail.user ?? '标签节点 / 未知'} />
        <InfoRow label="系统" value={osLabel(detail.os)} />
        <InfoRow
          label="客户端版本"
          value={
            detail.clientVersion
              ? `${detail.clientVersion}${detail.updateAvailable ? '（有更新）' : ''}`
              : '—'
          }
        />
        <InfoRow label="授权状态" value={detail.authorized ? '已授权' : '待授权'} />
        <InfoRow label="最后在线" value={formatDateTime(detail.lastSeen, timeZone)} />
        <InfoRow
          label="密钥到期"
          value={
            detail.keyExpiryDisabled
              ? '已关闭密钥到期'
              : `${expiry.label}${detail.expires ? `（${formatDateOnly(detail.expires, timeZone)}）` : ''}`
          }
        />
        <InfoRow label="入站连接" value={detail.blocksIncomingConnections ? '已屏蔽入站' : '允许入站'} />
        <InfoRow label="加入时间" value={formatDateTime(detail.created, timeZone)} />
      </section>

      <p className="rounded-xl bg-muted/60 px-3 py-2.5 text-[12px] leading-relaxed text-ink-soft">
        当前为阶段 1 只读视图。如需授权新设备、移除旧设备或调整 ACL 策略，请前往 Tailscale 管理控制台操作。
      </p>
    </div>
  );
}

/** 单台 Tailscale 设备详情：手机用两档弹簧 sheet，桌面用居中弹窗。 */
export function ExternalAccessDeviceSheet({
  deviceId,
  summary,
  timeZone,
  onClose,
}: {
  deviceId: string;
  summary?: ExternalAccessDeviceSummary;
  timeZone: string;
  onClose: () => void;
}) {
  const mobile = useMediaQuery('(max-width: 639px)');
  const query = useExternalAccessDevice(deviceId);
  const current = query.data ?? summary;
  const title = current?.name ?? '设备详情';
  const status = current ? deviceStatusBadge(current) : null;

  const header = (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <h2 className="truncate text-[18px] font-semibold text-ink">{title}</h2>
          {current?.isServerNode ? (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
              小管家节点
            </span>
          ) : null}
        </div>
        {current ? (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-soft">
            {status ? (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_PILL[status.tone]}`}>
                {status.label}
              </span>
            ) : null}
            <span>{formatRelativeSeen(current.lastSeen, current.connectedToControl)}</span>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="grid size-11 shrink-0 place-items-center rounded-full bg-muted text-ink-soft transition-transform duration-150 active:scale-[.95]"
      >
        ✕
      </button>
    </div>
  );

  const body = query.isPending ? (
    <ListSkeleton rows={4} />
  ) : query.isError || !query.data ? (
    <QueryFailure onRetry={() => void query.refetch()} />
  ) : (
    <DetailBody detail={query.data} timeZone={timeZone} />
  );

  if (mobile) {
    return (
      <DetentSheet title={title} header={header} onClose={onClose} mediumShown={0.68}>
        <div className="pt-2">{body}</div>
      </DetentSheet>
    );
  }

  return (
    <Dialog title={title} onClose={onClose} maxWidth={520} titleBar={false}>
      <div className="mb-4">{header}</div>
      {body}
    </Dialog>
  );
}
