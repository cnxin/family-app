import { useId, useMemo, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { AgentProviderModels } from '@family/contracts';
import { api } from '../lib/api';
import { Button, Input } from './ui';

/**
 * 云端模型名（J4.7）：可输入的下拉。输入框永远可以手填；「获取列表」用已保存的地址和 key 拉服务商的模型列表，
 * 拉到了就在输入框下面列出来、按输入的子串过滤；选中一个 = 改了模型名（onPick 里保存，服务端会清掉「测一下」的结果）。
 * 列表不存，每次现拉；换服务商时父组件换 key 让它从头来。
 */
export function ModelPicker({
  value,
  canFetch,
  disabled,
  trailing,
  onInput,
  onPick,
}: {
  value: string;
  /** 地址和 key 都已保存才能拉列表 */
  canFetch: boolean;
  disabled: boolean;
  /** 跟在按钮后面的东西（「保存模型」） */
  trailing?: ReactNode;
  onInput: (value: string) => void;
  onPick: (model: string) => void;
}) {
  const listId = useId();
  const [models, setModels] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // 刚拉到列表、刚点进输入框时列全部；开始打字才按子串筛（输入框里原来的模型名不该把别的藏起来）
  const [typing, setTyping] = useState(false);
  const fetchModels = useMutation({
    mutationFn: () => api<AgentProviderModels>('/agent/settings/provider-models', { method: 'POST' }),
  });
  const shown = useMemo(() => {
    const keyword = typing ? value.trim().toLowerCase() : '';
    return (models ?? []).filter((model) => !keyword || model.toLowerCase().includes(keyword));
  }, [models, value, typing]);
  const expanded = open && shown.length > 0;
  const failure =
    fetchModels.data && !fetchModels.data.ok
      ? fetchModels.data.message
      : fetchModels.error instanceof Error
        ? fetchModels.error.message
        : null;

  function load() {
    fetchModels.mutate(undefined, {
      onSuccess: (result) => {
        setModels(result.ok ? result.models : null);
        setOpen(result.ok && result.models.length > 0);
        setTyping(false);
        setActive(0);
      },
    });
  }

  function pick(model: string) {
    setOpen(false);
    navigator.vibrate?.(10);
    onPick(model);
  }

  return (
    <div className="flex flex-col gap-1">
      {/* 下拉跟整行一样宽（手机上输入框窄，模型名看不全） */}
      <div className="relative flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input
            value={value}
            role="combobox"
            aria-label="云端模型名"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-autocomplete="list"
            autoComplete="off"
            placeholder="模型名"
            onChange={(event) => {
              onInput(event.target.value);
              setOpen(Boolean(models));
              setTyping(true);
              setActive(0);
            }}
            onFocus={() => {
              setOpen(Boolean(models));
              setTyping(false);
            }}
            onBlur={() => setOpen(false)}
            onKeyDown={(event) => {
              if (!expanded) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const step = event.key === 'ArrowDown' ? 1 : -1;
                setActive((current) => (current + step + shown.length) % shown.length);
              } else if (event.key === 'Enter') {
                event.preventDefault();
                pick(shown[Math.min(active, shown.length - 1)]);
              } else if (event.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
          {expanded ? (
            <ul
              id={listId}
              role="listbox"
              aria-label="服务商的模型"
              className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface py-1 shadow-lg motion-safe:animate-[float-in_150ms_cubic-bezier(0,0,0.2,1)]"
            >
              {shown.map((model, index) => (
                <li
                  key={model}
                  role="option"
                  aria-selected={index === active}
                  className={
                    'cursor-pointer truncate px-3 py-2 text-[13px] transition-colors duration-100 ' +
                    (index === active ? 'bg-muted text-ink' : 'text-ink-soft')
                  }
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(model);
                  }}
                  onMouseEnter={() => setActive(index)}
                >
                  {model}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <Button
          variant="outline"
          className="h-10 shrink-0 whitespace-nowrap px-3 text-[13px]"
          disabled={!canFetch || disabled || fetchModels.isPending}
          title={canFetch ? undefined : '先保存地址和 key'}
          onClick={load}
        >
          {fetchModels.isPending ? '获取中…' : '获取列表'}
        </Button>
        {trailing}
      </div>
      {!canFetch ? (
        <p className="text-[12px] text-ink-soft">先保存地址和 key，才能获取模型列表</p>
      ) : failure ? (
        <p role="status" className="text-[12px] text-danger">{failure}</p>
      ) : models ? (
        <p className="text-[12px] text-ink-soft">服务商有 {models.length} 个模型，输入可以筛选，也可以直接手填</p>
      ) : null}
    </div>
  );
}
