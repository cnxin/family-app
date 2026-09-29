import { useHouseholdMap } from '../../lib/queries';
import { SoftLink } from '../soft-link';

/**
 * 「在地图上看」（I3）：库存编辑、资产详情里，记了位置且家里有地图时出现；
 * 跳地图对准那个位置（?focus=），并把名字填进「找东西」高亮（?q=）。
 */
export function MapLink({ locationId, name, className = '' }: { locationId: string | null | undefined; name?: string; className?: string }) {
  const map = useHouseholdMap();
  if (!locationId || !map.data) return null;
  const query = new URLSearchParams({ focus: locationId, ...(name ? { q: name } : {}) });
  return (
    <SoftLink to={`/house/map?${query}`} className={'rounded text-[13px] text-accent hover:underline ' + className}>
      在地图上看 ›
    </SoftLink>
  );
}
