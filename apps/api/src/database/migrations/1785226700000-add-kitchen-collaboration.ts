import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKitchenCollaboration1785226700000
  implements MigrationInterface
{
  name = 'AddKitchenCollaboration1785226700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "members" ADD COLUMN "prefersCooking" boolean NOT NULL DEFAULT false',
    );
    await queryRunner.query(
      `UPDATE "members" SET "prefersCooking" = true, "role" = 'owner' WHERE "role" = 'chef'`,
    );
    await queryRunner.query(`
      WITH households_without_owner AS (
        SELECT "householdId"
        FROM "members"
        GROUP BY "householdId"
        HAVING bool_or("role" = 'owner') = false
      ), first_members AS (
        SELECT DISTINCT ON (member."householdId") member."id"
        FROM "members" member
        INNER JOIN households_without_owner household
          ON household."householdId" = member."householdId"
        ORDER BY member."householdId", member."createdAt", member."id"
      )
      UPDATE "members"
      SET "role" = 'owner'
      WHERE "id" IN (SELECT "id" FROM first_members)
    `);
    await queryRunner.query(`
      ALTER TABLE "members"
      ADD CONSTRAINT "CHK_members_role"
      CHECK ("role" IN ('owner', 'admin', 'member'))
    `);

    await queryRunner.query(
      'ALTER TABLE "menus" ADD COLUMN "chefId" uuid',
    );
    await queryRunner.query(
      'ALTER TABLE "menus" ADD COLUMN "completedAt" timestamp',
    );
    await queryRunner.query(
      'ALTER TABLE "menus" ADD COLUMN "completedById" uuid',
    );
    await queryRunner.query(`
      ALTER TABLE "menus"
      ADD CONSTRAINT "CHK_menus_status"
      CHECK ("status" IN ('open', 'done'))
    `);
    await queryRunner.query(`
      ALTER TABLE "menus"
      ADD CONSTRAINT "FK_menus_chef"
      FOREIGN KEY ("chefId") REFERENCES "members"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "menus"
      ADD CONSTRAINT "FK_menus_completed_by"
      FOREIGN KEY ("completedById") REFERENCES "members"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(
      'ALTER TABLE "menu_items" ADD COLUMN "statusReason" character varying',
    );
    await queryRunner.query(
      'ALTER TABLE "menu_items" ADD COLUMN "assignedToId" uuid',
    );
    await queryRunner.query(`
      ALTER TABLE "menu_items"
      ADD CONSTRAINT "FK_menu_items_assigned_to"
      FOREIGN KEY ("assignedToId") REFERENCES "members"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "menu_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "menuId" uuid NOT NULL,
        "menuItemId" uuid,
        "actorId" uuid NOT NULL,
        "recipientId" uuid,
        "type" character varying NOT NULL,
        "fromValue" character varying,
        "toValue" character varying,
        "reason" character varying,
        "readAt" timestamp,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_menu_events" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_menu_events_type" CHECK (
          "type" IN (
            'item_ordered',
            'item_status_changed',
            'item_assigned',
            'item_note_changed',
            'meal_chef_assigned',
            'menu_completed'
          )
        ),
        CONSTRAINT "FK_menu_events_household" FOREIGN KEY ("householdId")
          REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_menu_events_menu" FOREIGN KEY ("menuId")
          REFERENCES "menus"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_menu_events_item" FOREIGN KEY ("menuItemId")
          REFERENCES "menu_items"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_menu_events_actor" FOREIGN KEY ("actorId")
          REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_menu_events_recipient" FOREIGN KEY ("recipientId")
          REFERENCES "members"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_menu_events_household_menu" ON "menu_events" ("householdId", "menuId")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_menu_events_recipient_read" ON "menu_events" ("recipientId", "readAt")',
    );

    await queryRunner.query(`
      INSERT INTO "menu_events" (
        "householdId",
        "menuId",
        "menuItemId",
        "actorId",
        "type",
        "toValue",
        "createdAt"
      )
      SELECT
        menu."householdId",
        item."menuId",
        item."id",
        item."requestedById",
        'item_ordered',
        'pending',
        item."createdAt"
      FROM "menu_items" item
      INNER JOIN "menus" menu ON menu."id" = item."menuId"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "menu_events"');

    await queryRunner.query(
      'ALTER TABLE "menu_items" DROP CONSTRAINT IF EXISTS "FK_menu_items_assigned_to"',
    );
    await queryRunner.query(
      'ALTER TABLE "menu_items" DROP COLUMN IF EXISTS "assignedToId"',
    );
    await queryRunner.query(
      'ALTER TABLE "menu_items" DROP COLUMN IF EXISTS "statusReason"',
    );

    await queryRunner.query(
      'ALTER TABLE "menus" DROP CONSTRAINT IF EXISTS "FK_menus_completed_by"',
    );
    await queryRunner.query(
      'ALTER TABLE "menus" DROP CONSTRAINT IF EXISTS "FK_menus_chef"',
    );
    await queryRunner.query(
      'ALTER TABLE "menus" DROP CONSTRAINT IF EXISTS "CHK_menus_status"',
    );
    await queryRunner.query(
      'ALTER TABLE "menus" DROP COLUMN IF EXISTS "completedById"',
    );
    await queryRunner.query(
      'ALTER TABLE "menus" DROP COLUMN IF EXISTS "completedAt"',
    );
    await queryRunner.query(
      'ALTER TABLE "menus" DROP COLUMN IF EXISTS "chefId"',
    );

    await queryRunner.query(
      'ALTER TABLE "members" DROP CONSTRAINT IF EXISTS "CHK_members_role"',
    );
    await queryRunner.query(`
      UPDATE "members"
      SET "role" = CASE WHEN "prefersCooking" THEN 'chef' ELSE 'member' END
    `);
    await queryRunner.query(
      'ALTER TABLE "members" DROP COLUMN IF EXISTS "prefersCooking"',
    );
  }
}
