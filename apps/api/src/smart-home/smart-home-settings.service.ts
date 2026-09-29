import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { SmartHomeConnectorSettings, UpdateSmartHomeConnectorBody } from '@family/contracts';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import {
  decryptIntegrationCredential,
  encryptIntegrationCredential,
  integrationCredentialHint,
} from '../common/integration-credentials';
import { Integration, IntegrationSecret } from '../entities';
import type { HomeAssistantTarget } from './home-assistant.client';
import { homeAssistantServerDefault, normalizeHomeAssistantBaseUrl } from './home-assistant.config';

const KIND = 'home_assistant' as const;
const NAME = 'Home Assistant';
const SCOPE = `connector:${KIND}`;
const SETTINGS_PATH = '/house/smart-home/settings';

export interface ResolvedHomeAssistant {
  /** 可以去连的地址和令牌；没配好或停用时为 null */
  target: HomeAssistantTarget | null;
  /** 设置变了就变，状态缓存以它为键 */
  version: string;
}

/**
 * HA 连接设置：复用 integrations / integration_secrets（kind = 'home_assistant'），
 * 令牌加密存库、只写不读，和媒体连接器同一套（home-assistant-plan §3）。
 * 家庭有自己的一行就完全以它为准；没有才用服务器默认（环境变量 / 令牌文件）。
 */
@Injectable()
export class SmartHomeSettingsService {
  constructor(
    @InjectRepository(Integration)
    private readonly integrations: Repository<Integration>,
    private readonly dataSource: DataSource,
  ) {}

  async present(householdId: string): Promise<SmartHomeConnectorSettings> {
    const row = await this.findRow(householdId, false);
    if (row) {
      const credentialConfigured = Boolean(row.secret?.credentialHint);
      return {
        mode: 'household',
        isEnabled: row.isEnabled,
        baseUrl: row.baseUrl,
        credentialConfigured,
        credentialHint: row.secret?.credentialHint ?? null,
        configured: Boolean(row.isEnabled && row.baseUrl && credentialConfigured),
        updatedAt: row.updatedAt.toISOString(),
      };
    }
    const fallback = homeAssistantServerDefault();
    return {
      mode: 'server_default',
      isEnabled: true,
      baseUrl: fallback.baseUrl,
      credentialConfigured: Boolean(fallback.credential),
      credentialHint: fallback.credential ? '服务器默认' : null,
      configured: Boolean(fallback.baseUrl && fallback.credential),
      updatedAt: null,
    };
  }

  /**
   * HA 最近一次连通的时刻，存在这家 integrations 行的 lastSyncedAt（HA 不做同步，这一列借来用），
   * API 重启后「断了多久」照样接着算。服务器默认的连接没有这一行，返回 undefined。
   */
  async lastReachableAt(householdId: string): Promise<Date | null | undefined> {
    const [row]: { lastSyncedAt: Date | null }[] = await this.dataSource.query(
      `SELECT "lastSyncedAt" FROM integrations WHERE "householdId" = $1 AND kind = $2`,
      [householdId, KIND],
    );
    return row ? row.lastSyncedAt : undefined;
  }

  /** 记一次连通。直接写这一列、不碰 updatedAt：updatedAt 是状态缓存和实时订阅的版本号，碰了就会重连。 */
  async markReachable(householdId: string, at: Date) {
    await this.dataSource.query(
      `UPDATE integrations SET "lastSyncedAt" = $3 WHERE "householdId" = $1 AND kind = $2`,
      [householdId, KIND, at],
    );
  }

  async resolve(householdId: string): Promise<ResolvedHomeAssistant> {
    const row = await this.findRow(householdId, true);
    if (row) {
      const token = row.secret
        ? decryptIntegrationCredential(row.secret.credentialEncrypted, householdId, SCOPE, NAME)
        : null;
      return {
        target: row.isEnabled && row.baseUrl && token ? { baseUrl: row.baseUrl, token } : null,
        version: `household:${row.updatedAt.getTime()}:${row.secret?.updatedAt.getTime() ?? 0}`,
      };
    }
    const fallback = homeAssistantServerDefault();
    return {
      target:
        fallback.baseUrl && fallback.credential
          ? { baseUrl: fallback.baseUrl, token: fallback.credential }
          : null,
      version: `server:${fallback.baseUrl ?? ''}:${fallback.credential ? integrationCredentialHint(fallback.credential) : ''}`,
    };
  }

  async update(input: UpdateSmartHomeConnectorBody, user: JwtUser) {
    if (input.credential !== undefined && input.clearCredential) {
      throw new BadRequestException('不能同时填写和清除令牌');
    }
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Integration);
      const existing = await repository
        .createQueryBuilder('integration')
        .leftJoinAndSelect('integration.secret', 'secret')
        .where('integration.householdId = :householdId', { householdId: user.householdId })
        .andWhere('integration.kind = :kind', { kind: KIND })
        .getOne();
      const fallback = homeAssistantServerDefault();
      const row =
        existing ??
        repository.create({
          householdId: user.householdId,
          kind: KIND,
          name: NAME,
          isPrimary: false,
          capabilities: ['states'],
          settings: {},
          lastSyncedAt: null,
        });
      const baseUrl = normalizeHomeAssistantBaseUrl(
        input.baseUrl !== undefined ? input.baseUrl : existing?.baseUrl ?? fallback.baseUrl,
      );
      if (baseUrl === undefined) {
        throw new BadRequestException('Home Assistant 地址要写完整，比如 http://192.168.1.10:8123，不能带用户名密码');
      }
      row.baseUrl = baseUrl;
      row.isEnabled = input.isEnabled ?? existing?.isEnabled ?? true;
      // 设置改了，上一次「连通过」说的是旧设置，不能拿来算新设置断了多久
      row.lastSyncedAt = null;
      if (row.isEnabled && !row.baseUrl) {
        throw new BadRequestException('启用时必须填写 Home Assistant 地址');
      }
      const saved = await repository.save(row);

      const secrets = manager.getRepository(IntegrationSecret);
      if (input.clearCredential) {
        if (existing?.secret) await secrets.delete(existing.secret.id);
      } else if (input.credential !== undefined) {
        const credential = input.credential.trim();
        if (credential.length < 16) {
          throw new BadRequestException('长期访问令牌太短，像是没复制全');
        }
        const secret = existing?.secret ?? secrets.create({ integrationId: saved.id });
        secret.credentialEncrypted = encryptIntegrationCredential(credential, user.householdId, SCOPE);
        secret.credentialHint = integrationCredentialHint(credential);
        await secrets.save(secret);
        // 只换令牌时 integrations 行不变，碰一下 updatedAt，状态缓存才会跟着换
        if (existing) await repository.update(saved.id, { updatedAt: new Date() });
      }

      await recordActivity(manager, user, {
        module: 'system',
        action: 'smart_home_connector_updated',
        summary: '更新了 Home Assistant 连接设置',
        targetPath: SETTINGS_PATH,
        metadata: { kind: KIND },
      });
    });
    return this.present(user.householdId);
  }

  async reset(user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      const result = await manager.getRepository(Integration).delete({
        householdId: user.householdId,
        kind: KIND,
      });
      if (!result.affected) throw new NotFoundException('当前家庭没有自己的 Home Assistant 设置');
      await recordActivity(manager, user, {
        module: 'system',
        action: 'smart_home_connector_reset',
        summary: '恢复了 Home Assistant 的服务器默认设置',
        targetPath: SETTINGS_PATH,
        metadata: { kind: KIND },
      });
    });
    return this.present(user.householdId);
  }

  private findRow(householdId: string, withCredential: boolean) {
    const query = this.integrations
      .createQueryBuilder('integration')
      .leftJoinAndSelect('integration.secret', 'secret')
      .where('integration.householdId = :householdId', { householdId })
      .andWhere('integration.kind = :kind', { kind: KIND });
    if (withCredential) query.addSelect('secret.credentialEncrypted');
    return query.getOne();
  }
}
