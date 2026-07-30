import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHouseholdMediaSourceConfigs1785228000000
  implements MigrationInterface
{
  name = 'AddHouseholdMediaSourceConfigs1785228000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "household_media_source_configs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "provider" character varying(24) NOT NULL,
        "isEnabled" boolean NOT NULL DEFAULT true,
        "baseUrl" character varying(2000),
        "credentialKind" character varying(16),
        "credentialEncrypted" text,
        "credentialHint" character varying(16),
        "settings" jsonb NOT NULL DEFAULT '{}',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_household_media_source_configs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_household_media_source_configs_scope" UNIQUE ("householdId", "provider"),
        CONSTRAINT "CHK_household_media_source_configs_provider"
          CHECK ("provider" IN ('tmdb', 'douban', 'bangumi')),
        CONSTRAINT "CHK_household_media_source_configs_credential_kind"
          CHECK ("credentialKind" IS NULL OR "credentialKind" IN ('token', 'api_key')),
        CONSTRAINT "FK_household_media_source_configs_household"
          FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_household_media_source_configs_household"
      ON "household_media_source_configs" ("householdId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "household_media_source_configs"',
    );
  }
}
