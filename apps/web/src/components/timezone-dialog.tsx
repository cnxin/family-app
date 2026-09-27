import { useEffect, useMemo, useState } from 'react';
import { deviceTimeZone, timeZoneGroups } from '../lib/timezones';
import { Button, Dialog, Input } from './ui';

export function TimezoneDialog({
  current,
  pending,
  onClose,
  onPick,
}: {
  current: string;
  pending: boolean;
  onClose: () => void;
  onPick: (zone: string) => void;
}) {
  const device = deviceTimeZone();
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return timeZoneGroups()
      .map((group) => ({
        ...group,
        list: keyword
          ? group.list.filter(
              (item) => item.label.toLowerCase().includes(keyword) || item.zone.toLowerCase().includes(keyword),
            )
          : group.list,
      }))
      .filter((group) => group.list.length);
  }, [query]);

  useEffect(() => {
    document.getElementById(`tz-${current}`)?.scrollIntoView({ block: 'center' });
  }, [current]);

  return (
    <Dialog title="家庭时区" onClose={onClose} maxWidth={480}>
      <p className="text-[13px] leading-relaxed text-ink-soft">
        改变时区不会移动已记录的日期，只影响「今天」的判断。
      </p>
      <Input
        value={query}
        aria-label="搜索时区"
        placeholder="搜城市，比如洛杉矶"
        className="mt-3"
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="mt-3 flex max-h-[50vh] flex-col gap-3 overflow-y-auto">
        {groups.map((group) => (
          <section key={group.continent}>
            <h3 className="px-1 text-[12px] font-medium text-ink-soft">{group.continent}</h3>
            <div className="mt-1 overflow-hidden rounded-lg border border-border">
              {group.list.map((item) => {
                const active = item.zone === current;
                const here = item.zone === device;
                return (
                  <button
                    key={item.zone}
                    id={`tz-${item.zone}`}
                    type="button"
                    disabled={pending}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => onPick(item.zone)}
                    className={
                      'flex min-h-11 w-full items-center gap-2 border-b border-border px-3 text-left text-sm last:border-b-0 ' +
                      (active ? 'bg-accent-soft text-accent' : 'hover:bg-muted')
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {active ? <span className="shrink-0 text-[11px]">当前</span> : null}
                    {here ? <span className="shrink-0 text-[11px] text-ink-soft">这台设备</span> : null}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        {groups.length === 0 ? <p className="px-1 text-[13px] text-ink-soft">没有叫这个的时区</p> : null}
      </div>
      <Button variant="outline" className="mt-3 w-full" onClick={onClose}>
        取消
      </Button>
    </Dialog>
  );
}
