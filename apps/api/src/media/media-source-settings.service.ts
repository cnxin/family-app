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
  HouseholdMediaSourceConfig,
  MediaCredentialKind,
  MediaMetadataSource,
} from '../entities';
import {
  MediaMetadataConfig,
  mediaMetadataConfig,
} from './metadata.config';

const PROVIDERS: MediaMetadataSource[] = ['tmdb', 'douban', 'bangumi'];
const PROVIDER_NAMES: Record<MediaMetadataSource, string> = {
  tmdb: 'TMDB',
  douban: '豆瓣',
  bangumi: 'Bangumi',
};

export interface UpdateMediaSourceSettingsInput {
  isEnabled?: boolean;
  baseUrl?: string | null;
  credentialKind?: MediaCredentialKind | null;
  credential?: string;
  clearCredential?: boolean;
  imageBaseUrl?: string | null;
  userAgent?: string | null;
}

export interface ResolvedMediaMetadataSettings {
  config: MediaMetadataConfig;
  enabled: Record<MediaMetadataSource, boolean>;
  version: string;
}

function normalizeUrl(value: string | null | undefined, label: string) {
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
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

@Injectable()
export class MediaSourceSettingsService {
  constructor(
    @InjectRepository(HouseholdMediaSourceConfig)
    private readonly configs: Repository<HouseholdMediaSourceConfig>,
    private readonly dataSource: DataSource,
  ) {}

  isProvider(value: string): value is MediaMetadataSource {
    return PROVIDERS.includes(value as MediaMetadataSource);
  }

  async list(user: JwtUser) {
    const defaults = mediaMetadataConfig();
    const rows = await this.findRows(user.householdId, false);
    const byProvider = new Map(rows.map((row) => [row.provider, row]));

    return PROVIDERS.map((provider) => {
      const row = byProvider.get(provider);
      const fallback = this.defaultView(provider, defaults);
      const settings = row?.settings ?? fallback.settings;
      return {
        provider,
        name: PROVIDER_NAMES[provider],
        mode: row ? ('household' as const) : ('server_default' as const),
        isEnabled: row?.isEnabled ?? true,
        baseUrl: row?.baseUrl ?? fallback.baseUrl,
        credentialKind: row?.credentialKind ?? fallback.credentialKind,
        credentialConfigured: row
          ? Boolean(row.credentialHint)
          : fallback.credentialConfigured,
        credentialHint: row?.credentialHint ?? fallback.credentialHint,
        configured: row
          ? this.isConfigured(
              provider,
              row.isEnabled,
              row.baseUrl,
              Boolean(row.credentialHint),
            )
          : fallback.configured,
        settings,
        updatedAt: row?.updatedAt ?? null,
      };
    });
  }

  async resolve(householdId: string): Promise<ResolvedMediaMetadataSettings> {
    const defaults = mediaMetadataConfig();
    const rows = await this.findRows(householdId, true);
    const byProvider = new Map(rows.map((row) => [row.provider, row]));
    const tmdb = byProvider.get('tmdb');
    const douban = byProvider.get('douban');
    const bangumi = byProvider.get('bangumi');
    const tmdbCredential = tmdb ? this.decryptCredential(tmdb) : null;
    const doubanCredential = douban ? this.decryptCredential(douban) : null;
    const bangumiCredential = bangumi ? this.decryptCredential(bangumi) : null;

    return {
      config: {
        tmdb: tmdb
          ? {
              baseUrl: tmdb.baseUrl!,
              imageBaseUrl:
                this.setting(tmdb, 'imageBaseUrl') ?? defaults.tmdb.imageBaseUrl,
              token:
                tmdb.credentialKind === 'token' ? tmdbCredential : null,
              apiKey:
                tmdb.credentialKind === 'api_key' ? tmdbCredential : null,
            }
          : defaults.tmdb,
        douban: douban
          ? { baseUrl: douban.baseUrl, token: doubanCredential }
          : defaults.douban,
        bangumi: bangumi
          ? {
              baseUrl: bangumi.baseUrl!,
              token: bangumiCredential,
              userAgent:
                this.setting(bangumi, 'userAgent') ?? defaults.bangumi.userAgent,
            }
          : defaults.bangumi,
      },
      enabled: {
        tmdb: tmdb?.isEnabled ?? true,
        douban: douban?.isEnabled ?? true,
        bangumi: bangumi?.isEnabled ?? true,
      },
      version:
        rows
          .map((row) => `${row.provider}:${row.updatedAt.getTime()}`)
          .sort()
          .join('|') || 'server-default',
    };
  }

  async update(
    provider: MediaMetadataSource,
    input: UpdateMediaSourceSettingsInput,
    user: JwtUser,
  ) {
    if (input.credential && input.clearCredential) {
      throw new BadRequestException('不能同时填写和清除凭据');
    }
    if (
      provider !== 'tmdb' &&
      input.credentialKind != null &&
      input.credentialKind !== 'token'
    ) {
      throw new BadRequestException(`${PROVIDER_NAMES[provider]}只支持 Token`);
    }

    const defaults = mediaMetadataConfig();
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(HouseholdMediaSourceConfig);
      const existing = await repository
        .createQueryBuilder('config')
        .addSelect('config.credentialEncrypted')
        .where('config.householdId = :householdId', {
          householdId: user.householdId,
        })
        .andWhere('config.provider = :provider', { provider })
        .getOne();
      const fallback = this.defaultView(provider, defaults);
      const row =
        existing ??
        repository.create({
          householdId: user.householdId,
          provider,
          credentialEncrypted: null,
          credentialHint: null,
          settings: {},
        });

      row.isEnabled = input.isEnabled ?? existing?.isEnabled ?? true;
      row.baseUrl = normalizeUrl(
        input.baseUrl !== undefined
          ? input.baseUrl
          : existing?.baseUrl ?? fallback.baseUrl,
        `${PROVIDER_NAMES[provider]} API 地址`,
      );
      if (row.isEnabled && !row.baseUrl) {
        throw new BadRequestException(
          `${PROVIDER_NAMES[provider]}启用时必须填写 API 地址`,
        );
      }
      row.credentialKind =
        input.credentialKind !== undefined
          ? input.credentialKind
          : existing?.credentialKind ?? 'token';
      if (provider !== 'tmdb') row.credentialKind = 'token';

      if (input.clearCredential) {
        row.credentialEncrypted = null;
        row.credentialHint = null;
      } else if (input.credential !== undefined) {
        const credential = input.credential.trim();
        if (credential.length < 4) {
          throw new BadRequestException('凭据至少需要 4 个字符');
        }
        row.credentialEncrypted = encryptIntegrationCredential(
          credential,
          user.householdId,
          provider,
        );
        row.credentialHint = integrationCredentialHint(credential);
      }

      row.settings = this.normalizeSettings(
        provider,
        input,
        existing?.settings ?? fallback.settings,
      );
      await repository.save(row);
      await recordActivity(manager, user, {
        module: 'media',
        action: 'media_source_config_updated',
        summary: `更新了 ${PROVIDER_NAMES[provider]} 数据源设置`,
        targetPath: '/media/settings',
        metadata: { provider },
      });
    });
    return this.list(user);
  }

  async reset(provider: MediaMetadataSource, user: JwtUser) {
    await this.dataSource.transaction(async (manager) => {
      const result = await manager.getRepository(HouseholdMediaSourceConfig).delete({
        householdId: user.householdId,
        provider,
      });
      if (!result.affected) {
        throw new NotFoundException('当前家庭没有该数据源的自定义设置');
      }
      await recordActivity(manager, user, {
        module: 'media',
        action: 'media_source_config_reset',
        summary: `恢复了 ${PROVIDER_NAMES[provider]} 的服务器默认设置`,
        targetPath: '/media/settings',
        metadata: { provider },
      });
    });
    return this.list(user);
  }

  private findRows(householdId: string, withCredentials: boolean) {
    const query = this.configs
      .createQueryBuilder('config')
      .where('config.householdId = :householdId', { householdId });
    if (withCredentials) query.addSelect('config.credentialEncrypted');
    return query.getMany();
  }

  private defaultView(
    provider: MediaMetadataSource,
    defaults: MediaMetadataConfig,
  ) {
    if (provider === 'tmdb') {
      const credentialKind = defaults.tmdb.token
        ? ('token' as const)
        : defaults.tmdb.apiKey
          ? ('api_key' as const)
          : ('token' as const);
      const credentialConfigured = Boolean(
        defaults.tmdb.token || defaults.tmdb.apiKey,
      );
      return {
        baseUrl: defaults.tmdb.baseUrl,
        credentialKind,
        credentialConfigured,
        credentialHint: credentialConfigured ? '服务器默认' : null,
        configured: credentialConfigured,
        settings: { imageBaseUrl: defaults.tmdb.imageBaseUrl },
      };
    }
    if (provider === 'douban') {
      const credentialConfigured = Boolean(defaults.douban.token);
      return {
        baseUrl: defaults.douban.baseUrl,
        credentialKind: 'token' as const,
        credentialConfigured,
        credentialHint: credentialConfigured ? '服务器默认' : null,
        configured: Boolean(defaults.douban.baseUrl),
        settings: {},
      };
    }
    const credentialConfigured = Boolean(defaults.bangumi.token);
    return {
      baseUrl: defaults.bangumi.baseUrl,
      credentialKind: 'token' as const,
      credentialConfigured,
      credentialHint: credentialConfigured ? '服务器默认' : null,
      configured: true,
      settings: { userAgent: defaults.bangumi.userAgent },
    };
  }

  private isConfigured(
    provider: MediaMetadataSource,
    enabled: boolean,
    baseUrl: string | null,
    hasCredential: boolean,
  ) {
    if (!enabled || !baseUrl) return false;
    return provider === 'tmdb' ? hasCredential : true;
  }

  private normalizeSettings(
    provider: MediaMetadataSource,
    input: UpdateMediaSourceSettingsInput,
    previous: Record<string, unknown>,
  ) {
    if (provider === 'tmdb') {
      const imageBaseUrl = normalizeUrl(
        input.imageBaseUrl !== undefined
          ? input.imageBaseUrl
          : typeof previous.imageBaseUrl === 'string'
            ? previous.imageBaseUrl
            : null,
        'TMDB 图片地址',
      );
      if (!imageBaseUrl) {
        throw new BadRequestException('TMDB 图片地址不能为空');
      }
      return { imageBaseUrl };
    }
    if (provider === 'bangumi') {
      const userAgent =
        input.userAgent !== undefined
          ? input.userAgent?.trim()
          : typeof previous.userAgent === 'string'
            ? previous.userAgent.trim()
            : '';
      if (!userAgent || userAgent.length > 300) {
        throw new BadRequestException('Bangumi User-Agent 需要填写且不能超过 300 字');
      }
      return { userAgent };
    }
    return {};
  }

  private setting(row: HouseholdMediaSourceConfig, key: string) {
    const value = row.settings[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private decryptCredential(row: HouseholdMediaSourceConfig) {
    return decryptIntegrationCredential(
      row.credentialEncrypted,
      row.householdId,
      row.provider,
      PROVIDER_NAMES[row.provider],
    );
  }
}
