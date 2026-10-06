import { useState, type ReactNode } from 'react';
import type { AgentRuntimeKind, AgentSettings, AssistantUtterance } from '@family/contracts';
import { useAuth } from '../lib/auth';
import { downloadUtterancesCsv, useAssistantUtterances, useClearMyUtterances } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Input, Segmented } from './ui';
import { Switch } from './ui/switch';

/** 设置改动：只传要改的字段，版本号由调用方补上。 */
export type TierChange = Partial<Pick<
  AgentSettings,
  'enabled' | 'runtimeKind' | 'tier0Enabled' | 'tier1Enabled' | 'tier1BaseUrl' | 'tier1Model' | 'tier2DailyLimit' | 'tier2Redact' | 'captureUtterances'
>>;

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
 * 这一笔只存设置，引擎在 J3 / J4 / J5；所以没有「测一下」。管理员可改，成员只读。
 */
export function AssistantTiers({
  settings,
  manager,
  pending,
  onChange,
}: {
  settings: AgentSettings;
  manager: boolean;
  pending: boolean;
  onChange: (values: TierChange) => void;
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
              <p className="mb-1.5 text-[12px] text-ink-soft">谁来回答（Hermes 连不上会自动退回本地摘要）</p>
              <Segmented
                value={settings.runtimeKind}
                onChange={(runtimeKind: AgentRuntimeKind) => onChange({ runtimeKind })}
                options={[
                  { value: 'fake' as const, label: '本地摘要' },
                  { value: 'hermes' as const, label: 'Hermes' },
                ]}
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
                <span className="mt-0.5 block text-[12px] text-ink-soft">姓名、手机号、地址这类换成代号再发出去</span>
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
          <p className="text-[12px] text-ink-soft">
            每天最多 {settings.tier2DailyLimit} 次 · 发出前脱敏{settings.tier2Redact ? '开着' : '关着'}
          </p>
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

const OUTCOME_LABEL: Record<AssistantUtterance['outcome'], string> = {
  navigated: '点了',
  proposed: '出了提案',
  candidates: '有候选没点',
  no_match: '没找到',
  dismissed: '删掉了',
};

const CHOSEN_LABEL: Record<NonNullable<AssistantUtterance['chosenKind']>, string> = {
  action: '动作',
  page: '页面',
  dish: '菜品',
  item: '东西',
  agent: '小管家',
};

function shortTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

/**
 * 原话记录：试用期看「家里人到底怎么说」的窗口。最近 20 条；成员看自己的，管理员能看全部、导出 CSV。
 */
export function UtteranceLog({ manager, capturing }: { manager: boolean; capturing: boolean }) {
  const { session } = useAuth();
  const [scope, setScope] = useState<'all' | 'mine'>(manager ? 'all' : 'mine');
  const [confirming, setConfirming] = useState(false);
  const [exporting, setExporting] = useState(false);
  const memberId = scope === 'mine' ? session?.member.id : undefined;
  const list = useAssistantUtterances({ limit: 20, ...(memberId ? { memberId } : {}) });
  const clear = useClearMyUtterances();
  const items = list.data?.items ?? [];

  async function exportCsv() {
    setExporting(true);
    try {
      await downloadUtterancesCsv();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '导出失败');
    } finally {
      setExporting(false);
    }
  }

  function clearMine() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    clear.mutate(undefined, {
      onSuccess: (result) => pushToast(result.deleted ? `清掉了 ${result.deleted} 条` : '没有要清的'),
      onError: (error) => pushToast(error instanceof Error ? error.message : '没清掉，再试一次'),
      onSettled: () => setConfirming(false),
    });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {manager ? (
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all' as const, label: '全部' },
              { value: 'mine' as const, label: '我的' },
            ]}
          />
        ) : null}
        <span className="flex-1" />
        {manager ? (
          <Button variant="outline" className="h-8 px-3 text-[13px]" disabled={exporting} onClick={() => void exportCsv()}>
            导出 CSV
          </Button>
        ) : null}
        <Button
          variant="outline"
          className={'h-8 px-3 text-[13px]' + (confirming ? ' border-danger text-danger' : '')}
          disabled={clear.isPending}
          onClick={clearMine}
          onBlur={() => setConfirming(false)}
        >
          {confirming ? '确定清空我的？' : '清空我的'}
        </Button>
      </div>
      {list.isPending ? (
        <p className="text-[13px] text-ink-soft">读取中…</p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[13px] text-ink-soft">
          {capturing ? '还没有记下原话。在 ⌘K 里搜点什么试试。' : '「记录原话」关着，⌘K 里输的话不会记下来。'}
        </p>
      ) : (
        <ul aria-label="原话记录" className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {items.map((one) => (
            <li key={one.id} className="px-3 py-2">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 break-words text-sm font-medium">{one.text}</span>
                <span className="shrink-0 text-[12px] text-ink-soft">{OUTCOME_LABEL[one.outcome]}</span>
              </div>
              <p className="mt-0.5 text-[12px] text-ink-soft">
                {shortTime(one.createdAt)} · {one.memberName ?? '已删成员'}
                {one.chosenKind ? ` · ${CHOSEN_LABEL[one.chosenKind]}${one.chosenId ? `：${one.chosenId}` : ''}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
