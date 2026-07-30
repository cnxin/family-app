import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaUserMappings1785228500000 implements MigrationInterface {
  name = 'AddMediaUserMappings1785228500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "media_user_mappings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "provider" varchar(32) NOT NULL,
        "connectorKey" varchar(128) NOT NULL,
        "serverId" varchar(180) NOT NULL,
        "externalUserId" varchar(180) NOT NULL,
        "externalUserName" varchar(180) NOT NULL,
        "memberId" uuid NOT NULL,
        "lastSeenAt" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_media_user_mappings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_media_user_mappings_provider"
          CHECK ("provider" IN ('plex', 'emby')),
        CONSTRAINT "UQ_media_user_mappings_external"
          UNIQUE ("householdId", "connectorKey", "serverId", "externalUserId"),
        CONSTRAINT "UQ_media_user_mappings_member"
          UNIQUE ("householdId", "connectorKey", "serverId", "memberId"),
        CONSTRAINT "FK_media_user_mappings_household"
          FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_media_user_mappings_member"
          FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_media_user_mappings_household_provider"
      ON "media_user_mappings" ("householdId", "provider")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "media_user_mappings"');
  }
}
