import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { recordActivity } from '../activities/activity-log';
import { JwtUser } from '../auth/jwt.guard';
import {
  decryptIntegrationCredential,
  encryptIntegrationCredential,
  integrationCredentialHint,
} from '../common/integration-credentials';
import {
  Integration,
  IntegrationKind,
  IntegrationSecret,
} from '../entities';
import {
  MediaConnectorConfig,
  mediaConnectorConfigs,
} from './connectors.config';
import { connectorRole } from './connectors';
import { literalIpFromBaseUrl } from './moviepilot-webhook.service';

const KINDS: IntegrationKind[] = ['plex', 'emby', 'moviepilot'];
const NAMES: Record<IntegrationKind, string> = {
  plex: 'Plex',
  emby: 'Emby',
  moviepilot: 'MoviePilot',
};
const CAPABILITIES: Record<IntegrationKind, string[]> = {
  plex: ['library', 'playback'],
  emby: ['library', 'playback'],
  moviepilot: ['automation', 'subscription'],
};

export interface UpdateIntegrationSettingsInput {
  name?: string;
  isEnabled?: boolean;
  baseUrl?: string | null;
  credential?: string;
  clearCredential?: boolean;
  isPrimary?: boolean;
}

export interface ResolvedMediaConnectors {
  configs: MediaConnectorConfig[];
  version: string;
}

function normalizeBaseUrl(value: string | null | undefined, label: string) {
  const normalized = value?.trim();
  if (!normalized) return null;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new BadRequestException(`${label}必须是完整的 HTTP 或 HTTPS 地址`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new BadRequestException(`${label}只支持 HTTP 或 HTTPS 地址`);
  }
  if (url.username || url.password) {
    throw new BadRequestException(`${label}不能包含用户名或密码`);
  }
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

@Injectable()
export class IntegrationSettingsService {
  constructor(
    @InjectRepository(Integration)
    private readonly integrations: Repository<Integration>,
    private readonly dataSource: DataSource,
  ) {}

  isKind(value: string): value is IntegrationKind {
    return KINDS.includes(value as IntegrationKind);
  }

  async list(user: JwtUser) {
    const defaults = mediaConnectorConfigs();
    const rows = await this.findRows(user.householdId, false);
    const byKind = new Map(rows.map((row) => [row.kind, row]));
    const merged = this.mergeConfigs(defaults, rows, false);

    return merged.map((config) => {
      const row = byKind.get(config.kind);
      const fallback = defaults.find((item) => item.kind === config.kind)!;
      const credentialConfigured = row
        ? Boolean(row.secret?.credentialHint)
        : Boolean(fallback.credential);
      return {
        kind: config.kind,
        name: config.name,
        role: connectorRole(config.kind),
        mode: row ? ('household' as const) : ('server_default' as const),
        isEnabled: row?.isEnabled ?? true,
        baseUrl: config.baseUrl,
        credentialConfigured,
        credentialHint: row
          ? row.secret?.credentialHint ?? null
          : credentialConfigured
            ? '服务器默认'
            : null,
        isPrimary: config.primary,
        configured: Boolean(
          (row?.isEnabled ?? true) && config.baseUrl && credentialConfigured,
        ),
        capabilities: CAPABILITIES[config.kind],
        webhookConfigured:
          config.kind === 'moviepilot' && Boolean(row?.webhookSecretHash),
        webhookSourceIp:
          config.kind === 'moviepilot'
            ? row?.webhookSourceIp ?? literalIpFromBaseUrl(config.baseUrl)
            : null,
        webhookUpdatedAt:
          config.kind === 'moviepilot' ? row?.webhookUpdatedAt ?? null : null,
        updatedAt: row?.updatedAt ?? null,
      };
    });
  }

  async resolve(householdId: string): Promise<ResolvedMediaConnectors> {
    const rows = await this.findRows(householdId, true);
    return {
      configs: this.mergeConfigs(mediaConnectorConfigs(), rows, true),
      version:
        rows
          .map((row) => `${row.kind}:${row.updatedAt.getTime()}`)
          .sort()
          .join('|') || 'server-default',
    };
  }

  async update(
    kind: IntegrationKind,
    input: UpdateIntegrationSettingsInput,
    user: JwtUser,
  ) {
    if (input.credential && input.clearCredential) {
      throw new BadRequestException('不能同时填写和清除凭据');
    }
    if (input.isPrimary && kind === 'moviepilot') {
      throw new BadRequestException('MoviePilot 不是媒体库，不能设为主媒体库');
    }
    if (input.isPrimary && input.isEnabled === false) {
      throw new BadRequestException('停用的媒体库不能设为主媒体库');
    }

    const defaults = mediaConnectorConfigs();
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Integration);
      const existing = await repository
        .createQueryBuilder('integration')
        .leftJoinAndSelect('integration.secret', 'secret')
        .addSelect('secret.credentialEncrypted')
        .where('integration.householdId = :householdId', {
          householdId: user.householdId,
        })
        .andWhere('integration.kind = :kind', { kind })
        .getOne();
      const fallback = defaults.find((item) => item.kind === kind)!;
      const row =
        existing ??
        repository.create({
          householdId: user.householdId,
          kind,
          capabilities: CAPABILITIES[kind],
          settings: {},
          lastSyncedAt: null,
        });

      const name = (input.name ?? existing?.name ?? fallback.name).trim();
      if (!name || name.length > 120) {
        throw new BadRequestException('服务名称需要填写且不能超过 120 字');
      }
      row.name = name;
      row.isEnabled = input.isEnabled ?? existing?.isEnabled ?? true;
      row.baseUrl = normalizeBaseUrl(
        input.baseUrl !== undefined
          ? input.baseUrl
          : existing?.baseUrl ?? fallback.baseUrl,
        `${NAMES[kind]} 服务地址`,
      );
      if (row.isEnabled && !row.baseUrl) {
        throw new BadRequestException(`${NAMES[kind]}启用时必须填写服务地址`);
      }
      row.isPrimary =
        kind !== 'moviepilot' && row.isEnabled
          ? input.isPrimary ?? existing?.isPrimary ?? fallback.primary
          : false;
      row.capabilities = CAPABILITIES[kind];
      row.settings = existing?.settings ?? {};

      if (row.isPrimary) {
        await repository
          .createQueryBuilder()
          .update(Integration)
          .set({ isPrimary: false })
          .where('householdId = :householdId', {
            householdId: user.householdId,
          })
          .andWhere(`kind IN ('plex', 'emby')`)
          .andWhere(existing ? 'id <> :id' : 'kind <> :kind', {
            ...(existing ? { id: existing.id } : { kind }),
          })
          .execute();
      }

      const saved = await repository.save(row);
      const secrets = manager.getRepository(IntegrationSecret);
      if (input.clearCredential) {
        if (existing?.secret) await secrets.delete(existing.secret.id);
      } else if (input.credential !== undefined) {
        const credential = input.credential.trim();
        if (credential.length < 4) {
          throw new BadRequestException('凭据至少需要 4 个字符');
        }
        const secret =
          existing?.secret ?? secrets.create({ integrationId: saved.id });
        secret.credentialEncrypted = encryptIntegrationCredential(
          credential,
          user.householdId,
          `connector:${kind}`,
        );
        secret.credentialHint = integrationCredentialHint(credential);
        await secrets.save(secret);
      }

      await recordActivity(manager, user, {
        module: 'media',
        action: 'media_connector_config_updated',
        summary: `更新了 ${NAMES[kind]} 连接设置`,
        targetPath: '/media/settings?section=services',
        metadata: { kind },
      });
    });
    return this.list(user);
  }

  async reset(kind: IntegrationKind, user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      const result = await manager.getRepository(Integration).delete({
        householdId: user.householdId,
        kind,
      });
      if (!result.affected) {
        throw new NotFoundException('当前家庭没有该服务的自定义设置');
      }
      await recordActivity(manager, user, {
        module: 'media',
        action: 'media_connector_config_reset',
        summary: `恢复了 ${NAMES[kind]} 的服务器默认设置`,
        targetPath: '/media/settings?section=services',
        metadata: { kind },
      });
    });
    return this.list(user);
  }

  private findRows(householdId: string, withCredentials: boolean) {
    const query = this.integrations
      .createQueryBuilder('integration')
      .leftJoinAndSelect('integration.secret', 'secret')
      .addSelect('integration.webhookSecretHash')
      .where('integration.householdId = :householdId', { householdId })
      .andWhere('integration.kind IN (:...kinds)', { kinds: KINDS });
    if (withCredentials) query.addSelect('secret.credentialEncrypted');
    return query.getMany();
  }

  private mergeConfigs(
    defaults: MediaConnectorConfig[],
    rows: Integration[],
    withCredentials: boolean,
  ) {
    const byKind = new Map(rows.map((row) => [row.kind, row]));
    const configs = defaults.map((fallback) => {
      const row = byKind.get(fallback.kind);
      return row
        ? {
            key: row.kind,
            kind: row.kind,
            name: row.name,
            baseUrl: row.baseUrl,
            credential:
              withCredentials && row.secret
                ? decryptIntegrationCredential(
                    row.secret.credentialEncrypted,
                    row.householdId,
                    `connector:${row.kind}`,
                    NAMES[row.kind],
                  )
                : null,
            primary: row.isPrimary,
            enabled: row.isEnabled,
          }
        : { ...fallback, enabled: true };
    });
    const explicitPrimary = rows.find(
      (row) => row.isPrimary && row.isEnabled && row.kind !== 'moviepilot',
    )?.kind;
    const primaryKind =
      explicitPrimary ??
      configs.find(
        (config) =>
          config.kind !== 'moviepilot' && config.enabled && config.primary,
      )?.kind ??
      configs.find(
        (config) => config.kind !== 'moviepilot' && config.enabled,
      )?.kind;
    return configs.map((config) => ({
      ...config,
      primary: config.kind === primaryKind,
    }));
  }
}
