import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type {
  ExternalAccessAccessScope,
  ExternalAccessMode,
  ExternalAccessSettings,
  TestExternalAccessSettingsBody,
  UpdateExternalAccessSettingsBody,
} from '@family/contracts';
import { recordActivity } from '../activities/activity-log';
import type { JwtUser } from '../auth/jwt.guard';
import {
  decryptIntegrationCredential,
  encryptIntegrationCredential,
  integrationCredentialHint,
} from '../common/integration-credentials';
import { Integration, IntegrationSecret, type MemberRole } from '../entities';
import {
  clearTailscaleTokenCache,
  probeTailscaleReadOnly,
  TailscaleApiError,
  type TailscaleTarget,
} from './tailscale.client';
import {
  tailscaleServerDefault,
  tailscaleServerDefaultConfigured,
} from './tailscale.config';
import {
  normalizeTailscaleUpdateInput,
  presentHouseholdTailscaleSettings,
  presentRestrictedTailscaleSettings,
  presentServerDefaultTailscaleSettings,
  readStoredTailscaleSettings,
  resolveDraftTailscaleTarget,
  resolveHouseholdTailscaleAccess,
  resolveRestrictedTailscaleAccess,
  resolveServerDefaultTailscaleAccess,
  type ResolvedTailscaleAccess,
} from './tailscale.settings-presenter';

export type { ResolvedTailscaleAccess };

const KIND = 'tailscale' as const;
const NAME = 'Tailscale';
const SCOPE = `connector:${KIND}`;
const SETTINGS_PATH = '/house/external-access/settings';
export const RESTRICTED_HOUSEHOLD_MESSAGE = '本实例未向你的家庭开放外部访问管理';
export const RESTRICTED_ADMIN_MESSAGE =
  '服务器默认外部访问仅对家庭创建者开放；如需管理员共同管理，请由家庭创建者配置本家庭专属只读凭据';

/**
 * 外部访问（Tailscale）连接设置服务：
 * - 复用 integrations / integration_secrets（kind = 'tailscale'），凭据 AES-256-GCM 加密存库、只写不读；
 * - 支持「服务器默认 + 家庭覆盖」，多家庭实例按 §5.2 / §9 限制服务器默认仅对主家庭 owner 可见；
 * - 阶段 1 保存凭据时核验只读权限，若控制面确认凭据包含写权限则拒绝保存。
 */
@Injectable()
export class ExternalAccessSettingsService {
  constructor(
    @InjectRepository(Integration)
    private readonly integrations: Repository<Integration>,
    private readonly dataSource: DataSource,
  ) {}

  async primaryAllowedHouseholdId(): Promise<string | null> {
    const configured = tailscaleServerDefault().allowedHouseholdId;
    if (configured) return configured;
    const rows: { id: string }[] = await this.dataSource.query(
      'SELECT id FROM households ORDER BY "createdAt" ASC, id ASC LIMIT 1',
    );
    return rows[0]?.id ?? null;
  }

  async isPrimaryAllowedHousehold(householdId: string): Promise<boolean> {
    const allowed = await this.primaryAllowedHouseholdId();
    return Boolean(allowed && allowed === householdId);
  }

  async present(user: JwtUser): Promise<ExternalAccessSettings> {
    const row = await this.findRow(user.householdId, false);
    if (row) return presentHouseholdTailscaleSettings(row);

    const access = await this.evaluateServerDefaultAccess(user.householdId, user.role);
    if (access.accessScope === 'restricted') {
      return presentRestrictedTailscaleSettings(access.accessMessage);
    }
    return presentServerDefaultTailscaleSettings(tailscaleServerDefault());
  }

  async resolve(householdId: string, role: MemberRole): Promise<ResolvedTailscaleAccess> {
    const row = await this.findRow(householdId, true);
    if (row) {
      const secret = row.secret
        ? decryptIntegrationCredential(row.secret.credentialEncrypted, householdId, SCOPE, NAME)
        : null;
      return resolveHouseholdTailscaleAccess(row, secret);
    }

    const access = await this.evaluateServerDefaultAccess(householdId, role);
    if (access.accessScope === 'restricted') {
      return resolveRestrictedTailscaleAccess(access.accessMessage);
    }

    return resolveServerDefaultTailscaleAccess(tailscaleServerDefault());
  }

  async resolveForDraftTest(
    user: JwtUser,
    draft: TestExternalAccessSettingsBody,
  ): Promise<{
    accessScope: ExternalAccessAccessScope;
    accessMessage: string | null;
    target: TailscaleTarget | null;
    nodeHostname: string | null;
  }> {
    const current = await this.resolve(user.householdId, user.role);
    return resolveDraftTailscaleTarget(current, draft);
  }

  async update(input: UpdateExternalAccessSettingsBody, user: JwtUser): Promise<ExternalAccessSettings> {
    if (input.credential !== undefined && input.clearCredential) {
      throw new BadRequestException('不能同时填写和清除凭据');
    }
    const existing = await this.findRow(user.householdId, true);
    const fallback = tailscaleServerDefault();
    const serverDefaultActive = !existing && tailscaleServerDefaultConfigured();
    const isPrimary = !existing ? await this.isPrimaryAllowedHousehold(user.householdId) : false;
    if (serverDefaultActive && isPrimary && user.role !== 'owner') {
      throw new ForbiddenException(
        '当前家庭正在使用服务器默认外部访问，请由家庭创建者切换为家庭专属凭据',
      );
    }
    const serverDefaultAccess = existing
      ? null
      : await this.evaluateServerDefaultAccess(user.householdId, user.role);
    const allowFallbackDefaults = serverDefaultAccess?.accessScope === 'server_default';
    const normalized = normalizeTailscaleUpdateInput(input, existing, fallback, allowFallbackDefaults);
    const {
      baseUrl,
      tailnet,
      publicUrl,
      nodeHostname,
      isEnabled,
      credentialKind,
      oauthClientId,
      incomingCredential,
    } = normalized;

    const existingStored = readStoredTailscaleSettings(existing?.settings);
    if (
      existing?.secret &&
      incomingCredential === undefined &&
      !input.clearCredential
    ) {
      if (existing.baseUrl && baseUrl !== existing.baseUrl) {
        throw new BadRequestException('修改控制面地址时请重新填写凭据，或先清除现有凭据');
      }
      if (existingStored.credentialKind && credentialKind !== existingStored.credentialKind) {
        throw new BadRequestException('切换凭据类型时请重新填写凭据，或先清除现有凭据');
      }
    }

    const existingSecret =
      !input.clearCredential && existing?.secret
        ? decryptIntegrationCredential(existing.secret.credentialEncrypted, user.householdId, SCOPE, NAME)
        : null;
    const effectiveSecret = input.clearCredential ? null : (incomingCredential ?? existingSecret);

    if (!existing && !effectiveSecret && serverDefaultAccess?.accessScope === 'restricted') {
      throw new BadRequestException('首次配置家庭专属外部访问时必须填写完整的只读凭据');
    }
    if (serverDefaultActive && isPrimary && !effectiveSecret && isEnabled) {
      throw new BadRequestException(
        '覆盖服务器默认配置时请填写本家庭的只读凭据，或通过环境变量修改服务器默认设置',
      );
    }

    if (credentialKind === 'oauth_client' && effectiveSecret && !oauthClientId) {
      throw new BadRequestException('使用 OAuth 客户端凭据时必须填写 Client ID');
    }

    // 阶段 1 安全守门（§5.6）：提交新凭据或在启用状态下变更连接参数时，探测控制面；
    // 只要确认凭据具备写权限就拒绝保存；若控制面暂时不可达（超时/网络故障），仍允许先落配置以便排障。
    const shouldVerifyReadOnly =
      Boolean(effectiveSecret) &&
      (incomingCredential !== undefined ||
        (isEnabled &&
          (input.baseUrl !== undefined ||
            input.tailnet !== undefined ||
            input.credentialKind !== undefined ||
            input.oauthClientId !== undefined)));

    if (shouldVerifyReadOnly && effectiveSecret) {
      try {
        const probe = await probeTailscaleReadOnly({
          baseUrl,
          tailnet,
          credentialKind,
          oauthClientId,
          secret: effectiveSecret,
        });
        if (probe.permissionLevel === 'read_write') {
          throw new BadRequestException(
            '阶段 1 仅允许只读凭据（OAuth scope 仅勾选 devices:core:read），已拒绝保存具备写权限的凭据',
          );
        }
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        if (!(error instanceof TailscaleApiError)) throw error;
      }
    }

    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Integration);
      const currentRow = await repository
        .createQueryBuilder('integration')
        .leftJoinAndSelect('integration.secret', 'secret')
        .where('integration.householdId = :householdId', { householdId: user.householdId })
        .andWhere('integration.kind = :kind', { kind: KIND })
        .getOne();

      const row =
        currentRow ??
        repository.create({
          householdId: user.householdId,
          kind: KIND,
          name: NAME,
          isPrimary: false,
          capabilities: ['devices:read'],
          settings: {},
          lastSyncedAt: null,
        });

      row.baseUrl = baseUrl;
      row.isEnabled = isEnabled;
      row.lastSyncedAt = null;
      row.settings = {
        tailnet,
        publicUrl,
        nodeHostname,
        credentialKind,
        oauthClientId,
      };
      const saved = await repository.save(row);

      const secrets = manager.getRepository(IntegrationSecret);
      if (input.clearCredential) {
        if (currentRow?.secret) await secrets.delete(currentRow.secret.id);
      } else if (incomingCredential !== undefined) {
        const secret = currentRow?.secret ?? secrets.create({ integrationId: saved.id });
        secret.credentialEncrypted = encryptIntegrationCredential(
          incomingCredential,
          user.householdId,
          SCOPE,
        );
        secret.credentialHint = integrationCredentialHint(incomingCredential);
        await secrets.save(secret);
        if (currentRow) await repository.update(saved.id, { updatedAt: new Date() });
      }

      await recordActivity(manager, user, {
        module: 'system',
        action: 'external_access_settings_updated',
        summary: '更新了外部访问（Tailscale）连接设置',
        targetPath: SETTINGS_PATH,
        metadata: { kind: KIND, credentialKind, isEnabled },
      });
    });

    clearTailscaleTokenCache();
    return this.present(user);
  }

  async reset(user: JwtUser): Promise<ExternalAccessSettings> {
    await this.dataSource.transaction(async (manager) => {
      const result = await manager.getRepository(Integration).delete({
        householdId: user.householdId,
        kind: KIND,
      });
      if (!result.affected) {
        throw new NotFoundException('当前家庭没有自己的外部访问设置');
      }
      await recordActivity(manager, user, {
        module: 'system',
        action: 'external_access_settings_reset',
        summary: '恢复了外部访问（Tailscale）的服务器默认设置',
        targetPath: SETTINGS_PATH,
        metadata: { kind: KIND },
      });
    });
    clearTailscaleTokenCache();
    return this.present(user);
  }

  async lastReachableAt(householdId: string): Promise<Date | null | undefined> {
    const [row]: { lastSyncedAt: Date | null }[] = await this.dataSource.query(
      `SELECT "lastSyncedAt" FROM integrations WHERE "householdId" = $1 AND kind = $2`,
      [householdId, KIND],
    );
    return row ? row.lastSyncedAt : undefined;
  }

  async markReachable(householdId: string, at: Date) {
    await this.dataSource.query(
      `UPDATE integrations SET "lastSyncedAt" = $3 WHERE "householdId" = $1 AND kind = $2`,
      [householdId, KIND, at],
    );
  }

  async listHouseholdsForPoll(): Promise<
    { householdId: string; role: MemberRole; mode: ExternalAccessMode }[]
  > {
    const rows: { householdId: string }[] = await this.dataSource.query(
      `SELECT i."householdId" AS "householdId"
         FROM integrations i
         JOIN integration_secrets s ON s."integrationId" = i.id
        WHERE i.kind = $1 AND i."isEnabled" = true`,
      [KIND],
    );
    const seen = new Set(rows.map((row) => row.householdId));
    const result: { householdId: string; role: MemberRole; mode: ExternalAccessMode }[] = rows.map(
      (row) => ({ householdId: row.householdId, role: 'owner', mode: 'household' }),
    );
    if (tailscaleServerDefaultConfigured()) {
      const primary = await this.primaryAllowedHouseholdId();
      if (primary && !seen.has(primary)) {
        const [override]: { id: string }[] = await this.dataSource.query(
          `SELECT id FROM integrations WHERE "householdId" = $1 AND kind = $2 LIMIT 1`,
          [primary, KIND],
        );
        if (!override) {
          result.push({ householdId: primary, role: 'owner', mode: 'server_default' });
        }
      }
    }
    return result;
  }

  private async evaluateServerDefaultAccess(
    householdId: string,
    role: MemberRole,
  ): Promise<{ accessScope: 'server_default' | 'restricted'; accessMessage: string | null }> {
    const isPrimary = await this.isPrimaryAllowedHousehold(householdId);
    if (!isPrimary) {
      return { accessScope: 'restricted', accessMessage: RESTRICTED_HOUSEHOLD_MESSAGE };
    }
    if (tailscaleServerDefaultConfigured() && role !== 'owner') {
      return { accessScope: 'restricted', accessMessage: RESTRICTED_ADMIN_MESSAGE };
    }
    return { accessScope: 'server_default', accessMessage: null };
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
