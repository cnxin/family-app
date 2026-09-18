import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { GuestInvitationPreview } from '@family/contracts';
import { useGuestMoviePolls, useVoteGuestMoviePoll } from '../lib/queries';
import { Button, Card, Checkbox } from './ui';

function dateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

/**
 * 二维码必须永远是白底深色码——深色模式下跟着主题反色的话，多数手机相机就扫不出来了，
 * 所以这一块的底色是写死的 #fff，不用主题变量。
 */
export function GuestWifiCard({ wifi }: { wifi: NonNullable<GuestInvitationPreview['wifi']> }) {
  return (
    <Card className="mt-4 p-4">
      <h2 className="text-[15px] font-semibold">访客 Wi-Fi</h2>
      <p className="mt-1 text-[13px] text-ink-soft">{wifi.ssid}</p>
      <div
        role="img"
        aria-label={`访客 Wi-Fi ${wifi.ssid} 的二维码`}
        className="mx-auto mt-4 w-fit rounded-lg bg-white p-3"
      >
        <QRCodeSVG value={wifi.qrPayload} size={188} bgColor="#ffffff" fgColor="#111827" />
      </div>
      <p className="mt-3 text-center text-[12px] text-ink-soft">
        用手机相机或者系统的 Wi-Fi 扫一下就能连上
      </p>
    </Card>
  );
}

/** 观影投票：覆盖式提交（提交的是当前整份选择，不是增量），所以空选择就是清空我的票。 */
export function GuestMoviePolls({ token }: { token: string }) {
  const polls = useGuestMoviePolls(token);
  const vote = useVoteGuestMoviePoll(token);
  const [choices, setChoices] = useState<Record<string, string[]>>({});

  if (!polls.data?.length) return null;

  function toggle(pollId: string, optionId: string, maxChoices: number, single: boolean) {
    setChoices((current) => {
      const selected =
        current[pollId] ?? polls.data?.find((poll) => poll.id === pollId)?.selectedOptionIds ?? [];
      if (single) return { ...current, [pollId]: selected.includes(optionId) ? [] : [optionId] };
      if (selected.includes(optionId)) {
        return { ...current, [pollId]: selected.filter((id) => id !== optionId) };
      }
      if (selected.length >= maxChoices) return current;
      return { ...current, [pollId]: [...selected, optionId] };
    });
  }

  return (
    <>
      {polls.data.map((poll) => {
        const selected = choices[poll.id] ?? poll.selectedOptionIds;
        return (
          <Card key={poll.id} className="mt-4 p-4">
            <article aria-label={poll.title}>
              <h2 className="text-[15px] font-semibold">{poll.title}</h2>
              <p className="mt-1 text-[13px] text-ink-soft">
                {poll.totalVoters} 人已经参与
                {poll.closesAt ? ` · 截止 ${dateTime(poll.closesAt)}` : ''}
              </p>
              {poll.description ? (
                <p className="mt-2 text-[13px] text-ink-soft">{poll.description}</p>
              ) : null}

              <div className="mt-3 flex flex-col gap-2">
                {poll.options.map((option) => {
                  const label = `${option.media?.title ?? option.label}${option.media?.year ? ` (${option.media.year})` : ''}`;
                  return (
                    <div
                      key={option.id}
                      className={
                        'flex items-center gap-3 rounded-lg border px-3 py-2.5 ' +
                        (selected.includes(option.id)
                          ? 'border-accent bg-accent-soft'
                          : 'border-border')
                      }
                    >
                      <Checkbox
                        label={label}
                        checked={selected.includes(option.id)}
                        onChange={() =>
                          toggle(poll.id, option.id, poll.maxChoices, poll.voteMode === 'single')
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{label}</p>
                        {option.description ? (
                          <p className="truncate text-[12px] text-ink-soft">{option.description}</p>
                        ) : null}
                      </div>
                      <span className="text-[12px] text-ink-soft">{option.voteCount} 票</span>
                    </div>
                  );
                })}
              </div>

              <Button
                className="mt-3 w-full"
                disabled={vote.isPending}
                onClick={() => vote.mutate({ pollId: poll.id, optionIds: selected })}
              >
                {selected.length ? '提交我的观影选择' : '清空我的选择'}
              </Button>
            </article>
          </Card>
        );
      })}
    </>
  );
}
