import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  DEFAULT_HOUSEHOLD_ID,
  DEFAULT_HOUSEHOLD_SLUG,
} from '../database.constants';

const HOUSEHOLD_TABLES = [
  'members',
  'ingredients',
  'dishes',
  'menus',
  'shopping_items',
  'inventory_items',
];

export class AddHouseholdScope1785226500000 implements MigrationInterface {
  name = 'AddHouseholdScope1785226500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "households" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "slug" character varying NOT NULL,
        "timezone" character varying NOT NULL DEFAULT 'Asia/Shanghai',
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_households" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_households_slug" UNIQUE ("slug")
      )
    `);
    await queryRunner.query(
      `INSERT INTO "households" ("id", "name", "slug") VALUES ($1, $2, $3) ON CONFLICT ("id") DO NOTHING`,
      [DEFAULT_HOUSEHOLD_ID, '我的家', DEFAULT_HOUSEHOLD_SLUG],
    );

    for (const table of HOUSEHOLD_TABLES) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "householdId" uuid`,
      );
      await queryRunner.query(
        `UPDATE "${table}" SET "householdId" = $1 WHERE "householdId" IS NULL`,
        [DEFAULT_HOUSEHOLD_ID],
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "householdId" SET NOT NULL`,
      );
      await queryRunner.query(`
        ALTER TABLE "${table}"
        ADD CONSTRAINT "FK_${table}_household"
        FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT
      `);
    }

    await queryRunner.query(
      'ALTER TABLE "ingredients" DROP CONSTRAINT IF EXISTS "UQ_a955029b22ff66ae9fef2e161f8"',
    );
    await queryRunner.query(
      'ALTER TABLE "ingredients" DROP CONSTRAINT IF EXISTS "UQ_ingredients_name_legacy"',
    );
    await queryRunner.query(
      'ALTER TABLE "inventory_items" DROP CONSTRAINT IF EXISTS "UQ_85aeabfff4e52ffadb8bbe76f75"',
    );
    await queryRunner.query(
      'ALTER TABLE "inventory_items" DROP CONSTRAINT IF EXISTS "UQ_inventory_name_legacy"',
    );
    await queryRunner.query(
      'ALTER TABLE "menus" DROP CONSTRAINT IF EXISTS "UQ_858b134a15e7510e50b096c74c8"',
    );
    await queryRunner.query(
      'ALTER TABLE "menus" DROP CONSTRAINT IF EXISTS "UQ_menus_date_meal_legacy"',
    );

    await queryRunner.query(`
      ALTER TABLE "ingredients"
      ADD CONSTRAINT "UQ_ingredients_household_name" UNIQUE ("householdId", "name")
    `);
    await queryRunner.query(`
      ALTER TABLE "inventory_items"
      ADD CONSTRAINT "UQ_inventory_household_name" UNIQUE ("householdId", "name")
    `);
    await queryRunner.query(`
      ALTER TABLE "menus"
      ADD CONSTRAINT "UQ_menus_household_date_meal" UNIQUE ("householdId", "date", "mealType")
    `);

    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_members_household" ON "members" ("householdId")',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_ingredients_household" ON "ingredients" ("householdId")',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_dishes_household_active" ON "dishes" ("householdId", "isActive")',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_menus_household_date" ON "menus" ("householdId", "date")',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_shopping_household_date" ON "shopping_items" ("householdId", "date")',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_inventory_household" ON "inventory_items" ("householdId")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_inventory_household"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_shopping_household_date"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_menus_household_date"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_dishes_household_active"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_ingredients_household"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_members_household"');

    await queryRunner.query(
      'ALTER TABLE "menus" DROP CONSTRAINT IF EXISTS "UQ_menus_household_date_meal"',
    );
    await queryRunner.query(
      'ALTER TABLE "inventory_items" DROP CONSTRAINT IF EXISTS "UQ_inventory_household_name"',
    );
    await queryRunner.query(
      'ALTER TABLE "ingredients" DROP CONSTRAINT IF EXISTS "UQ_ingredients_household_name"',
    );
    await queryRunner.query(
      'ALTER TABLE "menus" ADD CONSTRAINT "UQ_menus_date_meal_legacy" UNIQUE ("date", "mealType")',
    );
    await queryRunner.query(
      'ALTER TABLE "inventory_items" ADD CONSTRAINT "UQ_inventory_name_legacy" UNIQUE ("name")',
    );
    await queryRunner.query(
      'ALTER TABLE "ingredients" ADD CONSTRAINT "UQ_ingredients_name_legacy" UNIQUE ("name")',
    );

    for (const table of [...HOUSEHOLD_TABLES].reverse()) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "FK_${table}_household"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "householdId"`,
      );
    }
    await queryRunner.query('DROP TABLE IF EXISTS "households"');
  }
}
