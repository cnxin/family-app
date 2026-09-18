import { useState } from 'react';
import type { MediaConnectorSettings } from '@family/contracts';
import {
  useMediaConnectorSettings,
  useResetConnectorSettings,
  useRotateMoviePilotWebhook,
  useRotatePlaybackWebhook,
  useSaveConnectorSettings,
  useTestConnector,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { ListSkeleton } from './skeleton';
import {
  CredentialField,
  Field,
  ResultLine,
  SettingsBadge,
  ToggleRow,
  modeLabel,
} from './media-settings-parts';
import { Button, EmptyState, Input, Panel } from './ui';

/** Plex 用 Token，Emby/MoviePilot 用 API Key——标签写对，不然填的人会填错东西。 */
function credentialLabel(kind: MediaConnectorSettings['kind']) {
  return kind === 'plex' ? 'Token' : 'API Key';
}

function ConnectorCard({ config }: { config: MediaConnectorSettings }) {
  const save = useSaveConnectorSettings();
  const reset = useResetConnectorSettings();
  const test = useTestConnector();
  const rotateMoviePilot = useRotateMoviePilotWebhook();
  const rotatePlayback = useRotatePlaybackWebhook();

  const [form, setForm] = useState({
    name: config.name,
    isEnabled: config.isEnabled,
    baseUrl: config.baseUrl ?? '',
    isPrimary: config.isPrimary,
    sourceIp: config.webhookSourceIp ?? '',
  });
  const [credential, setCredential] = useState('');
  const [clearing, setClearing] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState<string | null>(null);
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null);

  const busy =
    save.isPending ||
    reset.isPending ||
    test.isPending ||
    rotateMoviePilot.isPending ||
    rotatePlayback.isPending;

  function patch(next: Partial<typeof form>) {
    setForm((current) => ({ ...current, ...next }));
  }

  function fail(error: unknown, fallback: string) {
    setResult({ message: error instanceof Error ? error.message : fallback, ok: false });
  }

  async function submit(alsoTest: boolean) {
    setResult(null);
    try {
      await save.mutateAsync({
        kind: config.kind,
        body: {
          name: form.name.trim() || config.name,
          isEnabled: form.isEnabled,
          baseUrl: form.baseUrl.trim() || null,
          ...(credential.trim() ? { credential: credential.trim() } : {}),
          ...(clearing ? { clearCredential: true } : {}),
          ...(config.role === 'library' ? { isPrimary: form.isPrimary } : {}),
        },
      });
      setCredential('');
      setClearing(false);
      if (!alsoTest) {
        setResult({ message: '已保存', ok: true });
        pushToast(`${config.name} 已保存`);
        return;
      }
      const status = await test.mutateAsync(config.kind);
      setResult({
        message: `${status.available ? '连接成功' : '连接失败'} · ${status.message}`,
        ok: status.available,
      });
    } catch (error) {
      fail(error, '保存失败');
    }
  }

  async function restore() {
    setResult(null);
    try {
      const list = await reset.mutateAsync(config.kind);
      // 恢复默认是整份换掉，本地表单得跟着服务器默认值走，不然屏幕上还是旧的那套。
      const restored = list.find((one) => one.kind === config.kind);
      if (restored) {
        setForm({
          name: restored.name,
          isEnabled: restored.isEnabled,
          baseUrl: restored.baseUrl ?? '',
          isPrimary: restored.isPrimary,
          sourceIp: restored.webhookSourceIp ?? '',
        });
      }
      setCredential('');
      setClearing(false);
      setCallbackUrl(null);
      setResult({ message: '已恢复服务器默认设置', ok: true });
    } catch (error) {
      fail(error, '恢复失败');
    }
  }

  async function rotate() {
    setResult(null);
    try {
      const rotated =
        config.kind === 'moviepilot'
          ? await rotateMoviePilot.mutateAsync({ sourceIp: form.sourceIp.trim() || undefined })
          : await rotatePlayback.mutateAsync({
              provider: config.kind,
              sourceIp: form.sourceIp.trim() || undefined,
            });
      patch({ sourceIp: rotated.sourceIp });
      // 回调路径里的密钥只这一次回传，之后后端再也不给了——所以这行要留在屏幕上，
      // 别被任何刷新顶掉；用户自己复制走贴到 Plex/Emby/MoviePilot 里。
      setCallbackUrl(`${window.location.origin}/api${rotated.callbackPath}`);
      setResult({
        message: config.webhookConfigured ? '已重新生成回调地址' : '已生成回调地址',
        ok: true,
      });
    } catch (error) {
      fail(error, '生成回调地址失败');
    }
  }

  const label = credentialLabel(config.kind);
  const webhookTitle = config.kind === 'moviepilot' ? '完成通知回调' : '播放记录回调';

  return (
    <Panel grow={false}>
      <div className="flex items-start gap-3 border-b border-border px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{config.name}</p>
          <p className="text-[12px] text-ink-soft">
            {modeLabel(config.mode)} · {config.role === 'library' ? '媒体库' : '自动化'}
          </p>
        </div>
        <SettingsBadge enabled={config.isEnabled} configured={config.configured} />
      </div>

      <div className="flex flex-col gap-3 px-3.5 py-3">
        <ToggleRow
          label={`启用${config.name}`}
          checked={form.isEnabled}
          disabled={busy}
          onChange={() => patch({ isEnabled: !form.isEnabled })}
        />
        {config.role === 'library' ? (
          <ToggleRow
            label={`把${config.name}设为主媒体库`}
            checked={form.isPrimary}
            disabled={busy || !form.isEnabled}
            onChange={() => patch({ isPrimary: !form.isPrimary })}
          />
        ) : null}

        <Field label="服务名称">
          <Input
            aria-label={`${config.name} 服务名称`}
            disabled={busy}
            value={form.name}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </Field>
        <Field label="服务地址">
          <Input
            aria-label={`${config.name} 服务地址`}
            autoComplete="off"
            placeholder="http://192.168.1.10:端口"
            disabled={busy}
            value={form.baseUrl}
            onChange={(event) => patch({ baseUrl: event.target.value })}
          />
        </Field>
        <CredentialField
          name={config.name}
          label={label}
          configured={config.credentialConfigured}
          hint={config.credentialHint}
          value={credential}
          onChange={setCredential}
          clearing={clearing}
          onToggleClear={() => {
            setClearing((value) => !value);
            setCredential('');
          }}
          disabled={busy}
        />

        {result ? <ResultLine message={result.message} ok={result.ok} /> : null}

        <div className="flex flex-wrap gap-2">
          <Button className="h-9" disabled={busy} onClick={() => void submit(false)}>
            保存 {config.name}
          </Button>
          <Button variant="outline" className="h-9" disabled={busy} onClick={() => void submit(true)}>
            保存并测试
          </Button>
          {config.mode === 'household' ? (
            <Button
              variant="ghost"
              className="h-9"
              aria-label={`恢复${config.name}默认设置`}
              disabled={busy}
              onClick={() => void restore()}
            >
              恢复默认
            </Button>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-border px-3 py-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium">{webhookTitle}</p>
            <p className="text-[12px] text-ink-soft">
              {config.webhookConfigured
                ? `已启用${config.playbackServerId ? ` · ${config.playbackServerId.slice(-8)}` : ''}`
                : '未生成'}
            </p>
          </div>
          <Field label="允许来源 IP">
            <Input
              aria-label={`${config.name} 回调允许来源 IP`}
              autoComplete="off"
              placeholder="192.168.1.10"
              disabled={busy}
              value={form.sourceIp}
              onChange={(event) => patch({ sourceIp: event.target.value })}
            />
          </Field>
          {callbackUrl ? (
            <Field label={`${config.name} 回调地址`}>
              <textarea
                readOnly
                aria-label={`${config.name} 回调地址`}
                value={callbackUrl}
                rows={2}
                className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-[12px] text-ink"
              />
            </Field>
          ) : config.webhookConfigured ? (
            <p className="text-[12px] text-ink-soft">回调地址已隐藏，重新生成后只显示这一次</p>
          ) : null}
          <div>
            <Button
              variant="outline"
              className="h-9"
              aria-label={`${config.webhookConfigured ? '重新生成' : '生成'}${config.name}回调地址`}
              disabled={busy}
              onClick={() => void rotate()}
            >
              {config.webhookConfigured ? '重新生成回调地址' : '生成回调地址'}
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

export function MediaConnectorSettingsPanel() {
  const connectors = useMediaConnectorSettings();

  if (connectors.isPending) {
    return (
      <Panel className="p-3">
        <ListSkeleton rows={3} />
      </Panel>
    );
  }
  if (connectors.isError || !connectors.data?.length) {
    return (
      <Panel className="p-3">
        <EmptyState emoji="🔌" title="媒体服务读不出来" hint="刷新一下，还不行就看看 API 服务" />
      </Panel>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {connectors.data.map((config) => (
        <ConnectorCard key={config.kind} config={config} />
      ))}
    </div>
  );
}
