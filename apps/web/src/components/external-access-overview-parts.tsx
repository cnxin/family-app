import { useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type {
  ExternalAccessAlert,
  ExternalAccessDeviceSummary,
  ExternalAccessSummaryStats,
} from '@family/contracts';
import { copyText, selectText } from '../lib/clipboard';
import {
  TONE_PILL,
  deviceStatusBadge,
  formatKeyExpiry,
  formatRelativeSeen,
  osLabel,
} from '../lib/external-access-copy';
import { pushToast } from '../lib/toast';
import { Button, Panel } from './ui';

export function SummaryStrip({
  summary,
  attentionCount,
}: {
  summary: ExternalAccessSummaryStats;
  attentionCount?: number;
}) {
  const needsAttention =
    attentionCount ??
    summary.unauthorizedDevices + summary.expiringSoonCount + summary.staleOfflineCount;
  const cells = [
    { label: '全部设备', value: summary.totalDevices, tone: 'text-ink' },
    { label: '当前在线', value: summary.onlineDevices, tone: 'text-accent' },
    { label: '需要留意', value: needsAttention, tone: needsAttention > 0 ? 'text-warm' : 'text-ink-soft' },
    { label: '外部共享', value: summary.externalDevices, tone: 'text-ink-soft' },
  ];
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {cells.map((cell) => (
        <div
          key={cell.label}
          className="rounded-card border border-border bg-surface px-3.5 py-3"
        >
          <p className="text-[12px] text-ink-soft">{cell.label}</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${cell.tone}`}>
            {cell.value}
          </p>
        </div>
      ))}
    </div>
  );
}

export function AlertsBanner({
  alerts,
  onSelectDevice,
}: {
  alerts: ExternalAccessAlert[];
  onSelectDevice: (deviceId: string) => void;
}) {
  if (!alerts.length) return null;
  return (
    <section
      aria-label="需要留意的设备"
      className="motion-safe:animate-[float-in_180ms_cubic-bezier(0.22,1,0.36,1)] rounded-card border border-border bg-warm-soft/65 px-3.5 py-3"
    >
      <p className="text-[12px] font-semibold text-warm">需要留意（{alerts.length}）</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {alerts.map((alert) => (
          <li key={`${alert.kind}:${alert.deviceId}`}>
            <button
              type="button"
              onClick={() => onSelectDevice(alert.deviceId)}
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink transition-colors duration-150 hover:bg-surface/80 active:scale-[.99]"
            >
              <span className="min-w-0 flex-1 leading-snug">{alert.message}</span>
              <span className="shrink-0 text-[12px] text-accent">查看 ›</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ServerNodeCard({
  node,
  expectedHostname,
  onInspect,
}: {
  node: ExternalAccessDeviceSummary | null;
  expectedHostname: string | null;
  onInspect: (deviceId: string) => void;
}) {
  if (!node) {
    return (
      <Panel title="小管家所在节点" grow={false}>
        <div className="px-3.5 py-3.5 text-[13px] leading-relaxed text-ink-soft">
          {expectedHostname
            ? `还没在 tailnet 里找到名为「${expectedHostname}」的节点。请核对宿主机 Tailscale 节点名或前往设置调整。`
            : '尚未设置小管家节点名，可在设置页填写（默认 xiaoguanjia）以高亮本机节点。'}
        </div>
      </Panel>
    );
  }

  const status = deviceStatusBadge(node);
  const expiry = formatKeyExpiry(node);

  return (
    <Panel
      title="小管家所在节点"
      grow={false}
      right={
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_PILL[status.tone]}`}>
          {status.label}
        </span>
      }
    >
      <button
        type="button"
        onClick={() => onInspect(node.id)}
        className="flex w-full flex-col gap-2.5 px-3.5 py-3.5 text-left transition-colors duration-150 hover:bg-muted/60 active:scale-[.995]"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-ink">{node.name}</p>
            <p className="mt-0.5 truncate text-[12px] text-ink-soft">
              {osLabel(node.os)}
              {node.clientVersion ? ` · v${node.clientVersion}` : ''}
              {node.updateAvailable ? ' · 有可用更新' : ''}
            </p>
          </div>
          <span className="shrink-0 text-[12px] text-accent">详情 ›</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${TONE_PILL[expiry.tone]}`}>
            {expiry.label}
          </span>
          <span className="text-ink-soft">{formatRelativeSeen(node.lastSeen, node.connectedToControl)}</span>
        </div>
      </button>
    </Panel>
  );
}

/**
 * 私有入口卡片：二维码永远保持白底深色码（#ffffff / #111827），深色模式下手机相机也能稳定扫码。
 */
export function PublicAccessCard({
  publicUrl,
  corsOriginMatched,
}: {
  publicUrl: string;
  corsOriginMatched: boolean | null;
}) {
  const [showQr, setShowQr] = useState(false);
  const urlRef = useRef<HTMLParagraphElement>(null);

  async function handleCopy() {
    const ok = await copyText(publicUrl);
    if (ok) {
      navigator.vibrate?.(10);
      pushToast('外部访问地址已复制', undefined, 'success');
      return;
    }
    selectText(urlRef.current);
    pushToast('已选中地址，请手动复制', undefined, 'info');
  }

  return (
    <Panel title="外部访问入口" grow={false}>
      <div className="flex flex-col gap-3 px-3.5 py-3.5">
        <div>
          <p
            ref={urlRef}
            className="break-all rounded-lg border border-border bg-muted/50 px-3 py-2 font-mono text-[12px] text-ink"
          >
            {publicUrl}
          </p>
          {corsOriginMatched === false ? (
            <p className="mt-1.5 text-[12px] text-warm">
              ⚠ 该来源尚未匹配服务端 CORS_ORIGINS，手机外网访问前请核对生产环境配置。
            </p>
          ) : (
            <p className="mt-1.5 text-[12px] text-ink-soft">
              家人手机打开 Tailscale 登录同一 tailnet 后，用浏览器打开此地址即可访问小管家。
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-11 flex-1" onClick={() => void handleCopy()}>
            复制地址
          </Button>
          <Button
            variant="ghost"
            className="min-h-11 flex-1"
            aria-expanded={showQr}
            onClick={() => {
              navigator.vibrate?.(8);
              setShowQr((value) => !value);
            }}
          >
            {showQr ? '收起二维码' : '显示二维码'}
          </Button>
        </div>

        {showQr ? (
          <div className="motion-safe:animate-[float-in_180ms_cubic-bezier(0.22,1,0.36,1)] flex flex-col items-center gap-2 pt-1">
            <div
              role="img"
              aria-label={`外部访问地址 ${publicUrl} 的二维码`}
              className="w-fit rounded-xl border border-border bg-white p-3"
            >
              <QRCodeSVG value={publicUrl} size={172} bgColor="#ffffff" fgColor="#111827" />
            </div>
            <p className="text-center text-[11px] text-ink-soft">手机已连接 Tailscale 时扫码直达</p>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

export function DeviceRow({
  device,
  onSelect,
}: {
  device: ExternalAccessDeviceSummary;
  onSelect: () => void;
}) {
  const status = deviceStatusBadge(device);
  const expiry = formatKeyExpiry(device);

  return (
    <button
      type="button"
      onClick={onSelect}
      data-external-access-device={device.id}
      className="flex min-h-14 w-full items-center gap-3 border-b border-border px-3.5 py-3 text-left transition-colors duration-150 last:border-b-0 hover:bg-muted/70 active:scale-[.995]"
    >
      <span
        aria-hidden="true"
        className={`size-2.5 shrink-0 rounded-full ${
          !device.authorized
            ? 'bg-warm'
            : device.connectedToControl
              ? 'bg-accent'
              : 'bg-border'
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[14px] font-medium text-ink">{device.name}</span>
          {device.isServerNode ? (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
              小管家节点
            </span>
          ) : null}
          {device.isExternal ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-ink-soft">外部共享</span>
          ) : null}
          {device.updateAvailable ? (
            <span className="rounded-full bg-warm-soft px-2 py-0.5 text-[11px] text-warm">有更新</span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-[12px] text-ink-soft">
          {osLabel(device.os)}
          {device.user ? ` · ${device.user}` : ''}
          {' · '}
          {formatRelativeSeen(device.lastSeen, device.connectedToControl)}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_PILL[status.tone]}`}>
          {status.label}
        </span>
        <span className={`text-[11px] tabular-nums ${expiry.tone === 'danger' ? 'text-danger' : expiry.tone === 'warm' ? 'text-warm' : 'text-ink-soft'}`}>
          {expiry.label}
        </span>
      </div>
    </button>
  );
}
