import type { Visit } from '@family/contracts';
import { Button } from './ui';

function visitTime(visit: Visit) {
  const start = new Date(visit.startsAt);
  const text = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(start);
  if (!visit.endsAt) return text;
  const end = new Date(visit.endsAt);
  return `${text} — ${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
}

/** 一次来访：时间、谁来、回复了没、这次用哪个 Wi-Fi，底下是邀请链接和取消。 */
export function VisitCard({
  visit,
  onEdit,
  onInvite,
  onCancel,
  onRevokeInvitation,
}: {
  visit: Visit;
  onEdit: () => void;
  onInvite: () => void;
  onCancel: () => void;
  onRevokeInvitation: (invitationId: string, guestName: string) => void;
}) {
  return (
    <article aria-label={visit.title} className="rounded-card border border-border bg-surface p-3.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-[15px] font-semibold">{visit.title}</h3>
        <span
          className={
            'rounded-full px-2 py-0.5 text-[11px] font-medium ' +
            (visit.status === 'scheduled' ? 'bg-accent-soft text-accent' : 'bg-muted text-ink-soft')
          }
        >
          {visit.status === 'scheduled' ? '已安排' : visit.status === 'completed' ? '已结束' : '已取消'}
        </span>
      </div>
      <p className="mt-0.5 text-[12px] text-ink-soft">
        {visitTime(visit)}
        {visit.guestWifiProfile ? ` · Wi-Fi ${visit.guestWifiProfile.name}` : ''}
      </p>
      {visit.note ? <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{visit.note}</p> : null}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {visit.guests.map((one) => (
          <span key={one.id} className="rounded-full border border-border px-2.5 py-1 text-[12px] text-ink-soft">
            {one.guest.avatarEmoji} {one.guest.name}
            {one.isAttending === true
              ? ' · 会来'
              : one.isAttending === false
                ? ' · 来不了'
                : one.invitation && !one.invitation.revokedAt
                  ? ' · 等回复'
                  : ''}
          </span>
        ))}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
        <Button variant="ghost" className="h-8 px-2 text-[13px]" aria-label={`编辑${visit.title}`} onClick={onEdit}>
          编辑
        </Button>
        {visit.status === 'scheduled' ? (
          <>
            <Button
              variant="ghost"
              className="h-8 px-2 text-[13px]"
              aria-label={`给${visit.title}生成邀请链接`}
              onClick={onInvite}
            >
              生成邀请链接
            </Button>
            <Button
              variant="ghost"
              className="h-8 px-2 text-[13px] text-ink-soft"
              aria-label={`取消${visit.title}`}
              onClick={onCancel}
            >
              取消来访
            </Button>
          </>
        ) : null}
        {visit.guests
          .filter((one) => one.invitation && !one.invitation.revokedAt && !one.invitation.acceptedAt)
          .map((one) => (
            <Button
              key={one.invitation!.id}
              variant="ghost"
              className="h-8 px-2 text-[13px] text-ink-soft"
              aria-label={`撤销给${one.guest.name}的邀请`}
              onClick={() => onRevokeInvitation(one.invitation!.id, one.guest.name)}
            >
              撤销{one.guest.name}的邀请
            </Button>
          ))}
      </div>
    </article>
  );
}
