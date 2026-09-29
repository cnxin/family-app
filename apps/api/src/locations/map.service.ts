import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { basename, join, resolve } from 'path';
import { DataSource, Repository } from 'typeorm';
import {
  MAP_VIEWBOX_WIDTH,
  type HouseholdMap as HouseholdMapView,
  type HouseholdMapExport,
  type MapShape,
  type PutHouseholdMapBody,
} from '@family/contracts';
import { isHouseholdManager } from '@family/shared';
import { JwtUser } from '../auth/jwt.guard';
import { HouseholdMap, StorageLocation } from '../entities';
import { UPLOAD_DIR } from '../upload/upload.module';
import { placeTree } from './location-tree';

/** 底图放在 uploads/.private/maps/<家庭>/：/uploads 静态路由不给 .private，整个 uploads 目录本来就在备份里 */
export const MAP_UPLOAD_DIR = join(UPLOAD_DIR, '.private', 'maps');

const IMAGE_TYPES: { type: string; ext: string; sniff: (body: Buffer) => boolean }[] = [
  { type: 'image/png', ext: '.png', sniff: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/jpeg', ext: '.jpg', sniff: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: 'image/webp',
    ext: '.webp',
    sniff: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];
export const MAP_BACKGROUND_TYPES = new Set(IMAGE_TYPES.map((one) => one.type));

function backgroundPath(householdId: string, fileName: string) {
  const directory = resolve(MAP_UPLOAD_DIR, householdId);
  const path = resolve(directory, basename(fileName));
  return { directory, path };
}

/**
 * I2 家庭地图（item-location-plan §2.2、§2.4）：一家一张。看全家都能看，建 / 改 / 换底图只有管理员。
 * 形状不在这里，在各位置的 mapShape（PATCH /locations/:id/shape）。
 */
@Injectable()
export class MapService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(HouseholdMap) private readonly maps: Repository<HouseholdMap>,
  ) {}

  async get(householdId: string): Promise<HouseholdMapView | null> {
    const map = await this.maps.findOne({ where: { householdId, isActive: true } });
    return map ? this.present(map) : null;
  }

  async put(body: PutHouseholdMapBody, user: JwtUser): Promise<HouseholdMapView> {
    this.assertManager(user);
    const saved = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(HouseholdMap);
      const existing = await repo.findOne({
        where: { householdId: user.householdId, isActive: true },
        lock: { mode: 'pessimistic_write' },
      });
      const reshaped = existing && existing.viewBoxHeight !== body.viewBox.h;
      if (reshaped && !body.clearShapes) {
        throw new ConflictException('底图比例变了，原来画的房间和柜子会对不上；要重新导入就先清掉它们的形状');
      }
      if (body.clearShapes) {
        await manager.getRepository(StorageLocation).update({ householdId: user.householdId }, { mapShape: null });
      }
      const map =
        existing ??
        repo.create({ householdId: user.householdId, isActive: true, backgroundFile: null, viewBoxWidth: MAP_VIEWBOX_WIDTH });
      map.viewBoxHeight = body.viewBox.h;
      if (body.title !== undefined) map.title = body.title;
      // 只清形状、比例没变也算改了地图：updatedAt 要动，客户端靠它换缓存
      map.updatedAt = new Date();
      return repo.save(map);
    });
    return this.present(saved);
  }

  async setBackground(file: Express.Multer.File | undefined, user: JwtUser): Promise<HouseholdMapView> {
    this.assertManager(user);
    if (!file) throw new BadRequestException('没有收到底图文件');
    const kind = IMAGE_TYPES.find((one) => one.type === file.mimetype);
    if (!kind || !kind.sniff(file.buffer)) throw new BadRequestException('底图只支持 PNG、JPEG、WebP 图片');
    const map = await this.maps.findOne({ where: { householdId: user.householdId, isActive: true } });
    if (!map) throw new NotFoundException('先建地图再传底图');
    const fileName = `${randomUUID()}${kind.ext}`;
    const { directory, path } = backgroundPath(user.householdId, fileName);
    await mkdir(directory, { recursive: true });
    await writeFile(path, file.buffer, { flag: 'wx' });
    const previous = map.backgroundFile;
    try {
      map.backgroundFile = fileName;
      map.updatedAt = new Date();
      await this.maps.save(map);
    } catch (error) {
      await unlink(path).catch(() => undefined);
      throw error;
    }
    if (previous) await unlink(backgroundPath(user.householdId, previous).path).catch(() => undefined);
    return this.present(map);
  }

  async background(householdId: string) {
    const map = await this.maps.findOne({ where: { householdId, isActive: true } });
    if (!map?.backgroundFile) throw new NotFoundException('还没有底图');
    const { path } = backgroundPath(householdId, map.backgroundFile);
    try {
      const body = await readFile(path);
      const type = IMAGE_TYPES.find((one) => path.endsWith(one.ext))?.type ?? 'application/octet-stream';
      return { body, contentType: type };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundException('底图文件不见了');
      throw error;
    }
  }

  /**
   * I2c 导出：地图本身、所有位置（含归档的，形状照带）和底图原样。备份不靠它——uploads 整个目录（含 .private/maps）
   * 本来就在备份里（backup-restore.md）；这是给「自己留一份 / 换机器导回来」的。
   */
  async export(user: JwtUser): Promise<HouseholdMapExport> {
    this.assertManager(user);
    const map = await this.maps.findOne({ where: { householdId: user.householdId, isActive: true } });
    if (!map) throw new NotFoundException('还没有家庭地图');
    const rows = await this.dataSource.getRepository(StorageLocation).find({ where: { householdId: user.householdId } });
    let background: HouseholdMapExport['background'] = null;
    if (map.backgroundFile) {
      try {
        const file = await this.background(user.householdId);
        background = { contentType: file.contentType, base64: file.body.toString('base64') };
      } catch (error) {
        // 文件丢了也照样导出形状，底图记成 null
        if (!(error instanceof NotFoundException)) throw error;
      }
    }
    return {
      exportedAt: new Date().toISOString(),
      map: this.present(map),
      locations: placeTree(rows).map(({ row, pathLabel }) => ({
        id: row.id,
        parentId: row.parentId,
        kind: row.kind,
        name: row.name,
        pathLabel,
        mapShape: row.kind === 'slot' ? null : ((row.mapShape as MapShape | null) ?? null),
        archivedAt: row.archivedAt?.toISOString() ?? null,
      })),
      background,
    };
  }

  private assertManager(user: JwtUser) {
    if (!isHouseholdManager(user)) throw new ForbiddenException('家庭地图由管理员来画');
  }

  private present(map: HouseholdMap): HouseholdMapView {
    return {
      id: map.id,
      title: map.title,
      viewBox: { w: MAP_VIEWBOX_WIDTH, h: map.viewBoxHeight },
      hasBackground: Boolean(map.backgroundFile),
      updatedAt: map.updatedAt.toISOString(),
    };
  }
}
