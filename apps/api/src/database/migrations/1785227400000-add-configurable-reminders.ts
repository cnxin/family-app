import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConfigurableReminders1785227400000 implements MigrationInterface {
  name = 'AddConfigurableReminders1785227400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP CONSTRAINT "CHK_notifications_module"
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD CONSTRAINT "CHK_notifications_module"
      CHECK ("module" IN ('menu', 'task', 'poll', 'calendar', 'reminder', 'system'))
    `);

    await queryRunner.query(`
      CREATE TABLE "reminders" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "sourceModule" character varying NOT NULL,
        "sourceId" uuid NOT NULL,
        "occurrenceDate" date,
        "remindAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "status" character varying NOT NULL DEFAULT 'scheduled',
        "createdById" uuid NOT NULL,
        "sentAt" TIMESTAMP WITH TIME ZONE,
        "cancelledAt" TIMESTAMP WITH TIME ZONE,
        "cancelReason" character varying(120),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reminders" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_reminders_source_module"
          CHECK ("sourceModule" IN ('menu', 'task', 'calendar', 'poll')),
        CONSTRAINT "CHK_reminders_status"
          CHECK ("status" IN ('scheduled', 'sent', 'cancelled')),
        CONSTRAINT "CHK_reminders_occurrence_date"
          CHECK (("sourceModule" = 'task' AND "occurrenceDate" IS NOT NULL)
            OR ("sourceModule" <> 'task' AND "occurrenceDate" IS NULL)),
        CONSTRAINT "FK_reminders_household" FOREIGN KEY ("householdId")
          REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_reminders_created_by" FOREIGN KEY ("createdById")
          REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_reminders_household_status"
      ON "reminders" ("householdId", "status", "remindAt")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_reminders_due"
      ON "reminders" ("status", "remindAt")
    `);

    await queryRunner.query(`
      CREATE TABLE "reminder_recipients" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "reminderId" uuid NOT NULL,
        "memberId" uuid NOT NULL,
        "notificationId" uuid,
        "deliveredAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reminder_recipients" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_reminder_recipients_reminder_member"
          UNIQUE ("reminderId", "memberId"),
        CONSTRAINT "FK_reminder_recipients_household" FOREIGN KEY ("householdId")
          REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_reminder_recipients_reminder" FOREIGN KEY ("reminderId")
          REFERENCES "reminders"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_reminder_recipients_member" FOREIGN KEY ("memberId")
          REFERENCES "members"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_reminder_recipients_notification" FOREIGN KEY ("notificationId")
          REFERENCES "notifications"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_reminder_recipients_pending"
      ON "reminder_recipients" ("reminderId", "deliveredAt")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "reminder_recipients"');
    await queryRunner.query('DROP TABLE IF EXISTS "reminders"');
    await queryRunner.query(`
      ALTER TABLE "notifications"
      DROP CONSTRAINT "CHK_notifications_module"
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD CONSTRAINT "CHK_notifications_module"
      CHECK ("module" IN ('menu', 'task', 'poll', 'calendar', 'system'))
    `);
  }
}
