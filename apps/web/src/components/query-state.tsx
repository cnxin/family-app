import { useState } from 'react';
import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ListSkeleton } from './skeleton';
import { Button } from './ui';

/** 请求失败、但上次的结果还在。可关掉，下次再失败会重新出现。 */
export function StaleNotice({ onRetry }: { onRetry?: () => void }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <p role="status" className="flex flex-wrap items-center gap-2 border-b border-border bg-warm-soft px-3.5 py-2 text-[13px] text-ink">
      <span className="min-w-0 flex-1">没刷新出来</span>
      {onRetry ? (
        <button type="button" className="min-h-11 px-2 text-accent" onClick={onRetry}>
          重试
        </button>
      ) : null}
      <button type="button" aria-label="关闭" className="min-h-11 px-2 text-ink-soft" onClick={() => setOpen(false)}>
        关闭
      </button>
    </p>
  );
}

/** 第一次就失败，没有可显示的结果。 */
export function QueryFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 px-3.5 py-6">
      <p className="text-sm text-ink-soft">没加载出来</p>
      <Button className="h-11 min-h-11 px-3 text-[13px]" onClick={onRetry}>
        再试一次
      </Button>
    </div>
  );
}

type QueryLike<T> = Pick<UseQueryResult<T>, 'isPending' | 'isError' | 'data' | 'refetch'>;

export function queryPhase<T>(query: QueryLike<T>): 'pending' | 'failed' | 'stale' | 'ready' {
  if (query.isPending) return 'pending';
  if (query.isError && query.data === undefined) return 'failed';
  if (query.isError) return 'stale';
  return 'ready';
}

/**
 * 空态只在请求成功且结果为空时出现。
 * 失败且有缓存：继续显示缓存，并给一条可关闭的提示。
 * 失败且无缓存：失败态 + 重试。加载中是骨架。
 */
export function QueryState<T>({
  query,
  isEmpty,
  empty,
  skeleton,
  children,
}: {
  query: QueryLike<T>;
  isEmpty?: (data: T) => boolean;
  empty: ReactNode;
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <>{skeleton ?? <ListSkeleton />}</>;
  if (query.isError && query.data === undefined) {
    return <QueryFailure onRetry={() => void query.refetch()} />;
  }
  const data = query.data as T;
  const blank = isEmpty ? isEmpty(data) : Array.isArray(data) && data.length === 0;
  return (
    <>
      {query.isError ? <StaleNotice onRetry={() => void query.refetch()} /> : null}
      {blank ? empty : children(data)}
    </>
  );
}

/**
 * 包住一块已经写好的列表。children 里的空态只有在请求成功，或失败但仍有缓存时才会画出来。
 */
export function QueryFrame({
  query,
  queries,
  skeleton,
  children,
}: {
  query?: QueryLike<unknown>;
  queries?: QueryLike<unknown>[];
  skeleton?: ReactNode;
  children: ReactNode;
}) {
  const list = queries ?? (query ? [query] : []);
  if (list.some((item) => item.isPending)) return <>{skeleton ?? <ListSkeleton />}</>;
  if (list.some((item) => item.isError && item.data === undefined)) {
    return (
      <QueryFailure
        onRetry={() => {
          for (const item of list) void item.refetch();
        }}
      />
    );
  }
  const stale = list.some((item) => item.isError);
  return (
    <>
      {stale ? (
        <StaleNotice
          onRetry={() => {
            for (const item of list) {
              if (item.isError) void item.refetch();
            }
          }}
        />
      ) : null}
      {children}
    </>
  );
}
