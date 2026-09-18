import { useState } from 'react';
import type {
  HouseholdMedia,
  HouseholdMediaStatus,
  MediaExternalProvider,
  MediaType,
} from '@family/contracts';
import {
  MEDIA_STATUS_LABELS,
  MEDIA_STATUS_TRANSITIONS,
  todayISO,
  useCreateMedia,
  useUpdateMedia,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { MediaSearchPanel } from './media-search-panel';
import { Button, Checkbox, Dialog, Input } from './ui';

const label = 'mb-1 block text-[12px] text-ink-soft';
const chip = (active: boolean) =>
  'rounded-full border px-2.5 py-1 text-[13px] transition-colors duration-150 ' +
  (active ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-soft hover:bg-muted');
const textarea =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-soft/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25';

const REF_FIELDS: { provider: MediaExternalProvider; name: string; placeholder: string }[] = [
  { provider: 'tmdb', name: 'TMDB ID', placeholder: '例如 550' },
  { provider: 'imdb', name: 'IMDb ID', placeholder: '例如 tt0137523' },
  { provider: 'douban', name: '豆瓣 ID', placeholder: '可不填' },
  { provider: 'bangumi', name: 'Bangumi ID', placeholder: '可不填' },
];

export function MediaForm({
  editing,
  onClose,
}: {
  editing: HouseholdMedia | null;
  onClose: () => void;
}) {
  const create = useCreateMedia();
  const update = useUpdateMedia();

  const [step, setStep] = useState<'search' | 'details'>(editing ? 'details' : 'search');
  const [type, setType] = useState<MediaType>(editing?.mediaTitle.type ?? 'movie');
  const [title, setTitle] = useState(editing?.mediaTitle.title ?? '');
  const [originalTitle, setOriginalTitle] = useState(editing?.mediaTitle.originalTitle ?? '');
  const [year, setYear] = useState(editing?.mediaTitle.year ? String(editing.mediaTitle.year) : '');
  const [overview, setOverview] = useState(editing?.mediaTitle.overview ?? '');
  const [posterUrl, setPosterUrl] = useState(editing?.mediaTitle.posterUrl ?? '');
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<HouseholdMediaStatus>(editing?.status ?? 'watchlist');
  const [scheduled, setScheduled] = useState(Boolean(editing?.scheduledFor));
  const [scheduledFor, setScheduledFor] = useState(editing?.scheduledFor ?? todayISO());
  const [note, setNote] = useState(editing?.note ?? '');
  const [message, setMessage] = useState<string | null>(null);

  const busy = create.isPending || update.isPending;
  // 编辑时只能在当前状态允许的几个之间走，新建时随便选
  const allowed = editing
    ? new Set<HouseholdMediaStatus>([editing.status, ...MEDIA_STATUS_TRANSITIONS[editing.status]])
    : new Set<HouseholdMediaStatus>(Object.keys(MEDIA_STATUS_LABELS) as HouseholdMediaStatus[]);

  // 状态和排期互相牵着：选了「已排期」就把日期打开，选回「想看」就收起来
  function pickStatus(next: HouseholdMediaStatus) {
    setStatus(next);
    if (next === 'scheduled') setScheduled(true);
    if (next === 'watchlist' || next === 'voting' || next === 'dropped') setScheduled(false);
  }
  function toggleScheduled() {
    const next = !scheduled;
    setScheduled(next);
    if (next && (status === 'watchlist' || status === 'voting')) setStatus('scheduled');
    if (!next && status === 'scheduled') setStatus('watchlist');
  }

  function submit() {
    if (status === 'scheduled' && !scheduled) return setMessage('排了期就得选个日子');
    if (editing) {
      setMessage(null);
      update.mutate(
        {
          id: editing.id,
          status,
          scheduledFor: scheduled ? scheduledFor : null,
          note: note.trim() || null,
        },
        {
          onSuccess: () => {
            pushToast('安排改好了');
            onClose();
          },
          onError: (error) => setMessage(error instanceof Error ? error.message : '没保存成功'),
        },
      );
      return;
    }

    if (!title.trim()) return setMessage('先填片名');
    const parsedYear = year.trim() ? Number(year) : null;
    if (parsedYear !== null && (!Number.isInteger(parsedYear) || parsedYear < 1878 || parsedYear > 2199)) {
      return setMessage('年份填 1878 到 2199 之间');
    }
    const poster = posterUrl.trim();
    if (poster && !/^https?:\/\//.test(poster)) return setMessage('海报链接要以 http:// 开头');
    setMessage(null);
    create.mutate(
      {
        type,
        title: title.trim(),
        originalTitle: originalTitle.trim() || null,
        year: parsedYear,
        overview: overview.trim() || null,
        posterUrl: poster || null,
        status,
        scheduledFor: scheduled ? scheduledFor : null,
        note: note.trim() || null,
        externalRefs: REF_FIELDS.filter((field) => refs[field.provider]?.trim()).map((field) => ({
          provider: field.provider,
          externalId: refs[field.provider].trim(),
        })),
      },
      {
        onSuccess: (entry) => {
          pushToast(`「${entry.mediaTitle.title}」加进片单了`);
          onClose();
        },
        onError: (error) => setMessage(error instanceof Error ? error.message : '没加进去'),
      },
    );
  }

  return (
    <Dialog
      title={editing ? `编辑「${editing.mediaTitle.title}」的安排` : '加进家庭片单'}
      maxWidth={600}
      onClose={onClose}
      footer={
        step === 'search' ? null : (
          <div className="flex flex-col gap-2">
            {message ? <p className="text-[13px] text-danger">{message}</p> : null}
            <Button className="w-full" disabled={busy} onClick={submit}>
              {busy ? '保存中…' : editing ? '保存安排' : '加进片单'}
            </Button>
          </div>
        )
      }
    >
      {step === 'search' ? (
        <MediaSearchPanel
          type={type}
          onTypeChange={setType}
          onPick={(result) => {
            setType(result.type);
            setTitle(result.title);
            setOriginalTitle(result.originalTitle ?? '');
            setYear(result.year ? String(result.year) : '');
            setOverview(result.overview ?? '');
            setPosterUrl(result.posterUrl ?? '');
            setRefs(
              Object.fromEntries(result.externalRefs.map((ref) => [ref.provider, ref.externalId])),
            );
            setStep('details');
          }}
          onManual={() => setStep('details')}
          manualLabel="都没有？手动填"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {editing ? null : (
            <Button variant="ghost" className="self-start text-[13px]" onClick={() => setStep('search')}>
              ← 回去搜
            </Button>
          )}

          {editing ? (
            <p className="text-[12px] text-ink-soft">
              {editing.mediaTitle.type === 'movie' ? '电影' : '剧集'}
              {editing.mediaTitle.year ? ` · ${editing.mediaTitle.year}` : ''}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {(['movie', 'series'] as MediaType[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={type === value}
                    className={chip(type === value)}
                    onClick={() => setType(value)}
                  >
                    {value === 'movie' ? '电影' : '剧集'}
                  </button>
                ))}
              </div>
              <label className="block">
                <span className={label}>片名</span>
                <Input
                  value={title}
                  maxLength={180}
                  aria-label="影视名称"
                  placeholder="名称"
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className={label}>原名（选填）</span>
                  <Input
                    value={originalTitle}
                    maxLength={180}
                    aria-label="原名"
                    placeholder="可不填"
                    onChange={(event) => setOriginalTitle(event.target.value)}
                  />
                </label>
                <label className="block">
                  <span className={label}>年份（选填）</span>
                  <Input
                    inputMode="numeric"
                    value={year}
                    maxLength={4}
                    aria-label="年份"
                    placeholder="例如 2026"
                    onChange={(event) => setYear(event.target.value)}
                  />
                </label>
              </div>
              <label className="block">
                <span className={label}>简介（选填）</span>
                <textarea
                  value={overview}
                  rows={3}
                  maxLength={5000}
                  aria-label="简介"
                  placeholder="剧情简介"
                  className={textarea}
                  onChange={(event) => setOverview(event.target.value)}
                />
              </label>
              <label className="block">
                <span className={label}>海报链接（选填）</span>
                <Input
                  value={posterUrl}
                  maxLength={2000}
                  aria-label="海报链接"
                  placeholder="https://"
                  onChange={(event) => setPosterUrl(event.target.value)}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                {REF_FIELDS.map((field) => (
                  <label key={field.provider} className="block">
                    <span className={label}>{field.name}</span>
                    <Input
                      value={refs[field.provider] ?? ''}
                      maxLength={180}
                      aria-label={field.name}
                      placeholder={field.placeholder}
                      onChange={(event) =>
                        setRefs((current) => ({ ...current, [field.provider]: event.target.value }))
                      }
                    />
                  </label>
                ))}
              </div>
            </>
          )}

          <div>
            <span className={label}>现在算什么状态</span>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(MEDIA_STATUS_LABELS) as HouseholdMediaStatus[])
                .filter((value) => allowed.has(value))
                .map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={status === value}
                    className={chip(status === value)}
                    onClick={() => pickStatus(value)}
                  >
                    {MEDIA_STATUS_LABELS[value]}
                  </button>
                ))}
            </div>
          </div>

          <div className="rounded-lg border border-border px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Checkbox checked={scheduled} label="安排观影日期" onChange={toggleScheduled} />
              <span className="text-[13px]">定个日子看</span>
            </div>
            {scheduled ? (
              <Input
                type="date"
                value={scheduledFor}
                aria-label="观影日期"
                className="mt-2"
                onChange={(event) => setScheduledFor(event.target.value)}
              />
            ) : null}
          </div>

          <label className="block">
            <span className={label}>家里的备注（选填）</span>
            <textarea
              value={note}
              rows={2}
              maxLength={1000}
              aria-label="家庭备注"
              placeholder="版本偏好、要准备什么"
              className={textarea}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        </div>
      )}
    </Dialog>
  );
}
