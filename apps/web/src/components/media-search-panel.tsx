import { useState } from 'react';
import type { MediaSearchResult, MediaType } from '@family/contracts';
import { mediaAsset, useMediaSearch } from '../lib/queries';
import { Button, Input, Segmented } from './ui';

const SOURCE_NAMES: Record<string, string> = {
  douban: '豆瓣',
  tmdb: 'TMDB',
  bangumi: 'Bangumi',
};

/** 三个元数据源各查各的，谁没配就只有那一条显示未配置，不影响别的源出结果。 */
export function MediaSearchPanel({
  type,
  onTypeChange,
  showTypeSelector = true,
  initialQuery = '',
  onPick,
  onManual,
  manualLabel = '手动填',
}: {
  type: MediaType;
  onTypeChange: (type: MediaType) => void;
  showTypeSelector?: boolean;
  initialQuery?: string;
  onPick: (result: MediaSearchResult) => void;
  onManual: () => void;
  manualLabel?: string;
}) {
  const [draft, setDraft] = useState(initialQuery);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const search = useMediaSearch(query, type, true);

  function submit() {
    if (!draft.trim()) return setMessage('先输入片名');
    setMessage(null);
    if (draft.trim() === query) void search.refetch();
    else setQuery(draft.trim());
  }

  const results = search.data?.results ?? [];

  return (
    <div className="flex flex-col gap-3">
      {showTypeSelector ? (
        <Segmented
          value={type}
          onChange={onTypeChange}
          options={[
            { value: 'movie' as const, label: '电影' },
            { value: 'series' as const, label: '剧集' },
          ]}
        />
      ) : null}

      <div className="flex items-center gap-1.5">
        <Input
          autoFocus
          value={draft}
          aria-label="搜索在线影视"
          placeholder="输入电影或剧集名称"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
        />
        <Button variant="outline" className="shrink-0" disabled={search.isFetching} onClick={submit}>
          {search.isFetching ? '搜索中…' : '搜索'}
        </Button>
      </div>

      {message ? <p className="text-[13px] text-danger">{message}</p> : null}

      {search.data ? (
        <div className="flex flex-wrap gap-1.5">
          {search.data.sources.map((source) => (
            <span
              key={source.provider}
              title={source.message ?? undefined}
              className={
                'rounded-full px-2 py-0.5 text-[11px] ' +
                (source.state === 'online'
                  ? 'bg-accent-soft text-accent'
                  : 'bg-muted text-ink-soft')
              }
            >
              {SOURCE_NAMES[source.provider] ?? source.provider}{' '}
              {source.state === 'online'
                ? source.resultCount
                : source.state === 'not_configured'
                  ? '没配'
                  : '连不上'}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex max-h-[320px] flex-col gap-1.5 overflow-y-auto">
        {query && !search.isFetching && results.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-ink-soft">
            没找到。可以换个词，或者直接手动填。
          </p>
        ) : null}
        {results.map((result) => {
          const poster = mediaAsset(result.posterUrl);
          return (
            <button
              key={result.key}
              type="button"
              aria-label={`选择${result.title}`}
              onClick={() => onPick(result)}
              className="flex gap-2.5 rounded-lg border border-border p-2 text-left transition-colors duration-150 hover:bg-muted"
            >
              {poster ? (
                <img src={poster} alt="" className="h-[72px] w-12 shrink-0 rounded object-cover" />
              ) : (
                <span className="grid h-[72px] w-12 shrink-0 place-items-center rounded bg-muted">
                  🎞️
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{result.title}</p>
                <p className="truncate text-[12px] text-ink-soft">
                  {result.type === 'movie' ? '电影' : '剧集'}
                  {result.year ? ` · ${result.year}` : ''}
                  {result.originalTitle ? ` · ${result.originalTitle}` : ''}
                </p>
                {result.overview ? (
                  <p className="line-clamp-2 text-[12px] text-ink-soft">{result.overview}</p>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      <Button variant="ghost" className="text-[13px]" onClick={onManual}>
        {manualLabel}
      </Button>
    </div>
  );
}
