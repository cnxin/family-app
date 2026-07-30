import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIntegrationEvents1785228400000 implements MigrationInterface {
  name = 'AddIntegrationEvents1785228400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "integrations"
      ADD COLUMN "webhookSecretHash" varchar(64),
      ADD COLUMN "webhookSourceIp" varchar(64),
      ADD COLUMN "webhookUpdatedAt" timestamptz
    `);
    await queryRunner.query(`
      CREATE TABLE "integration_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "integrationId" uuid NOT NULL,
        "provider" varchar(48) NOT NULL,
        "eventType" varchar(80) NOT NULL,
        "idempotencyKey" varchar(64) NOT NULL,
        "status" varchar(24) NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}',
        "error" varchar(500),
        "mediaRequestId" uuid,
        "receivedAt" timestamptz NOT NULL DEFAULT now(),
        "processedAt" timestamptz,
        CONSTRAINT "PK_integration_events" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_integration_events_status"
          CHECK ("status" IN ('processed', 'ignored', 'failed')),
        CONSTRAINT "UQ_integration_events_idempotency"
          UNIQUE ("integrationId", "idempotencyKey"),
        CONSTRAINT "FK_integration_events_household"
          FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_integration_events_integration"
          FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_integration_events_media_request"
          FOREIGN KEY ("mediaRequestId") REFERENCES "media_requests"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_integration_events_household_received"
      ON "integration_events" ("householdId", "receivedAt")
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP CONSTRAINT "CHK_notifications_module"
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD CONSTRAINT "CHK_notifications_module"
      CHECK ("module" IN ('menu', 'task', 'poll', 'calendar', 'reminder', 'media', 'system'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP CONSTRAINT "CHK_notifications_module"
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD CONSTRAINT "CHK_notifications_module"
      CHECK ("module" IN ('menu', 'task', 'poll', 'calendar', 'reminder', 'system'))
    `);
    await queryRunner.query('DROP TABLE IF EXISTS "integration_events"');
    await queryRunner.query(`
      ALTER TABLE "integrations"
      DROP COLUMN "webhookUpdatedAt",
      DROP COLUMN "webhookSourceIp",
      DROP COLUMN "webhookSecretHash"
    `);
  }
}
