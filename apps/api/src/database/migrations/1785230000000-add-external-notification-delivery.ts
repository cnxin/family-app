import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExternalNotificationDelivery1785230000000
  implements MigrationInterface
{
  name = 'AddExternalNotificationDelivery1785230000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD "externalRoutedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `UPDATE "notifications" SET "externalRoutedAt" = now() WHERE "externalRoutedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_external_route" ON "notifications" ("createdAt") WHERE "externalRoutedAt" IS NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "notification_channels" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "kind" character varying(24) NOT NULL,
        "endpointEncrypted" text NOT NULL,
        "endpointHint" character varying(255) NOT NULL,
        "credentialEncrypted" text,
        "credentialHint" character varying(16),
        "isEnabled" boolean NOT NULL DEFAULT true,
        "createdById" uuid,
        "lastTestedAt" TIMESTAMP WITH TIME ZONE,
        "lastTestStatus" character varying(16),
        "lastTestError" character varying(160),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_channels" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_notification_channels_household_name" UNIQUE ("householdId", "name"),
        CONSTRAINT "CHK_notification_channels_kind" CHECK ("kind" IN ('webhook', 'ntfy')),
        CONSTRAINT "CHK_notification_channels_test_status" CHECK ("lastTestStatus" IS NULL OR "lastTestStatus" IN ('success', 'failed')),
        CONSTRAINT "FK_notification_channels_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_notification_channels_created_by" FOREIGN KEY ("createdById") REFERENCES "members"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_channels_household_enabled" ON "notification_channels" ("householdId", "isEnabled", "createdAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE "member_notification_preferences" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "memberId" uuid NOT NULL,
        "channelId" uuid NOT NULL,
        "isEnabled" boolean NOT NULL DEFAULT false,
        "modules" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_member_notification_preferences" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_member_notification_preferences_member_channel" UNIQUE ("memberId", "channelId"),
        CONSTRAINT "FK_member_notification_preferences_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_member_notification_preferences_member" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_member_notification_preferences_channel" FOREIGN KEY ("channelId") REFERENCES "notification_channels"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_member_notification_preferences_route" ON "member_notification_preferences" ("householdId", "memberId", "isEnabled")`,
    );

    await queryRunner.query(`
      CREATE TABLE "notification_deliveries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "notificationId" uuid NOT NULL,
        "recipientId" uuid NOT NULL,
        "channelId" uuid,
        "channelName" character varying(120) NOT NULL,
        "channelKind" character varying(24) NOT NULL,
        "endpointHint" character varying(255) NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'pending',
        "attemptCount" integer NOT NULL DEFAULT 0,
        "maxAttempts" integer NOT NULL DEFAULT 4,
        "nextAttemptAt" TIMESTAMP WITH TIME ZONE,
        "lastAttemptAt" TIMESTAMP WITH TIME ZONE,
        "deliveredAt" TIMESTAMP WITH TIME ZONE,
        "lastError" character varying(160),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_deliveries" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_notification_deliveries_notification_channel" UNIQUE ("notificationId", "channelId"),
        CONSTRAINT "CHK_notification_deliveries_status" CHECK ("status" IN ('pending', 'processing', 'retry_scheduled', 'sent', 'failed')),
        CONSTRAINT "CHK_notification_deliveries_attempts" CHECK ("attemptCount" >= 0 AND "maxAttempts" >= 1),
        CONSTRAINT "CHK_notification_deliveries_channel_kind" CHECK ("channelKind" IN ('webhook', 'ntfy')),
        CONSTRAINT "FK_notification_deliveries_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_notification_deliveries_notification" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_notification_deliveries_recipient" FOREIGN KEY ("recipientId") REFERENCES "members"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_notification_deliveries_channel" FOREIGN KEY ("channelId") REFERENCES "notification_channels"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_deliveries_dispatch" ON "notification_deliveries" ("nextAttemptAt", "createdAt") WHERE "status" IN ('pending', 'retry_scheduled')`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_deliveries_household_history" ON "notification_deliveries" ("householdId", "recipientId", "createdAt" DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE "notification_delivery_attempts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "deliveryId" uuid NOT NULL,
        "attemptNumber" integer NOT NULL,
        "status" character varying(16) NOT NULL,
        "httpStatus" integer,
        "errorCode" character varying(48),
        "errorMessage" character varying(160),
        "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "finishedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_delivery_attempts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_notification_delivery_attempts_number" UNIQUE ("deliveryId", "attemptNumber"),
        CONSTRAINT "CHK_notification_delivery_attempts_status" CHECK ("status" IN ('sent', 'failed')),
        CONSTRAINT "CHK_notification_delivery_attempts_number" CHECK ("attemptNumber" >= 1),
        CONSTRAINT "FK_notification_delivery_attempts_delivery" FOREIGN KEY ("deliveryId") REFERENCES "notification_deliveries"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_delivery_attempts_delivery_created" ON "notification_delivery_attempts" ("deliveryId", "createdAt" DESC)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notification_delivery_attempts"`);
    await queryRunner.query(`DROP TABLE "notification_deliveries"`);
    await queryRunner.query(`DROP TABLE "member_notification_preferences"`);
    await queryRunner.query(`DROP TABLE "notification_channels"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notifications_external_route"`);
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP COLUMN "externalRoutedAt"`,
    );
  }
}
