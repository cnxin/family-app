import { useRef, useState } from 'react';
import type { Dish, DishCategory, RecipeDish } from '@family/contracts';
import { DISH_CATEGORIES } from '@family/contracts';
import { useCreateDish, useRemoveDish, useUpdateDish } from '../lib/queries';
import { uploadPhoto } from '../lib/api';
import { pushToast } from '../lib/toast';
import { Button, Dialog, Input } from './ui';

/**
 * 菜品本身的信息（旧客户端 dish-edit.tsx 的「基本信息」）：菜名、分类、难度、耗时、口味、照片、下架。
 * 做法（食材 / 步骤 / 参考链接）在 RecipeEditor 里，按版本编辑，两边分工和旧客户端一致。
 */
export function DishEditor({
  editing,
  onClose,
  onCreated,
}: {
  editing: RecipeDish | Dish | null;
  onClose: () => void;
  onCreated?: (dish: Dish) => void;
}) {
  const create = useCreateDish();
  const update = useUpdateDish();
  const remove = useRemoveDish();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(editing?.name ?? '');
  const [category, setCategory] = useState<DishCategory>(editing?.category ?? '荤菜');
  const [difficulty, setDifficulty] = useState(editing?.difficulty ?? 1);
  const [estMinutes, setEstMinutes] = useState(editing?.estMinutes ? String(editing.estMinutes) : '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [photoUrl, setPhotoUrl] = useState(editing?.photoUrl ?? '');
  const [uploading, setUploading] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const busy = create.isPending || update.isPending || remove.isPending || uploading;
  const valid = name.trim().length > 0 && !busy;
  const label = 'mb-1 block text-[12px] text-ink-soft';

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      setPhotoUrl(await uploadPhoto(file));
    } catch {
      pushToast('照片没传上去，再试一次');
    } finally {
      setUploading(false);
    }
  }

  function submit() {
    if (!valid) return;
    const minutes = Number.parseInt(estMinutes, 10);
    const body = {
      name: name.trim(),
      category,
      difficulty,
      estMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : undefined,
      note: note.trim(),
      photoUrl: photoUrl || undefined,
    };
    if (editing) {
      update.mutate(
        { id: editing.id, body },
        {
          onSuccess: () => {
            pushToast('菜品已更新');
            onClose();
          },
        },
      );
    } else {
      create.mutate(body, {
        onSuccess: (dish) => {
          pushToast(`已新建「${dish.name}」`);
          onCreated?.(dish);
          onClose();
        },
      });
    }
  }

  return (
    <Dialog
      title={editing ? `编辑「${editing.name}」` : '新建菜品'}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          {editing ? (
            confirmRemove ? (
              <Button
                variant="outline"
                className="text-danger"
                disabled={busy}
                onClick={() =>
                  remove.mutate(editing.id, {
                    onSuccess: () => {
                      pushToast(`「${editing.name}」已下架`);
                      onClose();
                    },
                  })
                }
              >
                确认下架
              </Button>
            ) : (
              <Button variant="ghost" className="text-ink-soft" onClick={() => setConfirmRemove(true)}>
                下架
              </Button>
            )
          ) : null}
          <Button className="flex-1" disabled={!valid} onClick={submit}>
            {busy ? '保存中…' : '保存'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className={label}>菜名</span>
          <Input
            autoFocus
            value={name}
            placeholder="比如：番茄炒蛋"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && submit()}
          />
        </label>

        <div>
          <span className={label}>分类</span>
          <div className="flex flex-wrap gap-1.5">
            {DISH_CATEGORIES.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={category === value}
                onClick={() => setCategory(value)}
                className={
                  'rounded-full border px-3 py-1 text-[13px] transition-colors duration-150 ' +
                  (category === value
                    ? 'border-accent bg-accent-soft font-medium text-accent'
                    : 'border-border text-ink-soft hover:bg-muted')
                }
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={label}>难度</span>
            <div className="flex gap-1" role="radiogroup" aria-label="难度">
              {[1, 2, 3].map((level) => (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={difficulty === level}
                  aria-label={`难度 ${level}`}
                  onClick={() => setDifficulty(level)}
                  className={
                    'text-[20px] transition-opacity duration-150 ' +
                    (level <= difficulty ? 'opacity-100' : 'opacity-25 hover:opacity-60')
                  }
                >
                  🌶️
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className={label}>预计耗时（分钟）</span>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={estMinutes}
              placeholder="30"
              onChange={(event) => setEstMinutes(event.target.value)}
            />
          </label>
        </div>

        <label className="block">
          <span className={label}>口味特点（选填）</span>
          <Input
            value={note}
            placeholder="比如：酸甜、微辣"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        <div>
          <span className={label}>照片（选填）</span>
          <div className="flex items-center gap-3">
            {photoUrl ? (
              <img src={photoUrl} alt="" className="size-16 rounded-lg object-cover" />
            ) : (
              <div className="grid size-16 place-items-center rounded-lg bg-muted text-2xl">🍽️</div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => void pickPhoto(event.target.files?.[0])}
            />
            <Button
              variant="outline"
              className="h-9 px-3 text-[13px]"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? '上传中…' : photoUrl ? '换一张' : '选照片'}
            </Button>
            {photoUrl ? (
              <Button variant="ghost" className="h-9 px-2 text-[13px]" onClick={() => setPhotoUrl('')}>
                去掉
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
