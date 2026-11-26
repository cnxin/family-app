import { useState } from 'react';
import type {
  ExternalAccessCredentialKind,
  ExternalAccessSettings,
  ExternalAccessTestResult,
  TestExternalAccessSettingsBody,
  UpdateExternalAccessSettingsBody,
} from '@family/contracts';
import {
  useResetExternalAccessSettings,
  useSaveExternalAccessSettings,
  useTestExternalAccessSettings,
} from '../lib/queries';
import { TONE_PILL, permissionSummary } from '../lib/external-access-copy';
import { pushToast } from '../lib/toast';
import {
  CredentialField,
  Field,
  ResultLine,
  SettingsBadge,
  ToggleRow,
  modeLabel,
} from './media-settings-parts';
import { Button, Dialog, Input, Panel, Segmented } from './ui';

const CREDENTIAL_OPTIONS: { value: ExternalAccessCredentialKind; label: string }[] = [
  { value: 'oauth_client', label: 'OAuth 客户端（推荐）' },
  { value: 'api_token', label: 'API 令牌' },
];

/** Tailscale 控制面连接卡片：沿用 media-settings-parts 与 HA 设置的交互骨架。 */
export function ExternalAccessConnectorCard({ settings }: { settings: ExternalAccessSettings }) {
  const save = useSaveExternalAccessSettings();
  const reset = useResetExternalAccessSettings();
  const test = useTestExternalAccessSettings();

  const [isEnabled, setIsEnabled] = useState(
    settings.accessScope === 'restricted' ? true : settings.isEnabled,
  );
  const [credentialKind, setCredentialKind] = useState<ExternalAccessCredentialKind>(
    settings.credentialKind ?? 'oauth_client',
  );
  const [tailnet, setTailnet] = useState(settings.tailnet ?? '-');
  const [nodeHostname, setNodeHostname] = useState(settings.nodeHostname ?? 'xiaoguanjia');
  const [publicUrl, setPublicUrl] = useState(settings.publicUrl ?? '');
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl ?? 'https://api.tailscale.com');
  const [oauthClientId, setOauthClientId] = useState('');
  const [credential, setCredential] = useState('');
  const [clearing, setClearing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [result, setResult] = useState<{ message: string; ok: boolean; test?: ExternalAccessTestResult } | null>(null);

  const busy = save.isPending || reset.isPending || test.isPending;

  function buildTestPayload(): TestExternalAccessSettingsBody {
    const trimmedBase = baseUrl.trim();
    const trimmedTailnet = tailnet.trim();
    const trimmedNode = nodeHostname.trim();
    const trimmedClientId = oauthClientId.trim();
    const trimmedCredential = credential.trim();
    return {
      credentialKind,
      ...(trimmedBase ? { baseUrl: trimmedBase } : {}),
      ...(trimmedTailnet ? { tailnet: trimmedTailnet } : {}),
      ...(trimmedNode ? { nodeHostname: trimmedNode } : {}),
      ...(credentialKind === 'oauth_client' && trimmedClientId ? { oauthClientId: trimmedClientId } : {}),
      ...(trimmedCredential ? { credential: trimmedCredential } : {}),
    };
  }

  function buildSavePayload(): UpdateExternalAccessSettingsBody {
    const trimmedBase = baseUrl.trim();
    const trimmedTailnet = tailnet.trim();
    const trimmedNode = nodeHostname.trim();
    const trimmedPublic = publicUrl.trim();
    const trimmedClientId = oauthClientId.trim();
    const trimmedCredential = credential.trim();
    return {
      isEnabled,
      credentialKind,
      baseUrl: trimmedBase || null,
      tailnet: trimmedTailnet || null,
      nodeHostname: trimmedNode || null,
      publicUrl: trimmedPublic || null,
      ...(credentialKind === 'oauth_client' && trimmedClientId ? { oauthClientId: trimmedClientId } : {}),
      ...(trimmedCredential ? { credential: trimmedCredential } : {}),
      ...(clearing && settings.mode === 'household' ? { clearCredential: true } : {}),
    };
  }

  async function runTest(useDraft: boolean) {
    setResult(null);
    try {
      const tested = await test.mutateAsync(useDraft ? buildTestPayload() : {});
      setResult({ message: tested.message, ok: tested.ok, test: tested });
      if (tested.ok) navigator.vibrate?.(10);
    } catch (error) {
      setResult({ message: error instanceof Error ? error.message : '测试失败', ok: false });
    }
  }

  async function submit(alsoTest: boolean) {
    setResult(null);
    try {
      const saved = await save.mutateAsync(buildSavePayload());
      setOauthClientId('');
      setCredential('');
      setClearing(false);
      setIsEnabled(saved.isEnabled);
      setCredentialKind(saved.credentialKind ?? 'oauth_client');
      setBaseUrl(saved.baseUrl ?? 'https://api.tailscale.com');
      setTailnet(saved.tailnet ?? '-');
      setNodeHostname(saved.nodeHostname ?? 'xiaoguanjia');
      setPublicUrl(saved.publicUrl ?? '');
      navigator.vibrate?.(10);
      if (!alsoTest) {
        setResult({ message: '已保存', ok: true });
        pushToast('外部访问设置已保存', undefined, 'success');
        return;
      }
      const tested = await test.mutateAsync({});
      setResult({ message: tested.message, ok: tested.ok, test: tested });
      if (tested.ok) pushToast('已保存并验证为只读凭据', undefined, 'success');
    } catch (error) {
      setResult({ message: error instanceof Error ? error.message : '保存失败', ok: false });
    }
  }

  async function restoreDefault() {
    setConfirmReset(false);
    setResult(null);
    try {
      const restored = await reset.mutateAsync();
      setIsEnabled(restored.accessScope === 'restricted' ? true : restored.isEnabled);
      setCredentialKind(restored.credentialKind ?? 'oauth_client');
      setTailnet(restored.tailnet ?? '-');
      setNodeHostname(restored.nodeHostname ?? 'xiaoguanjia');
      setPublicUrl(restored.publicUrl ?? '');
      setBaseUrl(restored.baseUrl ?? 'https://api.tailscale.com');
      setOauthClientId('');
      setCredential('');
      setClearing(false);
      navigator.vibrate?.(12);
      setResult({ message: '已清除家庭覆盖，恢复服务器默认设置', ok: true });
      pushToast('已恢复服务器默认设置', undefined, 'success');
    } catch (error) {
      setResult({ message: error instanceof Error ? error.message : '恢复失败', ok: false });
    }
  }

  const testBadge = result?.test ? permissionSummary(result.test) : null;
  const sameKindConfigured =
    settings.credentialConfigured && settings.credentialKind === credentialKind;
  const showOauthClientIdHint =
    settings.credentialKind === 'oauth_client' && Boolean(settings.oauthClientIdHint);

  return (
    <Panel grow={false}>
      <div className="flex items-start gap-3 border-b border-border px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">Tailscale 控制面</p>
          <p className="text-[12px] text-ink-soft">{modeLabel(settings.mode)}</p>
        </div>
        <SettingsBadge enabled={settings.isEnabled} configured={settings.configured} />
      </div>

      <div className="flex flex-col gap-3.5 px-3.5 py-3.5">
        {settings.accessScope === 'restricted' && settings.accessMessage ? (
          <div
            role="status"
            className="rounded-xl border border-border bg-warm-soft/70 px-3 py-2.5 text-[12px] leading-relaxed text-ink"
          >
            <p className="font-medium text-warm">服务器默认配置未对本家庭开放</p>
            <p className="mt-0.5 text-ink-soft">{settings.accessMessage}</p>
          </div>
        ) : null}

        <ToggleRow
          label="启用外部访问面板"
          checked={isEnabled}
          disabled={busy}
          onChange={() => setIsEnabled((value) => !value)}
        />

        <Field label="凭据类型">
          <Segmented<ExternalAccessCredentialKind>
            label="Tailscale 凭据类型"
            value={credentialKind}
            options={CREDENTIAL_OPTIONS}
            onChange={(value) => {
              setCredentialKind(value);
              setOauthClientId('');
              setCredential('');
              setClearing(false);
            }}
          />
        </Field>

        {credentialKind === 'oauth_client' ? (
          <div>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-[12px] text-ink-soft">OAuth Client ID</span>
              {showOauthClientIdHint ? (
                <span className="truncate text-[11px] text-accent">已配置 · {settings.oauthClientIdHint}</span>
              ) : null}
            </div>
            <Input
              aria-label="Tailscale OAuth Client ID"
              autoComplete="off"
              placeholder={showOauthClientIdHint ? '已配置，留空保持不变' : '例如 k123456CNTRL'}
              disabled={busy || clearing}
              value={oauthClientId}
              onChange={(event) => setOauthClientId(event.target.value)}
            />
          </div>
        ) : null}

        <CredentialField
          name="Tailscale"
          label={credentialKind === 'oauth_client' ? 'OAuth Client Secret' : 'API 访问令牌'}
          configured={sameKindConfigured}
          hint={sameKindConfigured ? settings.credentialHint : null}
          value={credential}
          onChange={setCredential}
          clearing={clearing}
          allowClear={settings.mode === 'household'}
          onToggleClear={() => {
            setClearing((value) => !value);
            setCredential('');
            setOauthClientId('');
          }}
          disabled={busy}
        />

        <p className="text-[12px] leading-relaxed text-ink-soft">
          {credentialKind === 'oauth_client'
            ? '推荐在 Tailscale 控制台 → Settings → OAuth clients 创建，仅勾选 devices:core:read 只读权限。阶段 1 会自动拒绝包含写权限的凭据。'
            : 'API 令牌最长 90 天到期，适合临时体验；日常运行建议使用 OAuth 客户端（不会 90 天失效）。'}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tailnet 名称">
            <Input
              aria-label="Tailnet 名称"
              autoComplete="off"
              placeholder="-（默认 tailnet）"
              disabled={busy}
              value={tailnet}
              onChange={(event) => setTailnet(event.target.value)}
            />
          </Field>
          <Field label="小管家节点名">
            <Input
              aria-label="小管家节点名"
              autoComplete="off"
              placeholder="xiaoguanjia"
              disabled={busy}
              value={nodeHostname}
              onChange={(event) => setNodeHostname(event.target.value)}
            />
          </Field>
        </div>

        <Field label="外部访问地址（Public URL）">
          <Input
            aria-label="外部访问地址"
            autoComplete="off"
            placeholder="https://xiaoguanjia.你的tailnet.ts.net"
            disabled={busy}
            value={publicUrl}
            onChange={(event) => setPublicUrl(event.target.value)}
          />
          {settings.publicUrl && settings.corsOriginMatched !== null ? (
            <p
              className={`mt-1.5 text-[12px] ${settings.corsOriginMatched ? 'text-accent' : 'text-warm'}`}
              data-cors-matched={String(settings.corsOriginMatched)}
            >
              {settings.corsOriginMatched
                ? '✓ 已匹配服务端 CORS_ORIGINS 白名单'
                : '⚠ 未在服务端 CORS_ORIGINS 中检测到此来源，请核对 deploy/.env.production'}
            </p>
          ) : null}
        </Field>

        <details className="rounded-lg border border-border px-3 py-2">
          <summary className="cursor-pointer select-none text-[12px] font-medium text-ink-soft">
            高级设置（自建 Headscale / 控制面地址）
          </summary>
          <div className="mt-2.5">
            <Field label="控制面 API 地址">
              <Input
                aria-label="控制面 API 地址"
                autoComplete="off"
                placeholder="https://api.tailscale.com"
                disabled={busy}
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </Field>
          </div>
        </details>

        {result ? (
          <div className="motion-safe:animate-[float-in_180ms_cubic-bezier(0.22,1,0.36,1)] rounded-xl border border-border bg-muted/50 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {testBadge ? (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_PILL[testBadge.tone]}`}>
                  {testBadge.label}
                </span>
              ) : null}
              {result.test?.deviceCount != null ? (
                <span className="text-[11px] tabular-nums text-ink-soft">
                  发现 {result.test.deviceCount} 台设备
                  {result.test.matchedNodeName ? ` · 已匹配节点 ${result.test.matchedNodeName}` : ''}
                </span>
              ) : null}
            </div>
            <div className={testBadge ? 'mt-1.5' : ''}>
              <ResultLine message={result.message} ok={result.ok} />
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button className="min-h-11" disabled={busy} onClick={() => void submit(false)}>
            {save.isPending ? '保存中…' : '保存'}
          </Button>
          <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void runTest(true)}>
            {test.isPending ? '测试中…' : '测试连接'}
          </Button>
          <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void submit(true)}>
            保存并测试
          </Button>
          {settings.mode === 'household' ? (
            <Button
              variant="ghost"
              className="min-h-11"
              aria-label="恢复外部访问默认设置"
              disabled={busy}
              onClick={() => setConfirmReset(true)}
            >
              恢复默认
            </Button>
          ) : null}
        </div>
      </div>

      {confirmReset ? (
        <Dialog
          title="恢复服务器默认设置？"
          onClose={() => setConfirmReset(false)}
          maxWidth={400}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="min-h-11 flex-1" onClick={() => setConfirmReset(false)}>
                取消
              </Button>
              <Button
                className="min-h-11 flex-1 bg-danger text-on-danger hover:bg-danger"
                disabled={reset.isPending}
                onClick={() => void restoreDefault()}
              >
                {reset.isPending ? '恢复中…' : '确认恢复'}
              </Button>
            </div>
          }
        >
          <p className="text-sm leading-relaxed text-ink-soft">
            这会清除本家庭单独保存的 Tailscale 配置与加密凭据，切回服务器默认设置。
          </p>
        </Dialog>
      ) : null}
    </Panel>
  );
}
