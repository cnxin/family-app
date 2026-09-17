/**
 * 骨架屏：加载时占住和真实内容一样的位置，页面不会先塌一下再弹回来。
 * 转圈只告诉你「在等」，骨架屏还顺带告诉你「等的是什么形状」。
 */
export function Skeleton({
  className = '',
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`animate-pulse rounded-md bg-muted ${className}`} style={style} aria-hidden />
  );
}

/** 列表类页面的通用骨架：一行图标 + 两行文字。 */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="mt-5 overflow-hidden rounded-card border border-border bg-surface" aria-busy>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-b border-border px-3 py-3 last:border-b-0">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5" style={{ width: `${45 + ((index * 17) % 35)}%` }} />
            <Skeleton className="mt-2 h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 统计卡片行的骨架（库存那种四连卡）。 */
export function StatsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="mt-4 flex gap-2" aria-busy>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex-1 rounded-card border border-border bg-surface px-3 py-2.5">
          <Skeleton className="h-6 w-8" />
          <Skeleton className="mt-2 h-3 w-14" />
        </div>
      ))}
    </div>
  );
}
