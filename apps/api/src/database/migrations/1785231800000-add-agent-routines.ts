import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentRoutines1785231800000 implements MigrationInterface {
  name = 'AddAgentRoutines1785231800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agent_settings"
      ADD "dailyRoutineNotificationLimit" integer NOT NULL DEFAULT 3
    `);
    await queryRunner.query(`
      ALTER TABLE "agent_settings"
      ADD "routineNotificationsEnabled" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "agent_settings"
      ADD CONSTRAINT "CHK_agent_settings_daily_routine_notification_limit"
      CHECK ("dailyRoutineNotificationLimit" BETWEEN 0 AND 50)
    `);

    await queryRunner.query(`
      CREATE TABLE "agent_routines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "kind" character varying(32) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        "scheduleHour" integer NOT NULL DEFAULT 21,
        "scheduleMinute" integer NOT NULL DEFAULT 0,
        "lastRunAt" TIMESTAMP WITH TIME ZONE,
        "nextRunAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_routines" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_agent_routines_household_kind" UNIQUE ("householdId", "kind"),
        CONSTRAINT "CHK_agent_routines_kind" CHECK ("kind" IN ('nightly_digest')),
        CONSTRAINT "CHK_agent_routines_schedule_hour" CHECK ("scheduleHour" BETWEEN 0 AND 23),
        CONSTRAINT "CHK_agent_routines_schedule_minute" CHECK ("scheduleMinute" BETWEEN 0 AND 59),
        CONSTRAINT "CHK_agent_routines_version" CHECK ("version" >= 1),
        CONSTRAINT "FK_agent_routines_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_agent_routines_next_run"
      ON "agent_routines" ("nextRunAt")
    `);

    await queryRunner.query(`
      CREATE TABLE "agent_routine_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "routineKind" character varying(32) NOT NULL,
        "sourceType" character varying(40) NOT NULL,
        "sourceId" character varying(120) NOT NULL,
        "summary" character varying(200) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "digestedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_agent_routine_items" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_agent_routine_items_kind" CHECK ("routineKind" IN ('nightly_digest')),
        CONSTRAINT "CHK_agent_routine_items_status" CHECK ("status" IN ('pending', 'digested', 'expired')),
        CONSTRAINT "FK_agent_routine_items_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_agent_routine_items_pending"
      ON "agent_routine_items" ("householdId", "routineKind")
      WHERE "status" = 'pending'
    `);

    await queryRunner.query(`
      INSERT INTO "agent_routines" (
        "householdId", "kind", "enabled", "scheduleHour", "scheduleMinute", "nextRunAt"
      )
      SELECT household.id, 'nightly_digest', false, 21, 0,
        CASE
          WHEN (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::time < TIME '21:00'
            THEN (((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date + TIME '21:00') AT TIME ZONE 'Asia/Shanghai')
          ELSE (((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date + 1 + TIME '21:00') AT TIME ZONE 'Asia/Shanghai')
        END
      FROM "households" AS household
      ON CONFLICT ("householdId", "kind") DO NOTHING
    `);

    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "CHK_notifications_module"`,
    );
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD CONSTRAINT "CHK_notifications_module"
      CHECK ("module" IN ('menu', 'task', 'poll', 'calendar', 'reminder', 'media', 'guest', 'points', 'agent', 'system'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "notifications" WHERE "module" = 'agent'`);
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "CHK_notifications_module"`,
    );
    await queryRunner.query(`
      ALTER TABLE "notifications"
      ADD CONSTRAINT "CHK_notifications_module"
      CHECK ("module" IN ('menu', 'task', 'poll', 'calendar', 'reminder', 'media', 'guest', 'points', 'system'))
    `);
    await queryRunner.query(`DROP TABLE "agent_routine_items"`);
    await queryRunner.query(`DROP TABLE "agent_routines"`);
    await queryRunner.query(`
      ALTER TABLE "agent_settings"
      DROP CONSTRAINT "CHK_agent_settings_daily_routine_notification_limit"
    `);
    await queryRunner.query(
      `ALTER TABLE "agent_settings" DROP COLUMN "routineNotificationsEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_settings" DROP COLUMN "dailyRoutineNotificationLimit"`,
    );
  }
}
