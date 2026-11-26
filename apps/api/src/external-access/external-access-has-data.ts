import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ModuleHasDataRegistry } from '../system/module-has-data.registry';
import { ExternalAccessSettingsService } from './external-access-settings.service';
import { tailscaleServerDefaultConfigured } from './tailscale.config';

/**
 * manifest 的 hasData `{ kind: 'server', id: 'external-access.hasData' }`：
 * - 当前家庭有启用的 tailscale 集成行且凭据完整 → true；
 * - 无集成行时，仅当服务器默认已配置且本家庭是实例主家庭（或 TAILSCALE_ALLOWED_HOUSEHOLD_ID）→ true。
 */
@Injectable()
export class ExternalAccessHasDataProvider implements OnModuleInit {
  constructor(
    private readonly registry: ModuleHasDataRegistry,
    private readonly settings: ExternalAccessSettingsService,
    private readonly db: DataSource,
  ) {}

  onModuleInit() {
    this.registry.register('external-access.hasData', (householdId) => this.hasData(householdId));
  }

  private async hasData(householdId: string): Promise<boolean> {
    const rows: { isEnabled: boolean; hasSecret: boolean; kind: string | null; clientId: string | null }[] =
      await this.db.query(
        `SELECT i."isEnabled" AS "isEnabled",
                (s.id IS NOT NULL) AS "hasSecret",
                i.settings->>'credentialKind' AS "kind",
                NULLIF(TRIM(COALESCE(i.settings->>'oauthClientId', '')), '') AS "clientId"
           FROM integrations i
           LEFT JOIN integration_secrets s ON s."integrationId" = i.id
          WHERE i."householdId" = $1 AND i.kind = 'tailscale'
          LIMIT 1`,
        [householdId],
      );
    if (rows.length > 0) {
      const row = rows[0];
      if (!row.isEnabled || !row.hasSecret) return false;
      const credentialKind = row.kind === 'api_token' ? 'api_token' : 'oauth_client';
      return credentialKind === 'api_token' || Boolean(row.clientId);
    }
    if (!tailscaleServerDefaultConfigured()) return false;
    return this.settings.isPrimaryAllowedHousehold(householdId);
  }
}
