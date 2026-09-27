import { useState } from 'react';
import type { DishRecipeVariant, UpsertRecipeVariantBody } from '@family/contracts';
import { uploadPhoto } from '../lib/api';
import { useArchiveVariant, useUpsertVariant } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { Button, Input } from './ui';

interface IngredientForm {
  name: string;
  quantity: string;
  unit: string;
}
interface StepForm {
  text: string;
  imageUrl: string | null;
  uploading?: boolean;
}
interface LinkForm {
  title: string;
  url: string;
}

/** 参考链接常常是从别处复制的，缺协议头就补上，不让用户自己纠结。 */
function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function RecipeEditor({
  dishId,
  dishName,
  editing,
  onClose,
}: {
  dishId: string;
  dishName: string;
  editing: DishRecipeVariant | null;
  onClose: () => void;
}) {
  const upsert = useUpsertVariant();
  const archive = useArchiveVariant();

  const [name, setName] = useState(editing?.name ?? '我的做法');
  const [note, setNote] = useState(editing?.note ?? '');
  const [estMinutes, setEstMinutes] = useState(
    editing?.estMinutes ? String(editing.estMinutes) : '',
  );
  const [ingredients, setIngredients] = useState<IngredientForm[]>(
    editing?.ingredients.map((one) => ({
      name: one.ingredient.name,
      quantity: String(one.quantity),
      unit: one.unit,
    })) ?? [{ name: '', quantity: '', unit: '' }],
  );
  const [steps, setSteps] = useState<StepForm[]>(
    editing?.steps
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((one) => ({ text: one.text, imageUrl: one.imageUrl })) ?? [
      { text: '', imageUrl: null },
    ],
  );
  const [links, setLinks] = useState<LinkForm[]>(
    editing?.referenceLinks.map((one) => ({ title: one.title ?? '', url: one.url })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);

  async function pickPhoto(index: number, file: File) {
    setSteps((current) =>
      current.map((step, i) => (i === index ? { ...step, uploading: true } : step)),
    );
    try {
      const url = await uploadPhoto(file);
      setSteps((current) =>
        current.map((step, i) => (i === index ? { ...step, imageUrl: url, uploading: false } : step)),
      );
    } catch {
      setSteps((current) =>
        current.map((step, i) => (i === index ? { ...step, uploading: false } : step)),
      );
      pushToast('照片没传上去，换一张试试');
    }
  }

  function save() {
    if (!name.trim()) {
      setError('请填写做法名称');
      return;
    }
    const body: UpsertRecipeVariantBody = {
      name: name.trim(),
      note: note.trim() || null,
      estMinutes: estMinutes ? Number(estMinutes) : null,
      ingredients: ingredients
        .filter((one) => one.name.trim())
        .map((one) => ({
          name: one.name.trim(),
          quantity: Number(one.quantity) || 1,
          unit: one.unit.trim() || '份',
        })),
      steps: steps
        .filter((one) => one.text.trim() || one.imageUrl)
        .map((one) => ({ text: one.text.trim(), imageUrl: one.imageUrl })),
      referenceLinks: links
        .filter((one) => one.url.trim())
        .map((one) => ({ title: one.title.trim() || null, url: normalizeUrl(one.url) })),
    };
    upsert.mutate(
      { dishId, variantId: editing?.id, body },
      {
        onSuccess: () => {
          pushToast(editing ? '做法已更新' : `「${name.trim()}」已加进${dishName}`);
          onClose();
        },
      },
    );
  }

  const field = 'flex flex-col gap-1.5';
  const label = 'text-[12px] font-medium text-ink-soft';

  return (
    <div className="flex flex-col gap-5 border-t border-border bg-muted/40 px-4 py-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className={`${field} min-w-[180px] flex-1`}>
          <span className={label}>做法名称</span>
          <Input
            value={name}
            placeholder="例如：少油版"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className={`${field} w-[120px]`}>
          <span className={label}>大约用时</span>
          <Input
            inputMode="numeric"
            value={estMinutes}
            placeholder="分钟"
            onChange={(event) => setEstMinutes(event.target.value.replace(/\D/g, ''))}
          />
        </label>
      </div>

      <label className={field}>
        <span className={label}>这版的特点</span>
        <Input
          value={note}
          placeholder="火候、注意事项，或者为什么这么做"
          onChange={(event) => setNote(event.target.value)}
        />
      </label>

      <div className="flex flex-col gap-2">
        <span className={label}>食材</span>
        {ingredients.map((one, index) => (
          <div key={index} className="flex gap-2">
            <Input
              className="flex-1"
              value={one.name}
              placeholder="食材"
              onChange={(event) =>
                setIngredients((current) =>
                  current.map((item, i) =>
                    i === index ? { ...item, name: event.target.value } : item,
                  ),
                )
              }
            />
            <Input
              className="w-20"
              inputMode="decimal"
              value={one.quantity}
              placeholder="数量"
              onChange={(event) =>
                setIngredients((current) =>
                  current.map((item, i) =>
                    i === index ? { ...item, quantity: event.target.value } : item,
                  ),
                )
              }
            />
            <Input
              className="w-20"
              value={one.unit}
              placeholder="单位"
              onChange={(event) =>
                setIngredients((current) =>
                  current.map((item, i) =>
                    i === index ? { ...item, unit: event.target.value } : item,
                  ),
                )
              }
            />
            <Button
              variant="ghost"
              aria-label="删掉这行食材"
              className="h-10 shrink-0 px-2 text-[13px]"
              onClick={() => setIngredients((current) => current.filter((_, i) => i !== index))}
            >
              ✕
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          className="h-9 self-start px-3 text-[13px]"
          onClick={() =>
            setIngredients((current) => [...current, { name: '', quantity: '', unit: '' }])
          }
        >
          加一样食材
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <span className={label}>图文步骤</span>
        {steps.map((step, index) => (
          <div key={index} className="flex gap-3">
            <span className="mt-2 grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1 flex-col gap-2">
              <Input
                value={step.text}
                placeholder="写下关键动作、火候和时间"
                onChange={(event) =>
                  setSteps((current) =>
                    current.map((one, i) =>
                      i === index ? { ...one, text: event.target.value } : one,
                    ),
                  )
                }
              />
              <div className="mt-2 flex items-center gap-2">
                {step.imageUrl ? (
                  <img
                    src={step.imageUrl}
                    alt=""
                    className="h-16 w-24 rounded-lg border border-border object-cover"
                  />
                ) : null}
                <label className="cursor-pointer rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink-soft hover:bg-muted">
                  {step.uploading ? '上传中…' : step.imageUrl ? '换张图' : '配张图'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void pickPhoto(index, file);
                      event.target.value = '';
                    }}
                  />
                </label>
                <Button
                  variant="ghost"
                  className="h-9 px-2 text-[13px]"
                  onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}
                >
                  删掉这步
                </Button>
              </div>
            </div>
          </div>
        ))}
        <Button
          variant="outline"
          className="h-9 self-start px-3 text-[13px]"
          onClick={() => setSteps((current) => [...current, { text: '', imageUrl: null }])}
        >
          加一步
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <span className={label}>参考链接</span>
        {links.map((link, index) => (
          <div key={index} className="flex gap-2">
            <Input
              className="w-32"
              value={link.title}
              placeholder="标题（可选）"
              onChange={(event) =>
                setLinks((current) =>
                  current.map((one, i) =>
                    i === index ? { ...one, title: event.target.value } : one,
                  ),
                )
              }
            />
            <Input
              className="flex-1"
              value={link.url}
              placeholder="粘贴链接"
              onChange={(event) =>
                setLinks((current) =>
                  current.map((one, i) => (i === index ? { ...one, url: event.target.value } : one)),
                )
              }
            />
            <Button
              variant="ghost"
              aria-label="删掉这条链接"
              className="h-10 shrink-0 px-2 text-[13px]"
              onClick={() => setLinks((current) => current.filter((_, i) => i !== index))}
            >
              ✕
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          className="h-9 self-start px-3 text-[13px]"
          onClick={() => setLinks((current) => [...current, { title: '', url: '' }])}
        >
          加个链接
        </Button>
      </div>

      {error ? <p className="text-[13px] text-danger">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button className="h-10 px-5" disabled={upsert.isPending} onClick={save}>
          {upsert.isPending ? '保存中…' : '保存做法'}
        </Button>
        <Button variant="ghost" className="h-10 px-3" onClick={onClose}>
          取消
        </Button>
        {editing && !editing.isDefault ? (
          <Button
            variant="ghost"
            className="ml-auto h-10 px-3 text-[13px] text-danger"
            disabled={archive.isPending}
            onClick={() =>
              archive.mutate(editing.id, {
                onSuccess: () => {
                  pushToast('做法已归档');
                  onClose();
                },
              })
            }
          >
            归档这个做法
          </Button>
        ) : null}
      </div>
    </div>
  );
}
