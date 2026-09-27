import { useState } from 'react';
import type { Visit } from '@family/contracts';
import { useCreateGuestInvitation } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Checkbox, Dialog, Input } from './ui';

const label = 'mb-1 block text-[12px] text-ink-soft';
const chip = (active: boolean) =>
  'rounded-full border px-2.5 py-1 text-[13px] transition-colors duration-150 ' +
  (active ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-soft hover:bg-muted');

/** 给某次来访里的某位访客签发邀请链接；明文链接只显示这一次。 */
export function InvitationForm({
  visit,
  onClose,
}: {
  visit: Visit;
  onClose: () => void;
}) {
  const create = useCreateGuestInvitation();
  const [guestId, setGuestId] = useState(visit.guests[0]?.guest.id ?? '');
  const [hours, setHours] = useState('48');
  const [movieVoting, setMovieVoting] = useState(false);
  const [mealRequests, setMealRequests] = useState(true);
  const [link, setLink] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Dialog
      title={link ? '邀请链接生成好了' : '生成访客邀请链接'}
      onClose={onClose}
      maxWidth={480}
      footer={
        link ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  pushToast('链接已复制');
                } catch {
                  setMessage('复制不了，手动选中下面那串复制吧');
                }
              }}
            >
              复制链接
            </Button>
            <Button className="flex-1" onClick={onClose}>
              知道了
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {message ? <p className="text-[13px] text-danger">{message}</p> : null}
            <Button
              className="w-full"
              disabled={!guestId || create.isPending}
              onClick={() => {
                const expiresInHours = Number(hours);
                if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 720) {
                  return setMessage('有效期要是 1 到 720 小时之间的整数');
                }
                setMessage(null);
                create.mutate(
                  {
                    visitId: visit.id,
                    guestId,
                    expiresInHours,
                    allowsMovieVoting: movieVoting,
                    allowsMealRequests: mealRequests,
                  },
                  {
                    onSuccess: (invitation) =>
                      setLink(`${window.location.origin}/guest/${invitation.invitationToken}`),
                    onError: (error) =>
                      setMessage(error instanceof Error ? error.message : '没生成成功'),
                  },
                );
              }}
            >
              {create.isPending ? '生成中…' : '生成链接'}
            </Button>
          </div>
        )
      }
    >
      {link ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] leading-relaxed text-ink-soft">
            把这个链接发给访客。<b>只显示这一次</b>——服务端只存哈希，关掉就看不到了。
            访客打开能看到来访信息、回复参不参加，以及你勾选的那些。
          </p>
          <code className="select-all break-all rounded-lg bg-muted px-3 py-2.5 text-[13px] leading-relaxed">
            {link}
          </code>
          {message ? <p className="text-[12px] text-danger">{message}</p> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <span className={label}>给哪位访客</span>
            <div className="flex flex-wrap gap-1.5">
              {visit.guests.map((one) => (
                <button
                  key={one.guest.id}
                  type="button"
                  aria-pressed={guestId === one.guest.id}
                  className={chip(guestId === one.guest.id)}
                  onClick={() => setGuestId(one.guest.id)}
                >
                  {one.guest.avatarEmoji} {one.guest.name}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className={label}>链接有效期（小时）</span>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={720}
              value={hours}
              aria-label="链接有效期"
              onChange={(event) => setHours(event.target.value)}
            />
          </label>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
              <Checkbox label="允许点菜" checked={mealRequests} onChange={() => setMealRequests((v) => !v)} />
              <span className="text-[13px]">允许从菜单里选菜、或者提点菜请求</span>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
              <Checkbox label="允许参与观影投票" checked={movieVoting} onChange={() => setMovieVoting((v) => !v)} />
              <span className="text-[13px]">允许参与这次的观影投票</span>
            </div>
          </div>
          <p className="text-[12px] text-ink-soft">给同一位访客再生成一次，之前那条链接会立刻失效。</p>
        </div>
      )}
    </Dialog>
  );
}
