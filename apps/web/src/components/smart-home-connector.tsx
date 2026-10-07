import { useState } from 'react';
import type { SmartHomeConnectorSettings } from '@family/contracts';
import { useResetSmartHomeConnector, useSaveSmartHomeConnector, useTestSmartHomeConnector } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { CredentialField, Field, ResultLine, SettingsBadge, ToggleRow, modeLabel } from './media-settings-parts';
import { Button, Input, Panel } from './ui';

/** HA 连接：地址 + 长期访问令牌（只写不读）+ 启用。和媒体服务那张卡同一套零件。 */
export function SmartHomeConnectorCard({ settings }: { settings: SmartHomeConnectorSettings }) {
  const save = useSaveSmartHomeConnector();
  const reset = useResetSmartHomeConnector();
  const test = useTestSmartHomeConnector();
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl ?? '');
  const [isEnabled, setIsEnabled] = useState(settings.isEnabled);
  const [credential, setCredential] = useState('');
  const [clearing, setClearing] = useState(false);
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null);
  const busy = save.isPending || reset.isPending || test.isPending;

  function fail(error: unknown, fallback: string) {
    setResult({ message: error instanceof Error ? error.message : fallback, ok: false });
  }

  async function submit(alsoTest: boolean) {
    setResult(null);
    try {
      await save.mutateAsync({
        isEnabled,
        baseUrl: baseUrl.trim() || null,
        ...(credential.trim() ? { credential: credential.trim() } : {}),
        ...(clearing ? { clearCredential: true } : {}),
      });
      setCredential('');
      setClearing(false);
      if (!alsoTest) {
        setResult({ message: '已保存', ok: true });
        pushToast('Home Assistant 连接已保存', undefined, 'success');
        return;
      }
      const status = await test.mutateAsync();
      setResult({ message: `${status.available ? '连接成功' : '连接失败'} · ${status.message}`, ok: status.available });
    } catch (error) {
      fail(error, '保存失败');
    }
  }

  async function restore() {
    setResult(null);
    try {
      const restored = await reset.mutateAsync();
      setBaseUrl(restored.baseUrl ?? '');
      setIsEnabled(restored.isEnabled);
      setCredential('');
      setClearing(false);
      setResult({ message: '已恢复服务器默认设置', ok: true });
    } catch (error) {
      fail(error, '恢复失败');
    }
  }

  return (
    <Panel grow={false}>
      <div className="flex items-start gap-3 border-b border-border px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">Home Assistant</p>
          <p className="text-[12px] text-ink-soft">{modeLabel(settings.mode)}</p>
        </div>
        <SettingsBadge enabled={settings.isEnabled} configured={settings.configured} />
      </div>
      <div className="flex flex-col gap-3 px-3.5 py-3">
        <ToggleRow
          label="启用 Home Assistant"
          checked={isEnabled}
          disabled={busy}
          onChange={() => setIsEnabled((value) => !value)}
        />
        <Field label="地址">
          <Input
            aria-label="Home Assistant 地址"
            autoComplete="off"
            placeholder="http://192.168.1.10:8123"
            disabled={busy}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </Field>
        <CredentialField
          name="Home Assistant"
          label="长期访问令牌"
          configured={settings.credentialConfigured}
          hint={settings.credentialHint}
          value={credential}
          onChange={setCredential}
          clearing={clearing}
          onToggleClear={() => {
            setClearing((value) => !value);
            setCredential('');
          }}
          disabled={busy}
        />
        <p className="text-[12px] leading-relaxed text-ink-soft">
          令牌在 Home Assistant 左下角点自己的名字 → 安全 → 长期访问令牌里创建，只显示一次。
        </p>
        {result ? <ResultLine message={result.message} ok={result.ok} /> : null}
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" disabled={busy} onClick={() => void submit(false)}>
            保存
          </Button>
          <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void submit(true)}>
            保存并测试
          </Button>
          {settings.mode === 'household' ? (
            <Button
              variant="ghost"
              className="min-h-11"
              aria-label="恢复 Home Assistant 默认设置"
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
