import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import type {
  MapDecoration,
  MapShape,
  MergeLocationBody,
  MergeLocationResult,
  SplitLocationBody,
  SplitLocationResult,
} from '@family/contracts';
import { isHouseholdManager, isUniqueViolation, pointInShape, shapeBounds, type MapPoint } from '@family/shared';
import { JwtUser } from '../auth/jwt.guard';
import { HomeAsset, HouseholdMap, InventoryBatch, InventoryItem, StorageLocation } from '../entities';
import { LocationsService } from './locations.service';
import { shapeProblem } from './map-shape';

// 地图编辑器 v2 §2.3、§2.4：拆分 / 合并房间。都是一个事务做完，不进撤销栈，客户端先弹确认框写清后果（拍板 2）。
// 形状由客户端算（拆 = 按画的线切两块；合 = 两块栅格化求并），这里只校验形状本身合法。

const centreOf = (shape: MapShape): MapPoint => {
  const b = shapeBounds(shape);
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
};

/** 同一层不重名：「衣柜」→「衣柜 2」→「衣柜 3」 */
function freeName(name: string, taken: Set<string>) {
  if (!taken.has(name)) return name;
  for (let n = 2; n < 1000; n += 1) {
    const next = `${name} ${n}`.slice(0, 40);
    if (!taken.has(next)) return next;
  }
  return `${name.slice(0, 30)} ${Date.now() % 100000}`;
}

@Injectable()
export class RoomRestructureService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly locations: LocationsService,
  ) {}

  async split(id: string, body: SplitLocationBody, user: JwtUser): Promise<SplitLocationResult> {
    this.assertManager(user);
    try {
      const { createdId, movedLocations } = await this.dataSource.transaction(async (manager) => {
        const { map, room } = await this.room(manager, user.householdId, id);
        for (const shape of [body.shape, body.newRoom.shape]) {
          const problem = shapeProblem(shape, { w: 1000, h: map.viewBoxHeight }, 'room', null);
          if (problem) throw new BadRequestException(problem);
        }
        const repo = manager.getRepository(StorageLocation);
        const [{ next }]: { next: number }[] = await manager.query(
          `SELECT COALESCE(MAX("sortOrder") FILTER (WHERE "systemKey" IS NULL), -1) + 1 AS next
             FROM storage_locations WHERE "householdId" = $1 AND "parentId" IS NULL`,
          [user.householdId],
        );
        const created = await repo.save(
          repo.create({
            householdId: user.householdId,
            parentId: null,
            kind: 'room',
            name: body.newRoom.name,
            icon: null,
            note: null,
            sortOrder: Math.min(Number(next), 9998),
            mapShape: body.newRoom.shape,
            systemKey: null,
            archivedAt: null,
          }),
        );
        // 画在图上的柜子 / 区域：中心点落在新块里就跟过去（新房间是空的，不会重名）
        const children = await repo.find({ where: { householdId: user.householdId, parentId: room.id } });
        const moving = children.filter((one) => !one.archivedAt && one.mapShape && pointInShape(centreOf(one.mapShape as MapShape), body.newRoom.shape));
        if (moving.length) await repo.update({ id: In(moving.map((one) => one.id)) }, { parentId: created.id });
        room.mapShape = body.shape;
        await repo.save(room);
        this.moveDecorations(map, (one) => one.roomId === room.id && pointInShape(centreOf({ type: 'rect', x: one.x, y: one.y, w: one.w, h: one.h }), body.newRoom.shape), created.id);
        await manager.getRepository(HouseholdMap).save(map);
        return { createdId: created.id, movedLocations: moving.length };
      });
      return {
        room: await this.locations.detail(user.householdId, id),
        created: await this.locations.detail(user.householdId, createdId),
        movedLocations,
      };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(`已经有叫「${body.newRoom.name}」的房间了，换个名字`);
      throw error;
    }
  }

  async merge(id: string, body: MergeLocationBody, user: JwtUser): Promise<MergeLocationResult> {
    this.assertManager(user);
    if (body.intoId === id) throw new BadRequestException('不能并进自己');
    const moved = await this.dataSource.transaction(async (manager) => {
      const { map, room: source } = await this.room(manager, user.householdId, id);
      const { room: target } = await this.room(manager, user.householdId, body.intoId);
      const problem = shapeProblem(body.shape, { w: 1000, h: map.viewBoxHeight }, 'room', null);
      if (problem) throw new BadRequestException(problem);
      const repo = manager.getRepository(StorageLocation);

      // 子位置挪到目标下；和目标里已有的重名就加「 2」
      const targetChildren = await repo.find({ where: { householdId: user.householdId, parentId: target.id } });
      const taken = new Set(targetChildren.filter((one) => !one.archivedAt).map((one) => one.name));
      const children = (await repo.find({ where: { householdId: user.householdId, parentId: source.id } })).filter((one) => !one.archivedAt);
      for (const child of children) {
        child.name = freeName(child.name, taken);
        taken.add(child.name);
        child.parentId = target.id;
      }
      await repo.save(children);

      const where = { householdId: user.householdId };
      const items = await manager.getRepository(InventoryItem).update({ ...where, defaultLocationId: source.id }, { defaultLocationId: target.id });
      const batches = await manager.getRepository(InventoryBatch).update({ ...where, locationId: source.id }, { locationId: target.id });
      const assets = await manager.getRepository(HomeAsset).update({ ...where, locationId: source.id }, { locationId: target.id });

      source.archivedAt = new Date();
      source.mapShape = null;
      target.mapShape = body.shape;
      await repo.save([source, target]);
      this.moveDecorations(map, (one) => one.roomId === source.id, target.id);
      await manager.getRepository(HouseholdMap).save(map);
      return { locations: children.length, items: items.affected ?? 0, batches: batches.affected ?? 0, assets: assets.affected ?? 0 };
    });
    return { room: await this.locations.detail(user.householdId, body.intoId), moved };
  }

  /** 拆 / 合的房间：本家的、没归档的、不是系统节点的顶层房间，而且家里有地图 */
  private async room(manager: EntityManager, householdId: string, id: string) {
    const room = await manager.getRepository(StorageLocation).findOne({ where: { id, householdId }, lock: { mode: 'pessimistic_write' } });
    if (!room) throw new NotFoundException('位置不存在');
    const map = await manager.getRepository(HouseholdMap).findOne({ where: { householdId, isActive: true }, lock: { mode: 'pessimistic_write' } });
    if (!map) throw new BadRequestException('先导入家庭地图');
    if (room.kind !== 'room') throw new BadRequestException('只有房间能拆分 / 合并');
    if (room.archivedAt) throw new BadRequestException('这个房间已经归档了');
    if (room.systemKey) throw new BadRequestException('系统位置不能拆分 / 合并');
    return { map, room };
  }

  private moveDecorations(map: HouseholdMap, match: (one: MapDecoration) => boolean, roomId: string) {
    const list = (map.decorations ?? []) as unknown as MapDecoration[];
    if (!list.some(match)) return;
    map.decorations = list.map((one) => (match(one) ? { ...one, roomId } : one)) as unknown as Record<string, unknown>[];
    map.decorationsVersion += 1;
    map.updatedAt = new Date();
  }

  private assertManager(user: JwtUser) {
    if (!isHouseholdManager(user)) throw new ForbiddenException('拆分、合并房间由管理员来做');
  }
}
