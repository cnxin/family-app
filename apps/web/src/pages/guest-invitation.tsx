import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { GuestMealMenu, GuestMealRequestForm } from '../components/guest-meals';
import { GuestMoviePolls, GuestWifiCard } from '../components/guest-invitation-parts';
import { Button, Card } from '../components/ui';
import { useGuestInvitation, useRespondGuestInvitation } from '../lib/queries';
import { applyTheme, readTheme } from '../lib/theme';

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

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[560px] px-5 pb-16 pt-10">{children}</div>
  );
}

/**
 * 公开邀请页：在 `<Shell/>` 和登录闸门之外，只靠链接里的令牌取数据（见 App.tsx 的前置分支）。
 * 页面只显示这次来访明确授权过的内容——能不能点菜、能不能投票由 capabilities 决定，
 * 前端不去猜，后端不给的就不画。
 */
export function GuestInvitationPage() {
  const token = useParams<{ token: string }>().token ?? '';
  const invitation = useGuestInvitation(token);
  const respond = useRespondGuestInvitation(token);

  // Shell 不在这条路由上，主题得自己落一次，否则家里人从深色模式点进来会突然变白。
  useEffect(() => applyTheme(readTheme()), []);

  if (invitation.isLoading) {
    return (
      <Frame>
        <p className="mt-24 text-center text-sm text-ink-soft">正在打开邀请…</p>
      </Frame>
    );
  }

  if (invitation.isError || !invitation.data) {
    return (
      <Frame>
        <div className="mt-24 text-center">
          <span className="text-3xl">🔒</span>
          <h1 className="mt-3 text-xl font-semibold">这个邀请链接打不开了</h1>
          <p className="mt-2 text-sm text-ink-soft">
            它可能已经过期、被撤销，或者这次来访取消了。找邀请你的人再要一个链接吧。
          </p>
        </div>
      </Frame>
    );
  }

  const data = invitation.data;
  const responded = data.response.attending !== null;

  return (
    <Frame>
      <header className="text-center">
        <span className="inline-grid size-14 place-items-center rounded-card bg-accent-soft text-2xl">
          🏠
        </span>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">你好，{data.guest.name}</h1>
        <p className="mt-1 text-sm text-ink-soft">{data.householdName} 邀请你来做客</p>
      </header>

      <Card className="mt-6 p-4">
        <h2 className="text-lg font-semibold">{data.visit.title}</h2>
        <p className="mt-2 text-sm text-ink-soft">
          {dateTime(data.visit.startsAt)}
          {data.visit.endsAt ? ` 至 ${dateTime(data.visit.endsAt)}` : ''}
        </p>
        {data.visit.note ? <p className="mt-2 text-sm text-ink-soft">{data.visit.note}</p> : null}
      </Card>

      {/* 旧客户端把「参加/不参加」放在最后一屏；网页上这是主操作，放在来访信息下面，不让人先滚三屏 */}
      {responded ? (
        <div
          className={`mt-4 rounded-card px-4 py-3 ${data.response.attending ? 'bg-accent-soft' : 'bg-warm-soft'}`}
        >
          <p
            className={`text-sm font-medium ${data.response.attending ? 'text-accent' : 'text-warm'}`}
          >
            {data.response.attending ? '已确认参加' : '已经告诉他们这次来不了'}
          </p>
          <p className="mt-0.5 text-[13px] text-ink-soft">要改的话，直接联系接待你的人。</p>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          <Button disabled={respond.isPending} onClick={() => respond.mutate(true)}>
            我会参加
          </Button>
          <Button
            variant="outline"
            disabled={respond.isPending}
            onClick={() => respond.mutate(false)}
          >
            这次来不了
          </Button>
        </div>
      )}

      {data.wifi ? <GuestWifiCard wifi={data.wifi} /> : null}

      {data.capabilities.mealRequests ? (
        <>
          <GuestMealMenu token={token} />
          <GuestMealRequestForm token={token} dates={data.mealRequestDates} />
        </>
      ) : null}

      {data.capabilities.movieVoting ? <GuestMoviePolls token={token} /> : null}

      <p className="mt-8 text-center text-[12px] text-ink-soft">
        这个页面只显示本次来访授权给你的内容。
      </p>
    </Frame>
  );
}
