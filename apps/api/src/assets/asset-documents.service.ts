import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, resolve, sep } from 'node:path';
import { DataSource, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import { jwtSecret } from '../common/config';
import { AssetDocument } from '../entities';
import { PRIVATE_ASSET_UPLOAD_DIR, UPLOAD_DIR } from '../upload/upload.module';
import { CreateAssetDocumentDto, UploadAssetDocumentDto } from './assets.dto';
import { ASSET_FILE_PREFIX, isExternalDocumentUrl, presentDocument } from './assets.helpers';
import { AssetsService } from './assets.service';

const ASSET_DOCUMENT_ACCESS_TTL_SECONDS = 60;

function assertDocumentUrl(value: string) {
  const url = value.trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return url;
  } catch {
    // Fall through to the user-facing validation error.
  }
  throw new BadRequestException('资料地址必须使用 HTTP(S)，本地文件请通过上传');
}

function uploadedAssetExtension(mimeType: string) {
  const extensions: Record<string, string> = {
    'image/gif': '.gif',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
  };
  return extensions[mimeType] ?? '.bin';
}

function assetDocumentContentType(path: string) {
  const contentTypes: Record<string, string> = {
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  return contentTypes[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function privateAssetFilePath(householdId: string, url: string) {
  if (!url.startsWith(ASSET_FILE_PREFIX)) return null;
  const fileName = basename(url.slice(ASSET_FILE_PREFIX.length));
  if (!fileName || `${ASSET_FILE_PREFIX}${fileName}` !== url) {
    throw new ForbiddenException('资产资料存储路径无效');
  }
  return resolve(PRIVATE_ASSET_UPLOAD_DIR, householdId, fileName);
}

function legacyAssetFilePath(url: string) {
  if (!url.startsWith('/uploads/')) return null;
  const uploadRoot = resolve(UPLOAD_DIR);
  const path = resolve(uploadRoot, url.slice('/uploads/'.length));
  if (path === uploadRoot || !path.startsWith(`${uploadRoot}${sep}`)) {
    throw new ForbiddenException('资产资料存储路径无效');
  }
  return path;
}

/** 资产证件 / 附件：外链与上传、签名访问链接、按签名读文件、删除（J7.2 从 AssetsService 拆出）。 */
@Injectable()
export class AssetDocumentsService {
  private readonly documentSigningSecret = jwtSecret();

  constructor(
    @InjectRepository(AssetDocument)
    private readonly documents: Repository<AssetDocument>,
    private readonly dataSource: DataSource,
    private readonly assetsService: AssetsService,
  ) {}

  async createDocument(
    assetId: string,
    dto: CreateAssetDocumentDto,
    user: JwtUser,
  ) {
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('资料名称不能为空');
    const asset = await this.assetsService.requireAsset(assetId, user.householdId, false);
    return this.dataSource.transaction(async (manager) => {
      const documents = manager.getRepository(AssetDocument);
      const document = await documents.save(
        documents.create({
          householdId: user.householdId,
          assetId,
          type: dto.type,
          title,
          url: assertDocumentUrl(dto.url),
          createdById: user.memberId,
        }),
      );
      await recordActivity(manager, user, {
        module: 'asset',
        action: 'asset_document_added',
        summary: `${user.name} 为「${asset.name}」添加了资料「${document.title}」`,
        targetPath: `/home-assets?assetId=${asset.id}`,
        metadata: {
          assetId: asset.id,
          documentId: document.id,
          documentType: document.type,
        },
      });
      return presentDocument(document);
    });
  }

  async createUploadedDocument(
    assetId: string,
    dto: UploadAssetDocumentDto,
    file: Express.Multer.File | undefined,
    user: JwtUser,
  ) {
    if (!file) throw new BadRequestException('没有收到资产资料文件');
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('资料名称不能为空');
    const asset = await this.assetsService.requireAsset(assetId, user.householdId, false);
    const fileName = `${randomUUID()}${uploadedAssetExtension(file.mimetype)}`;
    const directory = resolve(PRIVATE_ASSET_UPLOAD_DIR, user.householdId);
    const path = resolve(directory, fileName);
    await mkdir(directory, { recursive: true });
    await writeFile(path, file.buffer, { flag: 'wx' });

    try {
      const document = await this.dataSource.transaction(async (manager) => {
        const documents = manager.getRepository(AssetDocument);
        const saved = await documents.save(
          documents.create({
            householdId: user.householdId,
            assetId,
            type: dto.type,
            title,
            url: `${ASSET_FILE_PREFIX}${fileName}`,
            createdById: user.memberId,
          }),
        );
        await recordActivity(manager, user, {
          module: 'asset',
          action: 'asset_document_added',
          summary: `${user.name} 为「${asset.name}」上传了资料「${saved.title}」`,
          targetPath: `/home-assets?assetId=${asset.id}`,
          metadata: {
            assetId: asset.id,
            documentId: saved.id,
            documentType: saved.type,
            storage: 'private',
          },
        });
        return saved;
      });
      return presentDocument(document);
    } catch (error) {
      await unlink(path).catch(() => undefined);
      throw error;
    }
  }

  async documentAccess(id: string, user: JwtUser) {
    const document = await this.documents.findOneBy({
      id,
      householdId: user.householdId,
    });
    if (!document) throw new NotFoundException('资产资料不存在');
    if (isExternalDocumentUrl(document.url)) {
      return { url: document.url, external: true, expiresAt: null };
    }
    const expires =
      Math.floor(Date.now() / 1000) + ASSET_DOCUMENT_ACCESS_TTL_SECONDS;
    const signature = this.signDocumentAccess(document.id, expires);
    return {
      url: `/asset-documents/${document.id}/content?expires=${expires}&signature=${signature}`,
      external: false,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  async documentContent(id: string, expiresValue: string, signature: string) {
    const expires = Number(expiresValue);
    this.verifyDocumentAccess(id, expires, signature);
    const document = await this.documents.findOneBy({ id });
    if (!document || isExternalDocumentUrl(document.url)) {
      throw new NotFoundException('资产资料文件不存在');
    }
    const path =
      privateAssetFilePath(document.householdId, document.url) ??
      legacyAssetFilePath(document.url);
    if (!path) throw new NotFoundException('资产资料文件不存在');
    let body: Buffer;
    try {
      body = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException('资产资料文件不存在');
      }
      throw error;
    }
    return {
      body,
      contentType: assetDocumentContentType(path),
      fileName: `${document.title}${extname(path).toLowerCase()}`,
    };
  }

  async removeDocument(id: string, user: JwtUser) {
    const removed = await this.dataSource.transaction(async (manager) => {
      const documents = manager.getRepository(AssetDocument);
      const document = await documents.findOne({
        where: { id, householdId: user.householdId },
        relations: { asset: true },
      });
      if (!document) throw new NotFoundException('资产资料不存在');
      await documents.delete({ id, householdId: user.householdId });
      await recordActivity(manager, user, {
        module: 'asset',
        action: 'asset_document_removed',
        summary: `${user.name} 移除了「${document.asset.name}」的资料「${document.title}」`,
        targetPath: `/home-assets?assetId=${document.assetId}`,
        metadata: {
          assetId: document.assetId,
          documentId: document.id,
          documentType: document.type,
        },
      });
      return {
        result: { id, removed: true as const },
        privatePath: privateAssetFilePath(document.householdId, document.url),
      };
    });
    if (removed.privatePath) {
      await unlink(removed.privatePath).catch(() => undefined);
    }
    return removed.result;
  }

  private signDocumentAccess(id: string, expires: number) {
    return createHmac('sha256', this.documentSigningSecret)
      .update(`asset-document:${id}:${expires}`)
      .digest('base64url');
  }

  private verifyDocumentAccess(
    id: string,
    expires: number,
    signature: string,
  ) {
    const now = Math.floor(Date.now() / 1000);
    if (
      !Number.isSafeInteger(expires) ||
      expires < now ||
      expires > now + ASSET_DOCUMENT_ACCESS_TTL_SECONDS + 5
    ) {
      throw new ForbiddenException('资产资料链接已过期');
    }
    const expected = Buffer.from(
      this.signDocumentAccess(id, expires),
      'utf8',
    );
    const received = Buffer.from(signature || '', 'utf8');
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new ForbiddenException('资产资料链接无效');
    }
  }
}
