import { STORAGE_LOCATION_MAX_DEPTH, type StorageLocationKind } from '@family/contracts';

// 位置树的纯函数（不碰库，item-location-plan §2.1）：排序、深度、路径文字、放在哪一层合不合法。

export interface TreeRow {
  id: string;
  parentId: string | null;
  kind: StorageLocationKind;
  name: string;
  sortOrder: number;
  archivedAt: Date | null;
}

export interface PlacedRow<T extends TreeRow> {
  row: T;
  depth: number;
  pathLabel: string;
}

export class LocationRuleError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 = 400,
  ) {
    super(message);
  }
}

const bySort = (a: TreeRow, b: TreeRow) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN');

/**
 * 先序平铺：父在子前、同层按 sortOrder 再按名字。路径用「 / 」连起来（「客厅 / 电视柜 / 第二层」）。
 * 父节点缺了（不该发生）的行当作根，不丢。
 */
export function placeTree<T extends TreeRow>(rows: T[]): PlacedRow<T>[] {
  const ids = new Set(rows.map((row) => row.id));
  const children = new Map<string | null, T[]>();
  for (const row of rows) {
    const key = row.parentId && ids.has(row.parentId) ? row.parentId : null;
    children.set(key, [...(children.get(key) ?? []), row]);
  }
  const out: PlacedRow<T>[] = [];
  const walk = (parentId: string | null, depth: number, prefix: string) => {
    for (const row of [...(children.get(parentId) ?? [])].sort(bySort)) {
      const pathLabel = prefix ? `${prefix} / ${row.name}` : row.name;
      out.push({ row, depth, pathLabel });
      walk(row.id, depth + 1, pathLabel);
    }
  };
  walk(null, 1, '');
  return out;
}

/** 这个节点往下还有几层（叶子为 1）。 */
export function subtreeHeight(rows: TreeRow[], id: string): number {
  const kids = rows.filter((row) => row.parentId === id);
  return 1 + Math.max(0, ...kids.map((kid) => subtreeHeight(rows, kid.id)));
}

/** 这个节点和它下面所有节点的 id。 */
export function subtreeIds(rows: TreeRow[], id: string): string[] {
  return [id, ...rows.filter((row) => row.parentId === id).flatMap((row) => subtreeIds(rows, row.id))];
}

/**
 * 放到 parent 下时用什么 kind：没给就按层级推（房间下 zone，柜子下 slot）；给了要和层级对得上——
 * 根只能是 room；第二层是 zone / container；第三层只能是 slot，且只能放在 container 下。
 */
export function kindFor(parent: { kind: StorageLocationKind; depth: number } | null, requested?: StorageLocationKind) {
  if (!parent) {
    if (requested && requested !== 'room') throw new LocationRuleError('最上面一层只能是房间');
    return 'room' as const;
  }
  if (parent.depth >= STORAGE_LOCATION_MAX_DEPTH) {
    throw new LocationRuleError(`位置最多 ${STORAGE_LOCATION_MAX_DEPTH} 层（房间 → 柜子 → 层格）`);
  }
  const kind = requested ?? (parent.kind === 'container' ? 'slot' : 'zone');
  if (kind === 'room') throw new LocationRuleError('房间只能在最上面一层');
  if (parent.depth === 1 && kind === 'slot') throw new LocationRuleError('层格要放在柜子下面');
  if (parent.depth === 2 && (kind !== 'slot' || parent.kind !== 'container')) {
    throw new LocationRuleError('第三层只能是柜子里的层格');
  }
  return kind;
}
