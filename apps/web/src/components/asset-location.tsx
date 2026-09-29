import { useState } from 'react';
import type { HomeAsset } from '@family/contracts';
import { useSetLocation } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { useLocationPath } from './location-field';
import { LocationPicker } from './location-picker';
import { MapLink } from './map/map-link';

/**
 * 资产详情头部的位置（item-location-plan §2.3）：有位置写「上次放在 …」，点了就改；
 * 只有旧的自由文本时照原样显示，旁边「整理到位置」——选好后旧文本清空；什么都没记给一个「记一下放哪儿」。
 */
export function AssetLocation({ asset }: { asset: HomeAsset }) {
  const [open, setOpen] = useState(false);
  const setLocation = useSetLocation();
  const pathOf = useLocationPath();
  const path = pathOf(asset.locationId);
  const link = 'rounded text-accent hover:underline disabled:opacity-50';
  return (
    <span data-asset-location className="inline-flex flex-wrap items-baseline gap-x-1.5">
      {path ? (
        <button type="button" className={link} disabled={setLocation.isPending} onClick={() => setOpen(true)} aria-label={`改${asset.name}的位置，上次放在${path}`}>
          上次放在 {path}
        </button>
      ) : asset.location ? (
        <>
          <span>{asset.location}</span>
          <button type="button" className={link} disabled={setLocation.isPending} onClick={() => setOpen(true)}>
            整理到位置
          </button>
        </>
      ) : (
        <button type="button" className={link} disabled={setLocation.isPending} onClick={() => setOpen(true)}>
          记一下放哪儿
        </button>
      )}
      {path ? <MapLink locationId={asset.locationId} name={asset.name} /> : null}
      {open ? (
        <LocationPicker
          value={asset.locationId}
          title={`${asset.name}放哪儿？`}
          onClose={() => setOpen(false)}
          onPick={(location) => {
            setOpen(false);
            setLocation.mutate(
              { target: 'asset', id: asset.id, locationId: location?.id ?? null },
              { onSuccess: () => pushToast(location ? `记下了：${location.pathLabel}` : '不记位置了'), onError: (error) => pushToast(error.message) },
            );
          }}
        />
      ) : null}
    </span>
  );
}
