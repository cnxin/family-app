import type { ItemLocationHit } from '@family/contracts';
import type { EntityManager } from 'typeorm';
import type { PlacedRow, TreeRow } from './location-tree';

// 「那个东西上次放在哪」：按名字找库存物品（默认位置）、有余量的批次、资产，只要记了位置的（I2 地图搜索、I3 ⌘K / agent 共用）。
// 口径是「上次放在」：只报记下来的位置，不推断、不校验。

interface Row {
  type: ItemLocationHit['type'];
  id: string;
  inventoryItemId: string | null;
  name: string;
  quantity: string | null;
  unit: string | null;
  expiresOn: string | null;
  locationId: string;
  placedOn: string | null;
}

const LIMIT = 20;

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function detail(row: Row) {
  const parts: string[] = [];
  if (row.quantity !== null) parts.push(`${Number(row.quantity)} ${row.unit ?? ''}`.trim());
  if (row.expiresOn) parts.push(`到期 ${row.expiresOn}`);
  return parts.length ? parts.join(' · ') : null;
}

export async function findItemLocations<T extends TreeRow>(
  manager: EntityManager,
  householdId: string,
  q: string,
  placed: PlacedRow<T>[],
): Promise<ItemLocationHit[]> {
  const pattern = `%${escapeLike(q.trim())}%`;
  const rows: Row[] = await manager.query(
    `SELECT * FROM (
       SELECT 'batch' AS type, b.id, i.id AS "inventoryItemId", i.name, b.quantity::text AS quantity, i.unit,
              b."expiresOn"::text AS "expiresOn", b."locationId", b."receivedOn"::text AS "placedOn"
         FROM inventory_batches b JOIN inventory_items i ON i.id = b."inventoryItemId"
        WHERE b."householdId" = $1 AND b."locationId" IS NOT NULL AND b.quantity > 0 AND i.name ILIKE $2
       UNION ALL
       SELECT 'item', i.id, i.id, i.name, i.quantity::text, i.unit, NULL, i."defaultLocationId",
              (SELECT max(r."receivedOn")::text FROM inventory_batches r WHERE r."inventoryItemId" = i.id)
         FROM inventory_items i
        WHERE i."householdId" = $1 AND i."defaultLocationId" IS NOT NULL AND i.name ILIKE $2
       UNION ALL
       SELECT 'asset', a.id, NULL, a.name, NULL, NULL, NULL, a."locationId", NULL
         FROM home_assets a
        WHERE a."householdId" = $1 AND a."locationId" IS NOT NULL AND a.name ILIKE $2
     ) hits
     ORDER BY length(name), name, CASE type WHEN 'batch' THEN 0 WHEN 'item' THEN 1 ELSE 2 END, "placedOn" DESC NULLS LAST
     LIMIT ${LIMIT * 3}`,
    [householdId, pattern],
  );
  const byId = new Map(placed.map((one) => [one.row.id, one]));
  const roomOf = (id: string) => {
    let current = byId.get(id);
    while (current?.row.parentId && byId.has(current.row.parentId)) current = byId.get(current.row.parentId);
    return current?.row.id ?? id;
  };
  const hits: ItemLocationHit[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const location = byId.get(row.locationId);
    if (!location) continue;
    // 物品有批次记在同一个位置时，只留批次那条（更具体：带数量和到期）
    const key = `${row.inventoryItemId ?? row.id}:${row.locationId}`;
    if (row.type === 'item' && seen.has(key)) continue;
    if (row.type !== 'asset') seen.add(key);
    hits.push({
      type: row.type,
      id: row.id,
      inventoryItemId: row.inventoryItemId,
      name: row.name,
      detail: detail(row),
      locationId: row.locationId,
      pathLabel: location.pathLabel,
      roomId: roomOf(row.locationId),
      placedOn: row.placedOn,
    });
    if (hits.length >= LIMIT) break;
  }
  return hits;
}
