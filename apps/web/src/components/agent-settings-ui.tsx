import { useState } from 'react';
import {
  useAgentChannelPairings,
  useAgentChannels,
  useAgentSettings,
  useCreateAgentChannelPairing,
  useMembers,
  useRevokeAgentChannel,
  useRevokeAgentChannelPairing,
  useUpdateAgentSettings,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { AssistantTiers, UtteranceLog, type TierChange } from './assistant-tiers';
import { QueryFrame } from './query-state';
import { ListSkeleton } from './skeleton';
import { Button, Dialog, Input } from './ui';

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
 * 助理设置：三档（本机规则 / 本地模型 / 云端助理，J2）+ 原话记录 + 消息渠道绑定（把 Telegram 这类外部账号配到某个成员）。
 * 成员也看得到三档与自己的原话，但只有管理员能改。外部渠道进来的消息是只读的——要改东西还是回 App 里确认提案。
 */
export function AssistantSettings({ manager, onClose }: { manager: boolean; onClose: () => void }) {
  const settings = useAgentSettings(true);
  const update = useUpdateAgentSettings();
  const channels = useAgentChannels();
  const pairings = useAgentChannelPairings(manager);
  const members = useMembers();
  const createPairing = useCreateAgentChannelPairing();
  const revokeChannel = useRevokeAgentChannel();
  const revokePairing = useRevokeAgentChannelPairing();

  const [platform, setPlatform] = useState('telegram');
  const [memberId, setMemberId] = useState('');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const activeMembers = (members.data ?? []).filter((one) => !one.disabledAt);
  const activeChannels = (channels.data ?? []).filter((one) => !one.revokedAt);
  const pendingPairings = (pairings.data ?? []).filter((one) => one.status === 'pending');
  const onError = (error: unknown) =>
    setMessage(error instanceof Error ? error.message : '没成功，再试一次');

  function change(values: TierChange) {
    if (!settings.data || update.isPending) return;
    setMessage(null);
    update.mutate({ ...values, expectedVersion: settings.data.version }, { onError });
  }

  return (
    <Dialog title="小管家设置" onClose={onClose} maxWidth={520}>
      <div className="flex flex-col gap-4">
        <section>
          <h3 className="text-[13px] font-semibold text-ink-soft">三档</h3>
          <p className="mt-1 text-[12px] text-ink-soft">
            小管家先用本机规则听懂你，听不懂再交给家里的模型或云端。{manager ? '' : '只有家庭管理员能改。'}
          </p>
          <div className="mt-2">
            {settings.data ? (
              <AssistantTiers settings={settings.data} manager={manager} pending={update.isPending} onChange={change} />
            ) : (
              <p className="text-[13px] text-ink-soft">读取设置…</p>
            )}
          </div>
        </section>

        <section>
          <h3 className="text-[13px] font-semibold text-ink-soft">原话记录</h3>
          <p className="mt-1 mb-2 text-[12px] text-ink-soft">
            ⌘K 里每次输入结束记一条：说了什么、最后点了哪个。{manager ? '管理员能看全家的、导出 CSV。' : '这里只有你自己的。'}
          </p>
          <UtteranceLog manager={manager} capturing={settings.data?.captureUtterances ?? true} />
        </section>

        <section>
          <h3 className="text-[13px] font-semibold text-ink-soft">消息渠道</h3>
          <p className="mt-1 text-[12px] text-ink-soft">
            绑定之后可以在 Telegram 这类地方问小管家。外部消息只读——要改东西还是回这儿确认。
          </p>

          {manager ? (
            <div className="mt-2.5 flex flex-col gap-2 rounded-lg border border-border p-3">
              <Input
                value={platform}
                aria-label="渠道标识"
                placeholder="渠道标识，比如 telegram"
                onChange={(event) => setPlatform(event.target.value)}
              />
              <div className="flex flex-wrap gap-1.5">
                {activeMembers.map((one) => (
                  <button
                    key={one.id}
                    type="button"
                    aria-pressed={one.id === memberId}
                    onClick={() => setMemberId(one.id)}
                    className={
                      'rounded-full border px-2.5 py-1 text-[13px] transition-colors duration-150 ' +
                      (one.id === memberId
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-border text-ink-soft hover:bg-muted')
                    }
                  >
                    {one.avatarEmoji} {one.name}
                  </button>
                ))}
              </div>
              <Button
                className="h-9 self-start px-3 text-[13px]"
                disabled={!memberId || !platform.trim() || createPairing.isPending}
                onClick={() => {
                  setMessage(null);
                  setPairingCode(null);
                  createPairing.mutate(
                    { memberId, platform: platform.trim().toLocaleLowerCase('en-US') },
                    {
                      onSuccess: (result) => {
                        setPairingCode(result.pairingCode);
                        if (!result.pairingCode) {
                          setMessage('这个请求之前已经生成过配对码了，用第一次显示的那个。');
                        }
                      },
                      onError,
                    },
                  );
                }}
              >
                {createPairing.isPending ? '生成中…' : '生成一次性配对码'}
              </Button>
              {pairingCode ? (
                <div className="rounded-lg bg-muted px-3 py-2.5">
                  <p className="text-[12px] text-ink-soft">只显示这一次</p>
                  <code className="mt-0.5 block select-all break-all text-[15px] font-semibold text-accent">
                    {pairingCode}
                  </code>
                </div>
              ) : null}
            </div>
          ) : null}

          {message ? (
            <p role="alert" className="mt-2 text-[13px] text-danger">
              {message}
            </p>
          ) : null}

          <QueryFrame query={channels} skeleton={<ListSkeleton rows={2} />}>
          {activeChannels.length ? (
            <div className="mt-2.5 overflow-hidden rounded-lg border border-border">
              {activeChannels.map((one, index) => (
                <div
                  key={one.id}
                  className={'flex items-center gap-2 px-3 py-2.5 ' + (index ? 'border-t border-border' : '')}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">
                      {one.platform} · {one.memberName ?? '家庭成员'}
                    </p>
                    <p className="mt-0.5 truncate text-[12px] text-ink-soft">
                      {one.externalAccountLabel ?? one.externalAccountHint ?? '已绑定'} ·{' '}
                      {one.lastUsedAt ? `最近用于 ${shortTime(one.lastUsedAt)}` : `绑定于 ${shortTime(one.pairedAt)}`}
                    </p>
                  </div>
                  {one.canRevoke ? (
                    <Button
                      variant="ghost"
                      className="h-8 shrink-0 px-2 text-[13px] text-danger"
                      aria-label={`解绑${one.platform}`}
                      disabled={revokeChannel.isPending}
                      onClick={() =>
                        revokeChannel.mutate(
                          { id: one.id, expectedVersion: one.version },
                          { onSuccess: () => pushToast('渠道已解绑'), onError },
                        )
                      }
                    >
                      解绑
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2.5 text-[13px] text-ink-soft">还没有绑定的外部渠道。</p>
          )}
          </QueryFrame>

          {manager && pendingPairings.length ? (
            <div className="mt-2.5">
              <p className="mb-1.5 text-[12px] text-ink-soft">还没被用掉的配对码</p>
              <div className="overflow-hidden rounded-lg border border-border">
                {pendingPairings.map((one, index) => (
                  <div
                    key={one.id}
                    className={'flex items-center gap-2 px-3 py-2 ' + (index ? 'border-t border-border' : '')}
                  >
                    <p className="min-w-0 flex-1 truncate text-[13px]">
                      {one.platform} · {one.memberName ?? '家庭成员'} · {shortTime(one.expiresAt)} 前有效
                    </p>
                    <Button
                      variant="ghost"
                      className="h-8 shrink-0 px-2 text-[13px] text-ink-soft"
                      aria-label={`作废${one.platform}的配对码`}
                      disabled={revokePairing.isPending}
                      onClick={() =>
                        revokePairing.mutate(one.id, {
                          onSuccess: () => pushToast('配对码已作废'),
                          onError,
                        })
                      }
                    >
                      作废
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </Dialog>
  );
}
