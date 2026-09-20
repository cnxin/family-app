import { SoftLink } from './soft-link';

/**
 * 首页顶上那一条「今天一眼看完」。
 *
 * 原来的首页是四块一模一样的列表面板摞在一起，没有主次，打开第一眼不知道该看哪儿。
 * 这一条的作用就是给出那个「先看这里」：四个数字，哪个不是 0 哪个就跳出来，
 * 点一下直接去那一页。数字是 0 的时候刻意压成灰的——没有事才是好消息，不该抢眼。
 */
export interface TodayStat {
  key: string;
  label: string;
  value: number;
  unit: string;
  to: string;
  tone?: 'accent' | 'warm';
}

export function TodayStats({ stats }: { stats: TodayStat[] }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 rounded-card border border-border bg-gradient-to-br from-accent-soft/60 via-surface to-surface p-1.5 sm:grid-cols-4">
      {stats.map((stat) => {
        const quiet = stat.value === 0;
        const color = quiet
          ? 'text-ink-soft'
          : stat.tone === 'warm'
            ? 'text-warm'
            : stat.tone === 'accent'
              ? 'text-accent'
              : 'text-ink';
        return (
          <SoftLink
            key={stat.key}
            to={stat.to}
            className="rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-surface"
          >
            <p className="flex items-baseline gap-1">
              <span className={`text-[26px] font-semibold leading-none tabular-nums ${color}`}>
                {stat.value}
              </span>
              <span className="text-[12px] text-ink-soft">{stat.unit}</span>
            </p>
            <p className="mt-1 text-[12px] text-ink-soft">{stat.label}</p>
          </SoftLink>
        );
      })}
    </div>
  );
}
