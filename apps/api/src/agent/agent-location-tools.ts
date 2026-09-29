import type { EntityManager } from 'typeorm';
import { StorageLocation } from '../entities';
import { findItemLocations, readLocationContents } from '../locations/location-find';
import { placeTree, subtreeIds } from '../locations/location-tree';

// I3 小管家只读工具：find_item / list_location_contents（item-location-plan §3 I3）。
// 口径是「上次放在 …」：位置是家里人上次记下的，不是清点结果，回答不能说成「在 …」。
// 直接用 locations 的纯函数读库，不经过 LocationsService（重构期约束：不 import 别的域的 Service）。

const PHRASING = '回答时一律说「上次放在 …」，不要说「在 …」「就在 …」：位置是家里人上次记下的，可能已经挪过';

async function placed(manager: EntityManager, householdId: string) {
  return placeTree(await manager.getRepository(StorageLocation).find({ where: { householdId } }));
}

export async function findItemTool(manager: EntityManager, householdId: string, input: Record<string, unknown>) {
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 40) : '';
  if (!name) return { error: 'name_required', message: '缺少要找的东西的名字' };
  const hits = await findItemLocations(manager, householdId, name, await placed(manager, householdId));
  return {
    query: name,
    answerStyle: PHRASING,
    found: hits.length,
    items: hits.map((hit) => ({
      name: hit.name,
      type: hit.type === 'asset' ? '资产' : hit.type === 'batch' ? '一批库存' : '库存物品（平时放的地方）',
      lastPlacedAt: `上次放在 ${hit.pathLabel}`,
      pathLabel: hit.pathLabel,
      detail: hit.detail,
      lastStockedOn: hit.placedOn,
      targetPath: `/house/map?${new URLSearchParams({ focus: hit.locationId, q: hit.name })}`,
    })),
    note: hits.length ? null : '没有记过位置的同名东西；可以请家里人入库时选一下「放哪儿」',
    untrustedContent: true,
  };
}

export async function listLocationContentsTool(manager: EntityManager, householdId: string, input: Record<string, unknown>) {
  const wanted = typeof input.locationName === 'string' ? input.locationName.trim().slice(0, 80) : '';
  if (!wanted) return { error: 'location_name_required', message: '缺少位置名字（比如「客厅 / 电视柜」或「电视柜」）' };
  const tree = (await placed(manager, householdId)).filter((one) => !one.row.archivedAt);
  const normalized = wanted.replace(/\s*[/／]\s*/g, ' / ');
  const exact = tree.filter((one) => one.pathLabel === normalized || one.row.name === wanted);
  const matches = exact.length ? exact : tree.filter((one) => one.pathLabel.includes(wanted) || one.row.name.includes(wanted));
  if (!matches.length) {
    return { error: 'location_not_found', message: `没有叫「${wanted}」的位置`, candidates: tree.slice(0, 20).map((one) => one.pathLabel) };
  }
  if (matches.length > 1) {
    return {
      error: 'location_ambiguous',
      message: `有好几个位置叫「${wanted}」，请用户说是哪一个`,
      candidates: matches.slice(0, 10).map((one) => one.pathLabel),
    };
  }
  const [target] = matches;
  const rows = tree.map((one) => one.row);
  const ids = subtreeIds(rows, target.row.id);
  const pathOf = new Map(tree.map((one) => [one.row.id, one.pathLabel]));
  const contents = await readLocationContents(manager, householdId, ids);
  return {
    location: target.pathLabel,
    answerStyle: PHRASING,
    items: [
      ...contents.batches.map((one) => ({
        name: one.itemName,
        amount: `${Number(one.quantity)} ${one.unit}`,
        expiresOn: one.expiresOn,
        lastPlacedAt: `上次放在 ${pathOf.get(one.locationId) ?? target.pathLabel}`,
      })),
      ...contents.items.map((one) => ({
        name: one.name,
        amount: `${Number(one.quantity)} ${one.unit}`,
        expiresOn: null,
        lastPlacedAt: `平时放在 ${pathOf.get(one.locationId) ?? target.pathLabel}`,
      })),
      ...contents.assets.map((one) => ({
        name: one.name,
        amount: null,
        expiresOn: null,
        lastPlacedAt: `上次放在 ${pathOf.get(one.locationId) ?? target.pathLabel}`,
      })),
    ],
    targetPath: `/house/map?${new URLSearchParams({ focus: target.row.id })}`,
    untrustedContent: true,
  };
}
