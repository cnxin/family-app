import { useState } from 'react';
import { useCreateIntent } from '../lib/create-intent';
import type { Guest, GuestWifiProfile, Visit } from '@family/contracts';
import {
  useAnonymizeGuest,
  useGuestWifiProfiles,
  useGuests,
  useReviewGuestMealRequest,
  useRevokeGuestInvitation,
  useUpsertGuest,
  useUpsertGuestWifiProfile,
  useUpsertVisit,
  useVisits,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { GuestForm, VisitForm, WifiForm } from '../components/guest-forms';
import { InvitationForm } from '../components/guest-invitation-form';
import { VisitCard } from '../components/visit-card';
import { ListSkeleton } from '../components/skeleton';
import { Button, Dialog, EmptyState, Page, Panel, Segmented } from '../components/ui';

type View = 'visits' | 'guests' | 'wifi';

export function GuestsPage() {
  const guests = useGuests();
  const visits = useVisits();
  const wifi = useGuestWifiProfiles();
  const upsertGuest = useUpsertGuest();
  const upsertWifi = useUpsertGuestWifiProfile();
  const upsertVisit = useUpsertVisit();
  const anonymize = useAnonymizeGuest();
  const revokeInvitation = useRevokeGuestInvitation();
  const review = useReviewGuestMealRequest();

  const [view, setView] = useState<View>('visits');
  const [guestForm, setGuestForm] = useState<Guest | 'new' | null>(null);
  const [visitForm, setVisitForm] = useState<Visit | 'new' | null>(null);
  const [wifiForm, setWifiForm] = useState<GuestWifiProfile | 'new' | null>(null);
  const [inviteFor, setInviteFor] = useState<Visit | null>(null);
  const [anonymizing, setAnonymizing] = useState<Guest | null>(null);
  useCreateIntent(() => setVisitForm('new'));

  const guestRows = guests.data ?? [];
  const visitRows = visits.data ?? [];
  const wifiRows = wifi.data ?? [];
  const upcoming = visitRows.filter((one) => one.status === 'scheduled');
  const pendingMeals = visitRows.flatMap((visit) =>
    visit.mealRequests.filter((one) => one.status === 'pending').map((one) => ({ visit, request: one })),
  );

  return (
    <Page
      title="访客"
      subtitle={upcoming.length ? `${upcoming.length} 次来访安排着` : '访客名册、来访安排和访客 Wi-Fi'}
      actions={
        <Button
          className="h-9 px-3 text-[13px]"
          onClick={() =>
            view === 'guests'
              ? setGuestForm('new')
              : view === 'wifi'
                ? setWifiForm('new')
                : setVisitForm('new')
          }
        >
          {view === 'guests' ? '+ 新增访客' : view === 'wifi' ? '+ 新增 Wi-Fi' : '+ 安排来访'}
        </Button>
      }
      toolbar={
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'visits' as const, label: upcoming.length ? `来访 ${upcoming.length}` : '来访' },
            { value: 'guests' as const, label: '访客名册' },
            { value: 'wifi' as const, label: '访客 Wi-Fi' },
          ]}
        />
      }
    >
      <Panel className="p-3">
        {(view === 'visits' && visits.isPending) ||
        (view === 'guests' && guests.isPending) ||
        (view === 'wifi' && wifi.isPending) ? (
          <ListSkeleton rows={3} />
        ) : view === 'visits' ? (
          visitRows.length === 0 ? (
            <EmptyState emoji="🏡" title="还没有来访安排" hint="先在「访客名册」里记下人，再回来安排时间" />
          ) : (
            <div className="flex flex-col gap-3">
              {visitRows.map((visit) => (
                <VisitCard
                  key={visit.id}
                  visit={visit}
                  onEdit={() => setVisitForm(visit)}
                  onInvite={() => setInviteFor(visit)}
                  onCancel={() =>
                    upsertVisit.mutate(
                      { id: visit.id, body: { status: 'cancelled' } },
                      { onSuccess: () => pushToast('来访已取消，相关邀请一并作废') },
                    )
                  }
                  onRevokeInvitation={(invitationId, guestName) =>
                    revokeInvitation.mutate(invitationId, {
                      onSuccess: () => pushToast(`给「${guestName}」的邀请已撤销`),
                    })
                  }
                />
              ))}
            </div>
          )
        ) : view === 'guests' ? (
          guestRows.length === 0 ? (
            <EmptyState emoji="👋" title="还没有访客" hint="把常来的人记在这儿，安排来访时直接选" />
          ) : (
            <div className="overflow-hidden rounded-card border border-border">
              {guestRows.map((one, index) => (
                <div
                  key={one.id}
                  aria-label={one.name}
                  className={'flex flex-wrap items-center gap-3 px-3.5 py-3 ' + (index ? 'border-t border-border' : '')}
                >
                  <span className="text-xl">{one.avatarEmoji}</span>
                  <div className="min-w-[140px] flex-1">
                    <p className="text-[14px] font-medium">
                      {one.name}
                      {one.isActive ? '' : ' · 已停用'}
                      {one.anonymizedAt ? ' · 已匿名化' : ''}
                    </p>
                    {one.note ? <p className="mt-0.5 text-[12px] text-ink-soft">{one.note}</p> : null}
                  </div>
                  {one.anonymizedAt ? null : (
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="ghost"
                        className="h-8 px-2 text-[13px]"
                        aria-label={`编辑${one.name}`}
                        onClick={() => setGuestForm(one)}
                      >
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-8 px-2 text-[13px] text-ink-soft"
                        aria-label={`${one.isActive ? '停用' : '恢复'}${one.name}`}
                        onClick={() =>
                          upsertGuest.mutate({ id: one.id, body: { isActive: !one.isActive } })
                        }
                      >
                        {one.isActive ? '停用' : '恢复'}
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-8 px-2 text-[13px] text-danger"
                        aria-label={`匿名化${one.name}`}
                        onClick={() => setAnonymizing(one)}
                      >
                        匿名化
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        ) : wifiRows.length === 0 ? (
          <EmptyState emoji="📶" title="还没有访客 Wi-Fi" hint="配好之后，访客在邀请页扫码就能连" />
        ) : (
          <div className="overflow-hidden rounded-card border border-border">
            {wifiRows.map((one, index) => (
              <div
                key={one.id}
                aria-label={one.name}
                className={'flex flex-wrap items-center gap-3 px-3.5 py-3 ' + (index ? 'border-t border-border' : '')}
              >
                <span className="text-xl">📶</span>
                <div className="min-w-[140px] flex-1">
                  <p className="text-[14px] font-medium">
                    {one.name}
                    {one.isActive ? '' : ' · 已停用'}
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-soft">
                    {one.ssid} · {one.security === 'WPA' ? 'WPA/WPA2' : '开放网络'}
                    {one.security === 'WPA' ? (one.passwordConfigured ? ' · 密码已配置' : ' · 还没设密码') : ''}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  className="h-8 px-2 text-[13px]"
                  aria-label={`编辑${one.name}`}
                  onClick={() => setWifiForm(one)}
                >
                  编辑
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 px-2 text-[13px] text-ink-soft"
                  aria-label={`${one.isActive ? '停用' : '恢复'}${one.name}`}
                  onClick={() => upsertWifi.mutate({ id: one.id, body: { isActive: !one.isActive } })}
                >
                  {one.isActive ? '停用' : '恢复'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <aside className="flex shrink-0 flex-col lg:w-[320px]">
        <Panel title={pendingMeals.length ? `待处理的点菜 ${pendingMeals.length}` : '访客点的菜'}>
          {pendingMeals.length === 0 ? (
            <p className="px-3.5 py-6 text-center text-[13px] text-ink-soft">
              访客从邀请页点的菜会出现在这儿，等你接受或婉拒。
            </p>
          ) : (
            pendingMeals.map(({ visit, request }, index) => (
              <div
                key={request.id}
                className={'px-3.5 py-3 ' + (index ? 'border-t border-border' : '')}
              >
                <p className="text-[14px] font-medium">{request.dishName}</p>
                <p className="mt-0.5 text-[12px] text-ink-soft">
                  {request.guest?.name ?? '访客'} · {visit.title} · {request.mealDate}
                </p>
                {request.note ? (
                  <p className="mt-0.5 text-[12px] text-ink-soft">{request.note}</p>
                ) : null}
                <div className="mt-2 flex gap-1.5">
                  <Button
                    className="h-8 px-2.5 text-[13px]"
                    aria-label={`接受${request.dishName}`}
                    disabled={review.isPending}
                    onClick={() =>
                      review.mutate(
                        { id: request.id, status: 'accepted' },
                        { onSuccess: () => pushToast(`已接受「${request.dishName}」`) },
                      )
                    }
                  >
                    接受
                  </Button>
                  <Button
                    variant="outline"
                    className="h-8 px-2.5 text-[13px]"
                    aria-label={`婉拒${request.dishName}`}
                    disabled={review.isPending}
                    onClick={() =>
                      review.mutate(
                        { id: request.id, status: 'rejected' },
                        { onSuccess: () => pushToast('已婉拒，访客能看到') },
                      )
                    }
                  >
                    婉拒
                  </Button>
                </div>
              </div>
            ))
          )}
        </Panel>
      </aside>

      {guestForm ? (
        <GuestForm
          key={guestForm === 'new' ? 'new' : guestForm.id}
          editing={guestForm === 'new' ? null : guestForm}
          onClose={() => setGuestForm(null)}
        />
      ) : null}

      {visitForm ? (
        <VisitForm
          key={visitForm === 'new' ? 'new' : visitForm.id}
          editing={visitForm === 'new' ? null : visitForm}
          guests={guestRows}
          wifiProfiles={wifiRows}
          onClose={() => setVisitForm(null)}
        />
      ) : null}

      {wifiForm ? (
        <WifiForm
          key={wifiForm === 'new' ? 'new' : wifiForm.id}
          editing={wifiForm === 'new' ? null : wifiForm}
          onClose={() => setWifiForm(null)}
        />
      ) : null}

      {inviteFor ? <InvitationForm visit={inviteFor} onClose={() => setInviteFor(null)} /> : null}

      {anonymizing ? (
        <Dialog
          title={`匿名化「${anonymizing.name}」？`}
          onClose={() => setAnonymizing(null)}
          maxWidth={400}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setAnonymizing(null)}>
                再想想
              </Button>
              <Button
                className="flex-1 bg-danger hover:brightness-110"
                disabled={anonymize.isPending}
                onClick={() =>
                  anonymize.mutate(anonymizing.id, {
                    onSuccess: () => {
                      pushToast('访客资料已匿名化');
                      setAnonymizing(null);
                    },
                  })
                }
              >
                匿名化
              </Button>
            </div>
          }
        >
          <p className="text-sm leading-relaxed text-ink-soft">
            名字和备注会被抹掉，手上的邀请链接立刻失效，之后不能再改。来访记录本身保留，
            用来对账历史，但看不出是谁了。
          </p>
        </Dialog>
      ) : null}
    </Page>
  );
}
