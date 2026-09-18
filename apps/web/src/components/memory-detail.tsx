import { useRef, useState } from 'react';
import type { FamilyMemory } from '@family/contracts';
import {
  MEMORY_CATEGORY_LABELS,
  MEMORY_PHOTO_LIMIT,
  MEMORY_SOURCE_LABELS,
  memoryDateLabel,
  memoryKey,
  memoryPhotoSrc,
  useSetMemoryArchived,
  useUploadMemoryPhoto,
} from '../lib/queries';
import { pushToast } from '../lib/toast';
import { SoftLink } from './soft-link';
import { toNewRoute } from '../lib/routes';
import { Button, Dialog, Input } from './ui';

export function MemoryDetail({
  memory,
  onEdit,
  onArchived,
  onClose,
}: {
  memory: FamilyMemory;
  onEdit: () => void;
  onArchived: () => void;
  onClose: () => void;
}) {
  const setArchived = useSetMemoryArchived();
  const upload = useUploadMemoryPhoto();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const archived = Boolean(memory.archivedAt);
  const full = memory.photos.length >= MEMORY_PHOTO_LIMIT;
  const target = memory.source ? toNewRoute(memory.source.targetPath) : null;

  function addPhoto() {
    if (!file) return;
    setMessage(null);
    upload.mutate(
      {
        memoryId: memory.id,
        file,
        caption: caption.trim(),
        idempotencyKey: memoryKey(`memory:photo:${memory.id}`),
      },
      {
        onSuccess: () => {
          setFile(null);
          setCaption('');
          if (fileRef.current) fileRef.current.value = '';
          pushToast('照片放进这条回忆了');
        },
        // 传失败时故意留着已选的文件和说明，直接再点一次就能重试
        onError: (error) => setMessage(error instanceof Error ? error.message : '照片没传上去'),
      },
    );
  }

  return (
    <Dialog
      title={memory.title}
      maxWidth={720}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {memory.canEdit && !archived ? (
            <Button variant="outline" className="h-9 px-3 text-[13px]" onClick={onEdit}>
              编辑
            </Button>
          ) : null}
          {memory.canEdit ? (
            <Button
              variant="ghost"
              className={'h-9 px-3 text-[13px] ' + (archived ? 'text-accent' : 'text-danger')}
              disabled={setArchived.isPending}
              onClick={() => setAsking(true)}
            >
              {archived ? '恢复' : '归档'}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-ink-soft">
          {MEMORY_CATEGORY_LABELS[memory.category]} · {memoryDateLabel(memory.happenedOn)} ·{' '}
          {memory.createdBy.name} 记的
          {archived ? ' · 已归档' : ''}
        </p>

        {memory.photos.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {memory.photos.map((photo) => (
              <figure key={photo.id} className="m-0">
                <img
                  src={memoryPhotoSrc(photo.contentUrl)}
                  alt={photo.caption ?? memory.title}
                  className="aspect-[4/3] w-full rounded-lg object-cover"
                />
                {photo.caption ? (
                  <figcaption className="mt-1 text-[12px] text-ink-soft">{photo.caption}</figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        ) : null}

        {memory.story ? (
          <p className="whitespace-pre-wrap text-[14px] leading-7">{memory.story}</p>
        ) : (
          <p className="text-[13px] text-ink-soft">这条回忆还没写下故事。</p>
        )}

        {memory.tags.length ? (
          <div className="flex flex-wrap gap-1.5">
            {memory.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-ink-soft">
                #{tag}
              </span>
            ))}
          </div>
        ) : null}

        {memory.source ? (
          target ? (
            <SoftLink to={target} className="text-[13px] text-accent hover:underline">
              来自{MEMORY_SOURCE_LABELS[memory.source.module] ?? '其他'} →
            </SoftLink>
          ) : (
            <p className="text-[13px] text-ink-soft">
              来自{MEMORY_SOURCE_LABELS[memory.source.module] ?? '其他'}
            </p>
          )
        ) : null}

        {memory.canEdit && !archived ? (
          <div className="rounded-lg border border-border px-3 py-2.5">
            <p className="text-[12px] text-ink-soft">
              加照片 · 最多 {MEMORY_PHOTO_LIMIT} 张，每张不超过 10MB（GIF / JPEG / PNG / WebP）
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/gif,image/jpeg,image/png,image/webp"
              className="hidden"
              aria-label="选择回忆照片"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="h-9 px-3 text-[13px]"
                disabled={full || upload.isPending}
                onClick={() => fileRef.current?.click()}
              >
                {file ? '换一张' : '选照片'}
              </Button>
              <Input
                value={caption}
                maxLength={240}
                aria-label="照片说明"
                placeholder="照片说明（选填）"
                className="h-9 min-w-[160px] flex-1"
                onChange={(event) => setCaption(event.target.value)}
              />
              <Button
                className="h-9 px-3 text-[13px]"
                disabled={!file || upload.isPending}
                onClick={addPhoto}
              >
                {upload.isPending ? '上传中…' : '加进去'}
              </Button>
            </div>
            {file ? <p className="mt-1 truncate text-[12px] text-ink-soft">{file.name}</p> : null}
            {full ? <p className="mt-1 text-[12px] text-warm">已经 6 张了，加不下了。</p> : null}
            {message ? <p className="mt-1 text-[13px] text-danger">{message}</p> : null}
          </div>
        ) : null}
      </div>

      {asking ? (
        <Dialog
          title={archived ? '恢复这条回忆？' : '归档这条回忆？'}
          onClose={() => setAsking(false)}
          footer={
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setAsking(false)}>
                取消
              </Button>
              <Button
                className="flex-1"
                disabled={setArchived.isPending}
                onClick={() =>
                  setArchived.mutate(
                    {
                      id: memory.id,
                      archived: !archived,
                      expectedVersion: memory.version,
                      idempotencyKey: memoryKey(
                        `memory:${archived ? 'restore' : 'archive'}:${memory.id}`,
                      ),
                    },
                    {
                      onSuccess: () => {
                        setAsking(false);
                        onArchived();
                        pushToast(archived ? '已经恢复回来了' : '已归档，照片和记录都留着');
                      },
                    },
                  )
                }
              >
                {archived ? '恢复' : '确认归档'}
              </Button>
            </div>
          }
        >
          <p className="text-[13px] text-ink-soft">
            {archived
              ? '恢复之后它会回到「珍藏中」。'
              : '归档只是收起来，照片和记录都保留，之后能在「已归档」里找回来。'}
          </p>
        </Dialog>
      ) : null}
    </Dialog>
  );
}
