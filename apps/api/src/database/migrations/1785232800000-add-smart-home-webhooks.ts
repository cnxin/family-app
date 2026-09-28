import { MigrationInterface, QueryRunner } from 'typeorm';

/** H3 E3：HA → 小管家 webhook 的密钥与联动设置、事件流水（去重 + 排查）。 */
export class AddSmartHomeWebhooks1785232800000 implements MigrationInterface {
  name = 'AddSmartHomeWebhooks1785232800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "smart_home_webhook_settings" (
        "householdId" uuid NOT NULL,
        "secretEncrypted" text,
        "secretHint" character varying(16),
        "previousSecretEncrypted" text,
        "previousValidUntil" TIMESTAMP WITH TIME ZONE,
        "rotatedAt" TIMESTAMP WITH TIME ZONE,
        "rules" jsonb NOT NULL DEFAULT '{}',
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_smart_home_webhook_settings" PRIMARY KEY ("householdId"),
        CONSTRAINT "FK_smart_home_webhook_settings_household"
          FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "smart_home_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "eventId" character varying(128) NOT NULL,
        "event" character varying(32) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'processed',
        "result" character varying(300),
        "receivedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_smart_home_events" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_smart_home_events_household_event" UNIQUE ("householdId", "eventId"),
        CONSTRAINT "CHK_smart_home_events_status" CHECK ("status" IN ('processed', 'ignored', 'failed')),
        CONSTRAINT "FK_smart_home_events_household"
          FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_smart_home_events_household_received"
      ON "smart_home_events" ("householdId", "receivedAt")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "smart_home_events"');
    await queryRunner.query('DROP TABLE IF EXISTS "smart_home_webhook_settings"');
  }
}
