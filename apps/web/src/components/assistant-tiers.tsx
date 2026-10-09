import { useState, type ReactNode } from 'react';
import {
  AGENT_PROVIDER_PRESETS,
  type AgentProviderKind,
  type AgentRuntimeKind,
  type AgentSettings,
  type UpdateAgentSettingsBody,
} from '@family/contracts';
import { Button, Input, Segmented, selectClass } from './ui';
import { Switch } from './ui/switch';

/** 设置改动：只传要改的字段，版本号由调用方补上。 */
export type TierChange = Omit<UpdateAgentSettingsBody, 'expectedVersion'>;

/** 「测一下」的结果（本次打开对话框里点过才有）。 */
export interface ProviderCheckResult {
  ok: boolean;
  message: string | null;
}

const RUNTIME_LABEL: Record<AgentRuntimeKind, string> = { fake: '本地摘要', hermes: 'Hermes', native: '小管家自带' };

function providerLabel(kind: AgentProviderKind | null) {
  if (!kind) return '未选';
  return kind === 'custom' ? '自定义' : AGENT_PROVIDER_PRESETS[kind].label;
}

function checkedTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

/** 「测一下」的状态：本次点过的结果优先，其次是上次记下的。 */
function checkStatus(settings: AgentSettings, result: ProviderCheckResult | null): { text: string; tone: string } {
  if (result) {
    return result.ok
      ? { text: '测通了', tone: 'text-accent' }
      : { text: `没测通：${result.message ?? '请检查地址、模型和 key'}`, tone: 'text-danger' };
  }
  if (settings.providerCheckOk && settings.providerCheckedAt) {
    return { text: `${checkedTime(settings.providerCheckedAt)} 测通过`, tone: 'text-ink-soft' };
  }
  return { text: settings.providerCheckedAt ? '上次没测通' : '还没测过', tone: 'text-ink-soft' };
}

/**
 * 云端模型（J4.3）：服务商、地址、模型、key 和「测一下」。选了预设服务商，服务端按预设填地址和推荐模型（可改）；
 * key 只显示末 4 位，要换点「更换」。改了任何一项都要重新测一下，测通了才能切到「小管家自带」。
 */
function CloudProvider({
  settings,
  pending,
  checking,
  checkResult,
  onChange,
  onCheck,
}: {
  settings: AgentSettings;
  pending: boolean;
  checking: boolean;
  checkResult: ProviderCheckResult | null;
  onChange: (values: TierChange) => void;
  onCheck: () => void;
}) {
  const [draftVersion, setDraftVersion] = useState(settings.version);
  const [baseUrl, setBaseUrl] = useState(settings.providerBaseUrl ?? '');
  const [model, setModel] = useState(settings.providerModel ?? '');
  const [key, setKey] = useState('');
  const [replacingKey, setReplacingKey] = useState(false);
  if (draftVersion !== settings.version) {
    setDraftVersion(settings.version);
    setBaseUrl(settings.providerBaseUrl ?? '');
    setModel(settings.providerModel ?? '');
    setKey('');
    setReplacingKey(false);
  }
  const dirty = baseUrl.trim() !== (settings.providerBaseUrl ?? '') || model.trim() !== (settings.providerModel ?? '');
  const ready = Boolean(settings.providerBaseUrl && settings.providerModel && settings.providerKeyConfigured);
  const status = checkStatus(settings, checkResult);
  const editingKey = !settings.providerKeyConfigured || replacingKey;

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted p-2.5">
      <p className="text-[12px] text-ink-soft">云端模型（「小管家自带」用它回答）</p>
      <select
        aria-label="云端服务商"
        className={selectClass}
        value={settings.providerKind ?? ''}
        disabled={pending}
        onChange={(event) => onChange({ providerKind: (event.target.value || null) as AgentProviderKind | null })}
      >
        <option value="">选一个服务商</option>
        {(Object.keys(AGENT_PROVIDER_PRESETS) as Exclude<AgentProviderKind, 'custom'>[]).map((kind) => (
          <option key={kind} value={kind}>{AGENT_PROVIDER_PRESETS[kind].label}</option>
        ))}
        <option value="custom">自定义（OpenAI 兼容）</option>
      </select>
      {settings.providerKind ? (
        <>
          <Input
            value={baseUrl}
            aria-label="云端模型地址"
            inputMode="url"
            placeholder="地址，比如 https://api.deepseek.com"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <Input
              value={model}
              aria-label="云端模型名"
              placeholder="模型名"
              onChange={(event) => setModel(event.target.value)}
            />
            <Button
              variant="outline"
              className="h-10 shrink-0 whitespace-nowrap px-3 text-[13px]"
              disabled={!dirty || !baseUrl.trim() || !model.trim() || pending}
              onClick={() => onChange({ providerBaseUrl: baseUrl.trim(), providerModel: model.trim() })}
            >
              保存模型
            </Button>
          </div>
          {editingKey ? (
            <div className="flex items-center gap-2">
              <Input
                value={key}
                type="password"
                autoComplete="off"
                aria-label="云端模型 key"
                placeholder="服务商给的 API key"
                onChange={(event) => setKey(event.target.value)}
              />
              <Button
                variant="outline"
                className="h-10 shrink-0 whitespace-nowrap px-3 text-[13px]"
                disabled={key.trim().length < 8 || pending}
                onClick={() => onChange({ providerKey: key.trim() })}
              >
                保存 key
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 text-[13px] tabular-nums">key：••••{settings.providerKeyLast4 ?? '????'}</span>
              <Button variant="outline" className="h-8 shrink-0 px-3 text-[13px]" onClick={() => setReplacingKey(true)}>
                更换
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className={`min-w-0 flex-1 text-[12px] ${status.tone}`} role="status">
              {checking ? '正在测…' : status.text}
            </span>
            <Button
              variant="outline"
              className="h-8 shrink-0 whitespace-nowrap px-3 text-[13px]"
              disabled={!ready || checking || pending || dirty}
              onClick={onCheck}
            >
              测一下
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function TierRow({
  title,
  hint,
  label,
  checked,
  manager,
  pending,
  onToggle,
  children,
}: {
  title: string;
  hint: string;
  label: string;
  checked: boolean;
  manager: boolean;
  pending: boolean;
  onToggle: (next: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="mt-0.5 block text-[12px] text-ink-soft">{hint}</span>
        </span>
        <Switch label={label} checked={checked} pending={pending} disabled={!manager} onChange={onToggle} />
      </div>
      {children ? <div className="mt-2.5 flex flex-col gap-2 border-t border-border pt-2.5">{children}</div> : null}
    </div>
  );
}

/**
 * 助理三档（docs/architecture.md §2）：第 0 档本机规则、第 1 档家里的本地模型、第 2 档云端助理（就是原来的「启用问问小管家」）。
 * 第 2 档的「小管家自带」运行方式与云端模型配置在 J4.3；第 0 / 1 档的引擎在 J3 / J5。管理员可改，成员只读。
 */
export function AssistantTiers({
  settings,
  manager,
  pending,
  checking = false,
  checkResult = null,
  onChange,
  onCheckProvider = () => undefined,
}: {
  settings: AgentSettings;
  manager: boolean;
  pending: boolean;
  checking?: boolean;
  checkResult?: ProviderCheckResult | null;
  onChange: (values: TierChange) => void;
  onCheckProvider?: () => void;
}) {
  // 文本框各自有草稿，保存后跟着服务端版本号重来
  const [draftVersion, setDraftVersion] = useState(settings.version);
  const [baseUrl, setBaseUrl] = useState(settings.tier1BaseUrl ?? '');
  const [model, setModel] = useState(settings.tier1Model ?? '');
  const [limit, setLimit] = useState(String(settings.tier2DailyLimit));
  if (draftVersion !== settings.version) {
    setDraftVersion(settings.version);
    setBaseUrl(settings.tier1BaseUrl ?? '');
    setModel(settings.tier1Model ?? '');
    setLimit(String(settings.tier2DailyLimit));
  }
  const tier1Dirty = baseUrl.trim() !== (settings.tier1BaseUrl ?? '') || model.trim() !== (settings.tier1Model ?? '');
  const limitValue = Number(limit);
  const limitValid = Number.isInteger(limitValue) && limitValue >= 1 && limitValue <= 1000;

  return (
    <div className="flex flex-col gap-2.5">
      <TierRow
        title="第 0 档 · 本机规则"
        hint="不用联网，本机规则：说「记一笔 30 买菜」这类固定说法时直接认出来"
        label="第 0 档本机规则"
        checked={settings.tier0Enabled}
        manager={manager}
        pending={pending}
        onToggle={(tier0Enabled) => onChange({ tier0Enabled })}
      />
      <TierRow
        title="第 1 档 · 本地模型"
        hint="需要家里有一台跑 Ollama 的机器，填地址"
        label="第 1 档本地模型"
        checked={settings.tier1Enabled}
        manager={manager}
        pending={pending}
        onToggle={(tier1Enabled) => onChange({ tier1Enabled })}
      >
        {settings.tier1Enabled ? (
          manager ? (
            <>
              <Input
                value={baseUrl}
                aria-label="本地模型地址"
                inputMode="url"
                placeholder="地址，比如 http://192.168.1.10:11434"
                onChange={(event) => setBaseUrl(event.target.value)}
              />
              <Input
                value={model}
                aria-label="本地模型名"
                placeholder="模型名，比如 qwen2.5:7b"
                onChange={(event) => setModel(event.target.value)}
              />
              <Button
                variant="outline"
                className="h-8 self-end whitespace-nowrap px-3 text-[13px]"
                disabled={!tier1Dirty || pending}
                onClick={() => onChange({ tier1BaseUrl: baseUrl.trim() || null, tier1Model: model.trim() || null })}
              >
                保存地址
              </Button>
            </>
          ) : (
            <p className="text-[12px] text-ink-soft">
              地址：{settings.tier1BaseUrl ?? '未填'} · 模型：{settings.tier1Model ?? '未填'}
            </p>
          )
        ) : null}
      </TierRow>
      <TierRow
        title="云端助理（第 2 档）"
        hint="会把脱敏后的内容发给你配置的模型服务商"
        label="云端助理（第 2 档）"
        checked={settings.enabled}
        manager={manager}
        pending={pending}
        onToggle={(enabled) => onChange({ enabled })}
      >
        {manager ? (
          <>
            <div>
              <p className="mb-1.5 text-[12px] text-ink-soft">谁来回答（Hermes 连不上会自动退回本地摘要；「小管家自带」要先把下面的云端模型测通）</p>
              <Segmented
                value={settings.runtimeKind}
                onChange={(runtimeKind: AgentRuntimeKind) => onChange({ runtimeKind })}
                options={[
                  { value: 'fake' as const, label: RUNTIME_LABEL.fake },
                  { value: 'hermes' as const, label: RUNTIME_LABEL.hermes },
                  { value: 'native' as const, label: RUNTIME_LABEL.native },
                ]}
              />
            </div>
            <CloudProvider
              settings={settings}
              pending={pending}
              checking={checking}
              checkResult={checkResult}
              onChange={onChange}
              onCheck={onCheckProvider}
            />
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px]">只对管理员开放（试用期建议）</span>
                <span className="mt-0.5 block text-[12px] text-ink-soft">开着时家里其他人看不到云端助理</span>
              </span>
              <Switch
                label="只对管理员开放（试用期建议）"
                checked={settings.tier2Scope === 'admins'}
                pending={pending}
                onChange={(adminsOnly) => onChange({ tier2Scope: adminsOnly ? 'admins' : 'all' })}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 text-[13px]">每家每天最多问几次</span>
              <div className="w-20 shrink-0">
                <Input
                  value={limit}
                  aria-label="云端每日上限"
                  inputMode="numeric"
                  className="text-right tabular-nums"
                  onChange={(event) => setLimit(event.target.value.replace(/[^\d]/g, ''))}
                />
              </div>
              <Button
                variant="outline"
                className="h-8 shrink-0 whitespace-nowrap px-3 text-[13px]"
                disabled={!limitValid || limitValue === settings.tier2DailyLimit || pending}
                onClick={() => onChange({ tier2DailyLimit: limitValue })}
              >
                保存
              </Button>
            </div>
            {!limitValid ? <p className="text-[12px] text-danger">填 1～1000 之间的整数</p> : null}
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px]">发出前脱敏</span>
                <span className="mt-0.5 block text-[12px] text-ink-soft">家里人的名字换成代号，手机号、车牌、证件号、卡号打码；金额、日期、地址不动</span>
              </span>
              <Switch
                label="发出前脱敏"
                checked={settings.tier2Redact}
                pending={pending}
                onChange={(tier2Redact) => onChange({ tier2Redact })}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1 text-[12px] text-ink-soft">
            <p>
              运行方式：{RUNTIME_LABEL[settings.runtimeKind]} · 服务商：{providerLabel(settings.providerKind)}
              {settings.providerModel ? ` · 模型：${settings.providerModel}` : ''}
              {settings.providerKeyConfigured ? ` · key：••••${settings.providerKeyLast4 ?? '????'}` : ''}
            </p>
            <p>
              {checkStatus(settings, null).text} · {settings.tier2Scope === 'admins' ? '只对管理员开放' : '全家可用'}
            </p>
            <p>
              每天最多 {settings.tier2DailyLimit} 次 · 发出前脱敏{settings.tier2Redact ? '开着' : '关着'}
            </p>
          </div>
        )}
      </TierRow>
      <TierRow
        title="记录原话"
        hint="⌘K 里输的话记在家里这台服务器上，用来让小管家学会家里人怎么说；不会发出去"
        label="记录原话"
        checked={settings.captureUtterances}
        manager={manager}
        pending={pending}
        onToggle={(captureUtterances) => onChange({ captureUtterances })}
      />
    </div>
  );
}
