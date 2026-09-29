import { useState } from 'react';
import { useLocations } from '../lib/queries';
import { LocationPicker } from './location-picker';

/** 位置 id → 「客厅 / 电视柜 / 第二层」（服务端拼好的，含归档的）。没有返回 null。 */
export function useLocationPath() {
  const locations = useLocations(true);
  const paths = new Map((locations.data ?? []).map((one) => [one.id, one.pathLabel]));
  return (id: string | null | undefined) => (id ? paths.get(id) ?? null : null);
}

/**
 * 表单里的一行「放哪儿」：永远可选，不填不拦（§4）。点开是位置选择器。
 */
export function LocationField({
  label = '放哪儿',
  value,
  onChange,
}: {
  label?: string;
  value: string | null;
  onChange: (locationId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const pathOf = useLocationPath();
  const path = pathOf(value);
  return (
    <div>
      <span className="mb-1 block text-[12px] text-ink-soft">{label}（可不填）</span>
      <button
        type="button"
        aria-label={`${label}：${path ?? '选个位置'}`}
        onClick={() => setOpen(true)}
        className="flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 text-left text-[14px] transition-colors duration-150 hover:bg-muted"
      >
        <span className={`min-w-0 truncate ${path ? '' : 'text-ink-soft'}`}>{path ?? '选个位置'}</span>
        <span aria-hidden="true" className="text-ink-soft">›</span>
      </button>
      {open ? (
        <LocationPicker
          value={value}
          onClose={() => setOpen(false)}
          onPick={(location) => {
            onChange(location?.id ?? null);
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * 列表行里的「上次放在 …」：点一下直接开选择器改，不进编辑页（§4：改位置永远一跳）。
 * 没有位置时什么都不显示——除非给了 emptyLabel（按位置分组里「没记位置」那一组要能一跳记上）。
 */
export function LocationLine({
  locationId,
  name,
  onChange,
  pending = false,
  emptyLabel,
}: {
  locationId: string | null;
  /** 东西的名字，给读屏用 */
  name: string;
  onChange: (locationId: string | null) => void;
  pending?: boolean;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const pathOf = useLocationPath();
  const path = pathOf(locationId);
  if (!path && !emptyLabel) return null;
  return (
    <>
      <button
        type="button"
        data-location-line={locationId ?? ''}
        aria-label={path ? `改${name}的位置，上次放在${path}` : `记一下${name}放哪儿`}
        disabled={pending}
        onClick={() => setOpen(true)}
        className="mt-0.5 block max-w-full truncate rounded text-left text-[11.5px] text-accent hover:underline disabled:opacity-50"
      >
        {path ? `上次放在 ${path}` : emptyLabel}
      </button>
      {open ? (
        <LocationPicker
          value={locationId}
          title={`${name}放哪儿？`}
          onClose={() => setOpen(false)}
          onPick={(location) => {
            onChange(location?.id ?? null);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
