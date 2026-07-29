import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHouseholdTasks1785227200000 implements MigrationInterface {
  name = 'AddHouseholdTasks1785227200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "household_tasks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "title" character varying(120) NOT NULL,
        "note" character varying(1000),
        "startsOn" date NOT NULL,
        "recurrence" character varying NOT NULL DEFAULT 'once',
        "repeatInterval" integer NOT NULL DEFAULT 1,
        "endsOn" date,
        "createdById" uuid NOT NULL,
        "defaultAssigneeId" uuid,
        "isArchived" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_household_tasks" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_household_tasks_recurrence"
          CHECK ("recurrence" IN ('once', 'daily', 'weekly', 'monthly')),
        CONSTRAINT "CHK_household_tasks_interval"
          CHECK ("repeatInterval" >= 1 AND "repeatInterval" <= 365),
        CONSTRAINT "CHK_household_tasks_date_range"
          CHECK ("endsOn" IS NULL OR "endsOn" >= "startsOn"),
        CONSTRAINT "FK_household_tasks_household" FOREIGN KEY ("householdId")
          REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_household_tasks_created_by" FOREIGN KEY ("createdById")
          REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_household_tasks_default_assignee" FOREIGN KEY ("defaultAssigneeId")
          REFERENCES "members"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_household_tasks_household_active"
      ON "household_tasks" ("householdId", "isArchived", "startsOn")
    `);

    await queryRunner.query(`
      CREATE TABLE "household_task_instances" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "taskId" uuid NOT NULL,
        "dueDate" date NOT NULL,
        "assigneeId" uuid,
        "status" character varying NOT NULL DEFAULT 'pending',
        "resolvedById" uuid,
        "resolvedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_household_task_instances" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_household_task_instances_status"
          CHECK ("status" IN ('pending', 'done', 'skipped')),
        CONSTRAINT "UQ_household_task_instances_task_date"
          UNIQUE ("taskId", "dueDate"),
        CONSTRAINT "FK_household_task_instances_household" FOREIGN KEY ("householdId")
          REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_household_task_instances_task" FOREIGN KEY ("taskId")
          REFERENCES "household_tasks"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_household_task_instances_assignee" FOREIGN KEY ("assigneeId")
          REFERENCES "members"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_household_task_instances_resolved_by" FOREIGN KEY ("resolvedById")
          REFERENCES "members"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_household_task_instances_household_date"
      ON "household_task_instances" ("householdId", "dueDate", "status")
    `);

    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "recipientId" uuid NOT NULL,
        "module" character varying NOT NULL,
        "type" character varying(64) NOT NULL,
        "sourceId" uuid,
        "title" character varying(160) NOT NULL,
        "body" character varying(500),
        "targetPath" character varying(500) NOT NULL,
        "readAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_notifications_module"
          CHECK ("module" IN ('menu', 'task', 'calendar', 'system')),
        CONSTRAINT "FK_notifications_household" FOREIGN KEY ("householdId")
          REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_notifications_recipient" FOREIGN KEY ("recipientId")
          REFERENCES "members"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_recipient_read"
      ON "notifications" ("recipientId", "readAt", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_household_source"
      ON "notifications" ("householdId", "module", "sourceId")
    `);

    await queryRunner.query(`
      INSERT INTO "notifications"
        ("householdId", "recipientId", "module", "type", "sourceId",
         "title", "body", "targetPath", "createdAt")
      SELECT event."householdId", event."recipientId", 'menu',
        'menu_item_rejected', event."id",
        LEFT(actor."name" || ' 划掉了你点的「' || dish."name" || '」', 160),
        LEFT(CASE
          WHEN event."reason" IS NULL THEN menu."date"::text
          ELSE menu."date"::text || ' · ' || event."reason"
        END, 500),
        '/kitchen?date=' || menu."date"::text || '&mealType=' || menu."mealType",
        event."createdAt"
      FROM "menu_events" event
      JOIN "members" actor ON actor."id" = event."actorId"
      JOIN "menu_items" item ON item."id" = event."menuItemId"
      JOIN "dishes" dish ON dish."id" = item."dishId"
      JOIN "menus" menu ON menu."id" = event."menuId"
      WHERE event."recipientId" IS NOT NULL AND event."readAt" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "notifications"');
    await queryRunner.query('DROP TABLE IF EXISTS "household_task_instances"');
    await queryRunner.query('DROP TABLE IF EXISTS "household_tasks"');
  }
}
