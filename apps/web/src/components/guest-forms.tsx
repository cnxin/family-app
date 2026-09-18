import { useState } from 'react';
import type { Guest, GuestWifiProfile, GuestWifiSecurity, Visit } from '@family/contracts';
import {
  useUpsertGuest,
  useUpsertGuestWifiProfile,
  useUpsertVisit,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Checkbox, Dialog, Input } from './ui';

const label = 'mb-1 block text-[12px] text-ink-soft';
const chip = (active: boolean) =>
  'rounded-full border px-2.5 py-1 text-[13px] transition-colors duration-150 ' +
  (active ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-soft hover:bg-muted');

export function GuestForm({ editing, onClose }: { editing: Guest | null; onClose: () => void }) {
  const save = useUpsertGuest();
  const [name, setName] = useState(editing?.name ?? '');
  const [avatarEmoji, setAvatarEmoji] = useState(editing?.avatarEmoji ?? '👋');
  const [note, setNote] = useState(editing?.note ?? '');
  const [message, setMessage] = useState<string | null>(null);

  function submit() {
    if (!name.trim()) return setMessage('先填访客的名字');
    setMessage(null);
    save.mutate(
      {
        id: editing?.id,
        body: { name: name.trim(), avatarEmoji: avatarEmoji.trim() || '👋', note: note.trim() || null },
      },
      {
        onSuccess: () => {
          pushToast(editing ? '访客资料已更新' : `已记下访客「${name.trim()}」`);
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没保存成功'),
      },
    );
  }

  return (
    <Dialog
      title={editing ? `编辑「${editing.name}」` : '新增访客'}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={save.isPending} onClick={submit}>
            {save.isPending ? '保存中…' : '保存访客'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[84px_1fr] gap-3">
          <label className="block">
            <span className={label}>头像</span>
            <Input
              value={avatarEmoji}
              maxLength={4}
              aria-label="访客头像"
              className="text-center text-xl"
              onChange={(event) => setAvatarEmoji(event.target.value)}
            />
          </label>
          <label className="block">
            <span className={label}>姓名</span>
            <Input
              autoFocus
              value={name}
              maxLength={64}
              aria-label="访客姓名"
              placeholder="比如：小林"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && submit()}
            />
          </label>
        </div>
        <label className="block">
          <span className={label}>备注（选填）</span>
          <Input
            value={note}
            maxLength={240}
            aria-label="访客备注"
            placeholder="称呼、忌口这些"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>
    </Dialog>
  );
}

export function VisitForm({
  editing,
  guests,
  wifiProfiles,
  onClose,
}: {
  editing: Visit | null;
  guests: Guest[];
  wifiProfiles: GuestWifiProfile[];
  onClose: () => void;
}) {
  const save = useUpsertVisit();
  const start = editing ? new Date(editing.startsAt) : null;
  const [title, setTitle] = useState(editing?.title ?? '');
  const [date, setDate] = useState(() => {
    const base = start ?? new Date();
    const y = base.getFullYear();
    const m = String(base.getMonth() + 1).padStart(2, '0');
    const d = String(base.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  });
  const [time, setTime] = useState(
    start ? `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}` : '18:00',
  );
  const [note, setNote] = useState(editing?.note ?? '');
  const [selected, setSelected] = useState<string[]>(
    editing ? editing.guests.map((one) => one.guest.id) : [],
  );
  const [wifiId, setWifiId] = useState<string | null>(editing?.guestWifiProfile?.id ?? null);
  const [message, setMessage] = useState<string | null>(null);

  const activeGuests = guests.filter((one) => one.isActive && !one.anonymizedAt);
  const activeWifi = wifiProfiles.filter((one) => one.isActive);

  function submit() {
    if (!title.trim()) return setMessage('先给这次来访起个名字');
    if (!selected.length) return setMessage('至少选一位访客');
    const startsAt = new Date(`${date}T${time}:00`);
    if (Number.isNaN(startsAt.getTime())) return setMessage('时间没填对');
    setMessage(null);
    save.mutate(
      {
        id: editing?.id,
        body: {
          title: title.trim(),
          startsAt: startsAt.toISOString(),
          note: note.trim() || null,
          guestIds: selected,
          guestWifiProfileId: wifiId,
        },
      },
      {
        onSuccess: () => {
          pushToast(editing ? '来访计划已更新' : '来访已安排好');
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没保存成功'),
      },
    );
  }

  return (
    <Dialog
      title={editing ? `编辑「${editing.title}」` : '安排来访'}
      onClose={onClose}
      maxWidth={520}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={save.isPending || !activeGuests.length} onClick={submit}>
            {save.isPending ? '保存中…' : '保存来访计划'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className={label}>这次来访叫什么</span>
          <Input
            autoFocus
            value={title}
            maxLength={120}
            aria-label="来访主题"
            placeholder="比如：周末晚餐"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={label}>日期</span>
            <Input type="date" value={date} aria-label="来访日期" onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="block">
            <span className={label}>开始时间</span>
            <Input type="time" value={time} aria-label="开始时间" onChange={(event) => setTime(event.target.value)} />
          </label>
        </div>
        <div>
          <span className={label}>谁来（至少一位）</span>
          {activeGuests.length ? (
            <div className="flex flex-wrap gap-1.5">
              {activeGuests.map((one) => {
                const on = selected.includes(one.id);
                return (
                  <button
                    key={one.id}
                    type="button"
                    aria-pressed={on}
                    className={chip(on)}
                    onClick={() =>
                      setSelected((current) =>
                        on ? current.filter((id) => id !== one.id) : [...current, one.id],
                      )
                    }
                  >
                    {one.avatarEmoji} {one.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-[13px] text-ink-soft">还没有访客，先去上面「+ 新增访客」。</p>
          )}
        </div>
        <div>
          <span className={label}>这次用哪个访客 Wi-Fi（选填）</span>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={wifiId === null} className={chip(wifiId === null)} onClick={() => setWifiId(null)}>
              不提供
            </button>
            {activeWifi.map((one) => (
              <button
                key={one.id}
                type="button"
                aria-pressed={wifiId === one.id}
                className={chip(wifiId === one.id)}
                onClick={() => setWifiId(one.id)}
              >
                {one.name}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className={label}>备注（只有家里人看得到）</span>
          <Input
            value={note}
            maxLength={1000}
            aria-label="来访备注"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>
    </Dialog>
  );
}

export function WifiForm({
  editing,
  onClose,
}: {
  editing: GuestWifiProfile | null;
  onClose: () => void;
}) {
  const save = useUpsertGuestWifiProfile();
  const [name, setName] = useState(editing?.name ?? '');
  const [ssid, setSsid] = useState(editing?.ssid ?? '');
  const [security, setSecurity] = useState<GuestWifiSecurity>(editing?.security ?? 'WPA');
  const [password, setPassword] = useState('');
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);
  const [message, setMessage] = useState<string | null>(null);

  function submit() {
    if (!name.trim()) return setMessage('先给这套配置起个名字');
    if (!ssid.trim()) return setMessage('填一下 Wi-Fi 名称（SSID）');
    if (security === 'WPA' && !editing && password.trim().length < 8) {
      return setMessage('WPA 的密码至少 8 位');
    }
    setMessage(null);
    save.mutate(
      {
        id: editing?.id,
        body: {
          name: name.trim(),
          ssid: ssid.trim(),
          security,
          ...(password.trim() ? { password: password.trim() } : {}),
          ...(editing ? { isActive } : {}),
        },
      },
      {
        onSuccess: () => {
          pushToast(editing ? 'Wi-Fi 配置已更新' : 'Wi-Fi 配置已保存');
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没保存成功'),
      },
    );
  }

  return (
    <Dialog
      title={editing ? `编辑「${editing.name}」` : '新增访客 Wi-Fi'}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={save.isPending} onClick={submit}>
            {save.isPending ? '保存中…' : '保存 Wi-Fi 配置'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="rounded-lg bg-muted px-3 py-2 text-[12px] text-ink-soft">
          密码加密存着，页面上只显示「已配置」；访客在邀请页扫二维码直接连。
        </p>
        <label className="block">
          <span className={label}>配置名称</span>
          <Input
            autoFocus
            value={name}
            maxLength={64}
            aria-label="Wi-Fi 配置名称"
            placeholder="比如：客厅访客网络"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="block">
          <span className={label}>Wi-Fi 名称（SSID）</span>
          <Input
            value={ssid}
            maxLength={32}
            aria-label="Wi-Fi 名称"
            placeholder="Family-Guest"
            onChange={(event) => setSsid(event.target.value)}
          />
        </label>
        <div>
          <span className={label}>加密方式</span>
          <div className="flex gap-1.5">
            {(['WPA', 'nopass'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={security === value}
                className={chip(security === value)}
                onClick={() => setSecurity(value)}
              >
                {value === 'WPA' ? 'WPA / WPA2' : '开放网络'}
              </button>
            ))}
          </div>
        </div>
        {security === 'WPA' ? (
          <label className="block">
            <span className={label}>
              密码{editing?.passwordConfigured ? '（留空就不改）' : '（至少 8 位）'}
            </span>
            <Input
              type="password"
              value={password}
              maxLength={63}
              aria-label="Wi-Fi 密码"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        ) : null}
        {editing ? (
          <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
            <Checkbox label="在用" checked={isActive} onChange={() => setIsActive((value) => !value)} />
            <span className="text-[13px]">在用（取消勾选就不再出现在来访里）</span>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
