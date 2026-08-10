import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentChannelBindings1785230900000
  implements MigrationInterface
{
  name = 'AddAgentChannelBindings1785230900000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "agent_member_channels" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "memberId" uuid NOT NULL,
        "platform" character varying(32) NOT NULL,
        "externalAccountRefHash" character varying(64) NOT NULL,
        "externalAccountLabel" character varying(120),
        "externalAccountHint" character varying(32),
        "pairedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(),
        "lastUsedAt" TIMESTAMP WITH TIME ZONE,
        "revokedAt" TIMESTAMP WITH TIME ZONE,
        "version" integer NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_member_channels" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_agent_member_channels_platform" CHECK ("platform" ~ '^[a-z0-9][a-z0-9._-]{1,31}$'),
        CONSTRAINT "CHK_agent_member_channels_version" CHECK ("version" >= 1),
        CONSTRAINT "FK_agent_member_channels_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agent_member_channels_member" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_agent_member_channels_active_external"
      ON "agent_member_channels" ("householdId", "platform", "externalAccountRefHash")
      WHERE "revokedAt" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_agent_member_channels_household_member"
      ON "agent_member_channels" ("householdId", "memberId", "revokedAt")
    `);

    await queryRunner.query(`
      CREATE TABLE "agent_channel_pairings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "memberId" uuid NOT NULL,
        "createdByMemberId" uuid NOT NULL,
        "platform" character varying(32) NOT NULL,
        "codeHash" character varying(64) NOT NULL,
        "idempotencyKey" character varying(180) NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "usedAt" TIMESTAMP WITH TIME ZONE,
        "revokedAt" TIMESTAMP WITH TIME ZONE,
        "channelId" uuid,
        "version" integer NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_channel_pairings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_agent_channel_pairings_platform" CHECK ("platform" ~ '^[a-z0-9][a-z0-9._-]{1,31}$'),
        CONSTRAINT "CHK_agent_channel_pairings_version" CHECK ("version" >= 1),
        CONSTRAINT "FK_agent_channel_pairings_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agent_channel_pairings_member" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_agent_channel_pairings_created_by" FOREIGN KEY ("createdByMemberId") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_agent_channel_pairings_channel" FOREIGN KEY ("channelId") REFERENCES "agent_member_channels"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_agent_channel_pairings_code"
      ON "agent_channel_pairings" ("codeHash")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_agent_channel_pairings_household_idempotency"
      ON "agent_channel_pairings" ("householdId", "idempotencyKey")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_agent_channel_pairings_household_status"
      ON "agent_channel_pairings" ("householdId", "memberId", "revokedAt", "usedAt", "expiresAt")
    `);

    await queryRunner.query(
      `ALTER TABLE "agent_conversations" DROP CONSTRAINT "CHK_agent_conversations_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" ADD "channelId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" ADD "externalThreadRefHash" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" ADD CONSTRAINT "CHK_agent_conversations_source" CHECK ("source" IN ('app', 'channel'))`,
    );
    await queryRunner.query(`
      ALTER TABLE "agent_conversations"
      ADD CONSTRAINT "FK_agent_conversations_channel"
      FOREIGN KEY ("channelId") REFERENCES "agent_member_channels"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_agent_conversations_channel_thread"
      ON "agent_conversations" ("householdId", "channelId", "externalThreadRefHash")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_agent_conversations_channel_thread"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" DROP CONSTRAINT IF EXISTS "FK_agent_conversations_channel"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" DROP CONSTRAINT IF EXISTS "CHK_agent_conversations_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" ADD CONSTRAINT "CHK_agent_conversations_source" CHECK ("source" IN ('app'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" DROP COLUMN IF EXISTS "externalThreadRefHash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_conversations" DROP COLUMN IF EXISTS "channelId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_channel_pairings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_member_channels"`);
  }
}
