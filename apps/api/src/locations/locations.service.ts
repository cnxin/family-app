import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import {
  UNSORTED_LOCATION_NAME,
  type CreateStorageLocationBody,
  type ItemLocationHit,
  type MapShape,
  type SetLocationShapeBody,
  type StorageLocation as StorageLocationView,
  type StorageLocationContents,
  type StorageLocationKind,
  type UpdateStorageLocationBody,
} from '@family/contracts';
import { isHouseholdManager, isUniqueViolation } from '@family/shared';
import { JwtUser } from '../auth/jwt.guard';
import { HouseholdMap, StorageLocation } from '../entities';
import { findItemLocations, readLocationContents } from './location-find';
import { shapeProblem } from './map-shape';
import { LocationRuleError, kindFor, placeTree, subtreeHeight, subtreeIds, type PlacedRow } from './location-tree';

const NAME_TAKEN = (name: string) => new ConflictException(`这一层已经有「${name}」了`);

function ruleError(error: unknown): never {
  if (error instanceof LocationRuleError) {
    throw error.status === 409 ? new ConflictException(error.message) : new BadRequestException(error.message);
  }
  throw error;
}

/**
 * I1 位置字典（item-location-plan §2.1、§2.4）。看、搜、新建全家都能；改、归档、删只有管理员。
 * 家人新建的一律挂在系统节点「未整理」下（没有就现建），由管理员事后归位（§6 第 4 条）。
 */
@Injectable()
export class LocationsService {
  constructor(private readonly dataSource: DataSource) {}

  async list(householdId: string, includeArchived = false): Promise<StorageLocationView[]> {
    const rows = await this.rows(this.dataSource.manager, householdId);
    const counts = await this.counts(householdId);
    return placeTree(rows)
      .filter((placed) => includeArchived || !placed.row.archivedAt)
      .map((placed) => this.present(placed, counts));
  }

  async search(householdId: string, q: string) {
    const needle = q.trim().toLowerCase();
    return placeTree(await this.rows(this.dataSource.manager, householdId))
      .filter((placed) => !placed.row.archivedAt && placed.row.name.toLowerCase().includes(needle))
      .slice(0, 20)
      .map(({ row, pathLabel }) => ({ id: row.id, name: row.name, kind: row.kind, pathLabel }));
  }

  /** 「那个东西上次放在哪」：地图搜索、⌘K、agent 共用（location-find.ts） */
  async find(householdId: string, q: string): Promise<ItemLocationHit[]> {
    const manager = this.dataSource.manager;
    return findItemLocations(manager, householdId, q, placeTree(await this.rows(manager, householdId)));
  }

  /** 地图编辑器改形状（I2）。null = 从地图上拿掉；画上去之前家里得先有地图。 */
  async setShape(id: string, body: SetLocationShapeBody, user: JwtUser): Promise<StorageLocationView> {
    this.assertManager(user);
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(StorageLocation);
      const row = await repo.findOne({ where: { id, householdId: user.householdId }, lock: { mode: 'pessimistic_write' } });
      if (!row) throw new NotFoundException('位置不存在');
      if (row.archivedAt) throw new BadRequestException('这个位置已经归档了');
      if (body.mapShape) {
        const map = await manager.getRepository(HouseholdMap).findOne({ where: { householdId: user.householdId, isActive: true } });
        if (!map) throw new BadRequestException('先导入家庭地图');
        const parent = row.parentId ? await repo.findOne({ where: { id: row.parentId, householdId: user.householdId } }) : null;
        const problem = shapeProblem(
          body.mapShape,
          { w: 1000, h: map.viewBoxHeight },
          row.kind,
          (parent?.mapShape as MapShape | null | undefined) ?? null,
        );
        if (problem) throw new BadRequestException(problem);
      }
      row.mapShape = body.mapShape;
      await repo.save(row);
    });
    return this.one(user.householdId, id);
  }

  async create(body: CreateStorageLocationBody, user: JwtUser): Promise<StorageLocationView> {
    try {
      const id = await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(StorageLocation);
        let parentId: string | null;
        let kind: StorageLocationKind;
        if (isHouseholdManager(user)) {
          const placed = placeTree(await this.rows(manager, user.householdId));
          const parent = body.parentId ? placed.find((one) => one.row.id === body.parentId) : null;
          if (body.parentId && !parent) throw new NotFoundException('上级位置不存在');
          if (parent?.row.archivedAt) throw new BadRequestException('上级位置已经归档了');
          kind = kindFor(parent ? { kind: parent.row.kind, depth: parent.depth } : null, body.kind);
          parentId = parent?.row.id ?? null;
        } else {
          // 家人：只能建叶子，挂在「未整理」下，默认 zone（§4：不会把树建乱）
          parentId = (await this.ensureUnsorted(manager, user.householdId)).id;
          kind = 'zone';
        }
        const saved = await repo.save(
          repo.create({
            householdId: user.householdId,
            parentId,
            kind,
            name: body.name,
            icon: body.icon ?? null,
            note: body.note ?? null,
            sortOrder: await this.nextSort(manager, user.householdId, parentId),
            mapShape: null,
            systemKey: null,
            archivedAt: null,
          }),
        );
        return saved.id;
      });
      return this.one(user.householdId, id);
    } catch (error) {
      if (isUniqueViolation(error)) throw NAME_TAKEN(body.name);
      return ruleError(error);
    }
  }

  async update(id: string, body: UpdateStorageLocationBody, user: JwtUser): Promise<StorageLocationView> {
    this.assertManager(user);
    try {
      await this.dataSource.transaction(async (manager) => {
        const rows = await this.rows(manager, user.householdId, true);
        const row = rows.find((one) => one.id === id);
        if (!row) throw new NotFoundException('位置不存在');
        const moving = body.parentId !== undefined && (body.parentId ?? null) !== row.parentId;
        if (row.systemKey && (moving || body.name !== undefined || body.kind !== undefined)) {
          throw new BadRequestException(`「${UNSORTED_LOCATION_NAME}」是系统位置，只能调顺序`);
        }
        if (moving || body.kind !== undefined) this.replace(rows, row, body.parentId === undefined ? row.parentId : body.parentId ?? null, body.kind);
        if (body.name !== undefined) row.name = body.name;
        if (body.icon !== undefined) row.icon = body.icon ?? null;
        if (body.note !== undefined) row.note = body.note ?? null;
        if (body.sortOrder !== undefined) row.sortOrder = body.sortOrder;
        await manager.getRepository(StorageLocation).save(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw NAME_TAKEN(body.name ?? '同名位置');
      ruleError(error);
    }
    return this.one(user.householdId, id);
  }

  /** 归档这个位置和它下面所有的；东西的记录保留（「上次放在」照样显示），选择器里不再出现。 */
  async archive(id: string, user: JwtUser): Promise<StorageLocationView> {
    this.assertManager(user);
    await this.dataSource.transaction(async (manager) => {
      const rows = await this.rows(manager, user.householdId, true);
      const row = rows.find((one) => one.id === id);
      if (!row) throw new NotFoundException('位置不存在');
      if (row.systemKey) throw new BadRequestException(`「${UNSORTED_LOCATION_NAME}」是系统位置，不能归档`);
      const ids = subtreeIds(rows, id).filter((one) => !rows.find((r) => r.id === one)?.archivedAt);
      if (ids.length) {
        await manager.getRepository(StorageLocation).update(ids, { archivedAt: new Date() });
      }
    });
    return this.one(user.householdId, id);
  }

  /** 真删：只给建错了、从没用过的位置。有子位置或有东西记在这儿就 409，只能归档。 */
  async remove(id: string, user: JwtUser) {
    this.assertManager(user);
    await this.dataSource.transaction(async (manager) => {
      const row = await manager.getRepository(StorageLocation).findOne({ where: { id, householdId: user.householdId } });
      if (!row) throw new NotFoundException('位置不存在');
      if (row.systemKey) throw new BadRequestException(`「${UNSORTED_LOCATION_NAME}」是系统位置，不能删`);
      if (await manager.getRepository(StorageLocation).exists({ where: { parentId: id } })) {
        throw new ConflictException('下面还有位置，先挪走或归档');
      }
      const [{ used }]: { used: boolean }[] = await manager.query(
        `SELECT EXISTS (SELECT 1 FROM inventory_items WHERE "defaultLocationId" = $1)
             OR EXISTS (SELECT 1 FROM inventory_batches WHERE "locationId" = $1)
             OR EXISTS (SELECT 1 FROM home_assets WHERE "locationId" = $1) AS used`,
        [id],
      );
      if (used) throw new ConflictException('有东西记在这个位置，不能删，只能归档');
      await manager.getRepository(StorageLocation).delete({ id, householdId: user.householdId });
    });
    return { id, removed: true as const };
  }

  async contents(id: string, householdId: string): Promise<StorageLocationContents> {
    const location = await this.one(householdId, id, true);
    const ids = subtreeIds(await this.rows(this.dataSource.manager, householdId), id);
    const { items, batches, assets } = await readLocationContents(this.dataSource.manager, householdId, ids);
    return { location, items, batches, assets };
  }

  // ---- 内部 ----------------------------------------------------------------

  private assertManager(user: JwtUser) {
    if (!isHouseholdManager(user)) throw new ForbiddenException('位置由管理员整理；你可以在选择器里新建');
  }

  /** 在内存里把 row 挪到 parentId 下（换 kind），整棵树重新校验一遍；不合法就抛 LocationRuleError。 */
  private replace(rows: StorageLocation[], row: StorageLocation, parentId: string | null, requested?: StorageLocationKind) {
    if (parentId && subtreeIds(rows, row.id).includes(parentId)) throw new LocationRuleError('不能挪到自己下面');
    const placed = placeTree(rows.filter((one) => !subtreeIds(rows, row.id).includes(one.id)));
    const parent = parentId ? placed.find((one) => one.row.id === parentId) : null;
    if (parentId && !parent) throw new NotFoundException('上级位置不存在');
    if (parent?.row.archivedAt) throw new LocationRuleError('上级位置已经归档了');
    const depth = (parent?.depth ?? 0) + 1;
    if (depth + subtreeHeight(rows, row.id) - 1 > 3) throw new LocationRuleError('挪过去会超过 3 层（房间 → 柜子 → 层格）');
    const hasChildren = rows.some((one) => one.parentId === row.id);
    const fallback: StorageLocationKind | undefined =
      depth === 2 && (row.kind === 'room' || row.kind === 'slot') ? (hasChildren ? 'container' : 'zone') : depth === 2 ? row.kind : undefined;
    row.kind = kindFor(parent ? { kind: parent.row.kind, depth: parent.depth } : null, requested ?? fallback);
    row.parentId = parentId;
    // 挪完之后子节点的 kind 也要对得上（层格只能在柜子下）
    for (const child of rows.filter((one) => one.parentId === row.id)) {
      kindFor({ kind: row.kind, depth }, child.kind);
      for (const grandchild of rows.filter((one) => one.parentId === child.id)) kindFor({ kind: child.kind, depth: depth + 1 }, grandchild.kind);
    }
  }

  private async ensureUnsorted(manager: EntityManager, householdId: string) {
    const repo = manager.getRepository(StorageLocation);
    const existing = await repo.findOne({ where: { householdId, systemKey: 'unsorted' } });
    if (existing) return existing;
    // 管理员自己建过一个叫「未整理」的房间：就用它
    const named = await repo.findOne({ where: { householdId, parentId: IsNull(), name: UNSORTED_LOCATION_NAME, archivedAt: IsNull() } });
    if (named) {
      named.systemKey = 'unsorted';
      return repo.save(named);
    }
    return repo.save(
      repo.create({
        householdId,
        parentId: null,
        kind: 'room',
        name: UNSORTED_LOCATION_NAME,
        icon: null,
        note: null,
        sortOrder: 9999,
        mapShape: null,
        systemKey: 'unsorted',
        archivedAt: null,
      }),
    );
  }

  private async nextSort(manager: EntityManager, householdId: string, parentId: string | null) {
    const [{ next }]: { next: number }[] = await manager.query(
      `SELECT COALESCE(MAX("sortOrder") FILTER (WHERE "systemKey" IS NULL), -1) + 1 AS next
         FROM storage_locations WHERE "householdId" = $1 AND "parentId" IS NOT DISTINCT FROM $2`,
      [householdId, parentId],
    );
    return Math.min(Number(next), 9998);
  }

  private rows(manager: EntityManager, householdId: string, lock = false) {
    const query = manager
      .getRepository(StorageLocation)
      .createQueryBuilder('location')
      .where('location.householdId = :householdId', { householdId });
    return (lock ? query.setLock('pessimistic_write') : query).getMany();
  }

  /** 每个位置直接放着几样：库存物品（默认位置）、有余量的批次、资产。 */
  private async counts(householdId: string) {
    const rows: { id: string; n: number }[] = await this.dataSource.query(
      `SELECT id, SUM(n)::int AS n FROM (
         SELECT "defaultLocationId" AS id, count(*) AS n FROM inventory_items
          WHERE "householdId" = $1 AND "defaultLocationId" IS NOT NULL GROUP BY 1
         UNION ALL SELECT "locationId", count(*) FROM inventory_batches
          WHERE "householdId" = $1 AND "locationId" IS NOT NULL AND quantity > 0 GROUP BY 1
         UNION ALL SELECT "locationId", count(*) FROM home_assets
          WHERE "householdId" = $1 AND "locationId" IS NOT NULL GROUP BY 1
       ) t GROUP BY id`,
      [householdId],
    );
    return new Map(rows.map((row) => [row.id, Number(row.n)]));
  }

  /** 一个位置（含归档的），拆分 / 合并回给客户端用 */
  detail(householdId: string, id: string) {
    return this.one(householdId, id);
  }

  private async one(householdId: string, id: string, includeArchived = true) {
    const found = (await this.list(householdId, includeArchived)).find((one) => one.id === id);
    if (!found) throw new NotFoundException('位置不存在');
    return found;
  }

  private present({ row, depth, pathLabel }: PlacedRow<StorageLocation>, counts: Map<string, number>): StorageLocationView {
    return {
      id: row.id,
      parentId: row.parentId,
      kind: row.kind,
      name: row.name,
      icon: row.icon,
      sortOrder: row.sortOrder,
      note: row.note,
      mapShape: row.kind === 'slot' ? null : ((row.mapShape as MapShape | null) ?? null),
      systemKey: row.systemKey,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      depth,
      pathLabel,
      itemCount: counts.get(row.id) ?? 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
