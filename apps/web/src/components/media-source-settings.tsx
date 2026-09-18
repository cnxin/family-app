import { useState } from 'react';
import type { MediaCredentialKind, MediaSourceConfig } from '@family/contracts';
import { useMediaSourceSettings, useResetMediaSource, useSaveMediaSource } from '../lib/queries';
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
import { Button, EmptyState, Input, Panel, Segmented } from './ui';

const CREDENTIAL_LABELS: Record<MediaCredentialKind, string> = {
  token: 'API Token',
  api_key: 'API Key',
};

function SourceCard({ config }: { config: MediaSourceConfig }) {
  const save = useSaveMediaSource();
  const reset = useResetMediaSource();

  const [form, setForm] = useState({
    isEnabled: config.isEnabled,
    baseUrl: config.baseUrl ?? '',
    credentialKind: config.credentialKind,
    imageBaseUrl: config.settings.imageBaseUrl ?? '',
    userAgent: config.settings.userAgent ?? '',
  });
  const [credential, setCredential] = useState('');
  const [clearing, setClearing] = useState(false);
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null);
  const busy = save.isPending || reset.isPending;

  function patch(next: Partial<typeof form>) {
    setForm((current) => ({ ...current, ...next }));
  }

  async function submit() {
    setResult(null);
    try {
      await save.mutateAsync({
        provider: config.provider,
        body: {
          isEnabled: form.isEnabled,
          baseUrl: form.baseUrl.trim() || null,
          credentialKind: form.credentialKind,
          ...(credential.trim() ? { credential: credential.trim() } : {}),
          ...(clearing ? { clearCredential: true } : {}),
          // 只有这两家有额外字段，别的 provider 带上去后端会当成没设过
          ...(config.provider === 'tmdb' ? { imageBaseUrl: form.imageBaseUrl.trim() || null } : {}),
          ...(config.provider === 'bangumi' ? { userAgent: form.userAgent.trim() || null } : {}),
        },
      });
      setCredential('');
      setClearing(false);
      setResult({ message: '已保存', ok: true });
      pushToast(`${config.name} 已保存`);
    } catch (error) {
      setResult({ message: error instanceof Error ? error.message : '保存失败', ok: false });
    }
  }

  async function restore() {
    setResult(null);
    try {
      const list = await reset.mutateAsync(config.provider);
      const restored = list.find((one) => one.provider === config.provider);
      if (restored) {
        setForm({
          isEnabled: restored.isEnabled,
          baseUrl: restored.baseUrl ?? '',
          credentialKind: restored.credentialKind,
          imageBaseUrl: restored.settings.imageBaseUrl ?? '',
          userAgent: restored.settings.userAgent ?? '',
        });
      }
      setCredential('');
      setClearing(false);
      setResult({ message: '已恢复服务器默认设置', ok: true });
    } catch (error) {
      setResult({ message: error instanceof Error ? error.message : '恢复失败', ok: false });
    }
  }

  return (
    <Panel grow={false}>
      <div className="flex items-start gap-3 border-b border-border px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{config.name}</p>
          <p className="text-[12px] text-ink-soft">{modeLabel(config.mode)}</p>
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
        <Field label="API 地址">
          <Input
            aria-label={`${config.name} API 地址`}
            autoComplete="off"
            placeholder="https://"
            disabled={busy}
            value={form.baseUrl}
            onChange={(event) => patch({ baseUrl: event.target.value })}
          />
        </Field>

        {config.provider === 'tmdb' ? (
          <>
            <Field label="图片地址">
              <Input
                aria-label="TMDB 图片地址"
                autoComplete="off"
                placeholder="https://image.tmdb.org/t/p/w500"
                disabled={busy}
                value={form.imageBaseUrl}
                onChange={(event) => patch({ imageBaseUrl: event.target.value })}
              />
            </Field>
            <div>
              <span className="mb-1 block text-[12px] text-ink-soft">凭据类型</span>
              <Segmented<MediaCredentialKind>
                value={form.credentialKind}
                options={[
                  { value: 'token', label: 'API Token' },
                  { value: 'api_key', label: 'API Key' },
                ]}
                onChange={(value) => patch({ credentialKind: value })}
              />
            </div>
          </>
        ) : null}

        {config.provider === 'bangumi' ? (
          <Field label="User-Agent">
            <Input
              aria-label="Bangumi User-Agent"
              autoComplete="off"
              placeholder="family-app/0.1"
              disabled={busy}
              value={form.userAgent}
              onChange={(event) => patch({ userAgent: event.target.value })}
            />
          </Field>
        ) : null}

        <CredentialField
          name={config.name}
          label={CREDENTIAL_LABELS[form.credentialKind]}
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
          <Button className="h-9" disabled={busy} onClick={() => void submit()}>
            保存 {config.name}
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
      </div>
    </Panel>
  );
}

export function MediaSourceSettingsPanel() {
  const sources = useMediaSourceSettings();

  if (sources.isPending) {
    return (
      <Panel className="p-3">
        <ListSkeleton rows={3} />
      </Panel>
    );
  }
  if (sources.isError || !sources.data?.length) {
    return (
      <Panel className="p-3">
        <EmptyState emoji="🔎" title="搜索数据源读不出来" hint="刷新一下，还不行就看看 API 服务" />
      </Panel>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {sources.data.map((config) => (
        <SourceCard key={config.provider} config={config} />
      ))}
    </div>
  );
}
