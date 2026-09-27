import { useState } from 'react';
import type { HouseholdMedia, MediaSearchResult } from '@family/contracts';
import { useAddMediaExternalRefs, useCreateMediaRequest } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { MediaSearchPanel } from './media-search-panel';
import { Button, Dialog, Input } from './ui';

/** 让 MoviePilot 去找片。电影不填季数，剧集必须填。 */
export function SubscriptionDialog({
  entry,
  onClose,
}: {
  entry: HouseholdMedia;
  onClose: () => void;
}) {
  const create = useCreateMediaRequest();
  const series = entry.mediaTitle.type === 'series';
  const [season, setSeason] = useState('1');
  const [message, setMessage] = useState<string | null>(null);

  function submit() {
    let value: number | undefined;
    if (series) {
      value = Number(season);
      if (!Number.isInteger(value) || value < 1 || value > 999) {
        return setMessage('季数填 1 到 999 的整数');
      }
    }
    setMessage(null);
    create.mutate(
      { mediaId: entry.id, season: value },
      {
        onSuccess: () => {
          pushToast('订阅提交了，MoviePilot 去找片了');
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没提交成功'),
      },
    );
  }

  return (
    <Dialog
      title="让 MoviePilot 找这部"
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {message ? <p className="text-[13px] text-danger">{message}</p> : null}
          <Button className="w-full" disabled={create.isPending} onClick={submit}>
            {create.isPending ? '提交中…' : '提交订阅'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-ink-soft">{entry.mediaTitle.title}</p>
        {series ? (
          <label className="block">
            <span className="mb-1 block text-[12px] text-ink-soft">第几季</span>
            <Input
              autoFocus
              inputMode="numeric"
              value={season}
              maxLength={3}
              aria-label="订阅季数"
              onChange={(event) => setSeason(event.target.value)}
            />
          </label>
        ) : (
          <p className="text-[13px] text-ink-soft">电影不用选季数，直接提交就行。</p>
        )}
      </div>
    </Dialog>
  );
}

/** 没有 TMDB ID 就没法让 MoviePilot 找片，这里补一个（只能补，不能改）。 */
export function MetadataLinkDialog({
  entry,
  onClose,
}: {
  entry: HouseholdMedia;
  onClose: () => void;
}) {
  const addRefs = useAddMediaExternalRefs();
  const [manual, setManual] = useState(false);
  const [tmdbId, setTmdbId] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  function save(value: string) {
    if (!/^\d+$/.test(value)) return setMessage('TMDB ID 只能是数字');
    setMessage(null);
    addRefs.mutate(
      { id: entry.id, externalRefs: [{ provider: 'tmdb', externalId: value }] },
      {
        onSuccess: () => {
          pushToast('TMDB ID 补上了');
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没补上'),
      },
    );
  }

  function pick(result: MediaSearchResult) {
    const ref = result.externalRefs.find((one) => one.provider === 'tmdb');
    if (!ref) return setMessage('这条结果没有 TMDB ID，换一条试试');
    save(ref.externalId);
  }

  return (
    <Dialog
      title={`给「${entry.mediaTitle.title}」补个 TMDB ID`}
      maxWidth={560}
      onClose={onClose}
      footer={
        manual ? (
          <div className="flex flex-col gap-2">
            {message ? <p className="text-[13px] text-danger">{message}</p> : null}
            <Button className="w-full" disabled={addRefs.isPending} onClick={() => save(tmdbId.trim())}>
              {addRefs.isPending ? '保存中…' : '保存 TMDB ID'}
            </Button>
          </div>
        ) : message ? (
          <p className="text-[13px] text-danger">{message}</p>
        ) : null
      }
    >
      {manual ? (
        <div className="flex flex-col gap-3">
          <Button variant="ghost" className="self-start text-[13px]" onClick={() => setManual(false)}>
            ← 回去搜
          </Button>
          <label className="block">
            <span className="mb-1 block text-[12px] text-ink-soft">TMDB ID</span>
            <Input
              autoFocus
              inputMode="numeric"
              value={tmdbId}
              maxLength={18}
              aria-label="TMDB ID"
              placeholder="例如 550"
              onChange={(event) => setTmdbId(event.target.value)}
            />
          </label>
        </div>
      ) : (
        <MediaSearchPanel
          type={entry.mediaTitle.type}
          onTypeChange={() => undefined}
          showTypeSelector={false}
          initialQuery={entry.mediaTitle.title}
          onPick={pick}
          onManual={() => setManual(true)}
          manualLabel="直接填 TMDB ID"
        />
      )}
    </Dialog>
  );
}
