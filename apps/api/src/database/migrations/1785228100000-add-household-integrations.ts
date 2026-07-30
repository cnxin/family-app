import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHouseholdIntegrations1785228100000
  implements MigrationInterface
{
  name = 'AddHouseholdIntegrations1785228100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "integrations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "kind" character varying(48) NOT NULL,
        "name" character varying(120) NOT NULL,
        "isEnabled" boolean NOT NULL DEFAULT true,
        "baseUrl" character varying(2000),
        "isPrimary" boolean NOT NULL DEFAULT false,
        "capabilities" jsonb NOT NULL DEFAULT '[]',
        "settings" jsonb NOT NULL DEFAULT '{}',
        "lastSyncedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_integrations" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_integrations_household_kind" UNIQUE ("householdId", "kind"),
        CONSTRAINT "FK_integrations_household"
          FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_integrations_household"
      ON "integrations" ("householdId")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_integrations_household_primary_library"
      ON "integrations" ("householdId")
      WHERE "isPrimary" = true AND "kind" IN ('plex', 'emby')
    `);
    await queryRunner.query(`
      CREATE TABLE "integration_secrets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "integrationId" uuid NOT NULL,
        "credentialEncrypted" text NOT NULL,
        "credentialHint" character varying(16) NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_integration_secrets" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_integration_secrets_integration" UNIQUE ("integrationId"),
        CONSTRAINT "FK_integration_secrets_integration"
          FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "integration_secrets"');
    await queryRunner.query('DROP TABLE IF EXISTS "integrations"');
  }
}
