import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1785226400000 implements MigrationInterface {
  name = 'InitialSchema1785226400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "members" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "avatarEmoji" character varying NOT NULL DEFAULT '🙂',
        "role" character varying NOT NULL DEFAULT 'member',
        "pin" character varying,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_members" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ingredients" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "category" character varying NOT NULL DEFAULT '其他',
        "defaultUnit" character varying NOT NULL DEFAULT '份',
        "isPantryStaple" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_ingredients" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ingredients_name_legacy" UNIQUE ("name")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dishes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "photoUrl" character varying,
        "category" character varying NOT NULL DEFAULT '荤菜',
        "difficulty" integer NOT NULL DEFAULT 1,
        "estMinutes" integer,
        "note" character varying,
        "recipeSteps" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "referenceLinks" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdBy" uuid,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_dishes" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dish_ingredients" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "dishId" uuid NOT NULL,
        "ingredientId" uuid NOT NULL,
        "quantity" numeric(10,2) NOT NULL DEFAULT 1,
        "unit" character varying NOT NULL DEFAULT '份',
        CONSTRAINT "PK_dish_ingredients" PRIMARY KEY ("id"),
        CONSTRAINT "FK_2421c4c7496b67cf6211c6b7c4b" FOREIGN KEY ("dishId")
          REFERENCES "dishes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_36a5d4baef5ddf0e9f7a9b9b038" FOREIGN KEY ("ingredientId")
          REFERENCES "ingredients"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "menus" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "date" date NOT NULL,
        "mealType" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'open',
        CONSTRAINT "PK_menus" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_menus_date_meal_legacy" UNIQUE ("date", "mealType")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "menu_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "menuId" uuid NOT NULL,
        "dishId" uuid NOT NULL,
        "requestedById" uuid NOT NULL,
        "note" character varying,
        "status" character varying NOT NULL DEFAULT 'pending',
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_menu_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_a6b42bf45dbdef19cbf05a4cacf" FOREIGN KEY ("menuId")
          REFERENCES "menus"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_037d26d0e12b19e0b9e6d0bd6fd" FOREIGN KEY ("dishId")
          REFERENCES "dishes"("id"),
        CONSTRAINT "FK_d1a44683ed9d4672028be559472" FOREIGN KEY ("requestedById")
          REFERENCES "members"("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "shopping_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "date" date NOT NULL,
        "ingredientId" uuid,
        "customName" character varying,
        "totalQty" numeric(10,2),
        "unit" character varying,
        "checked" boolean NOT NULL DEFAULT false,
        "source" character varying NOT NULL DEFAULT 'auto',
        CONSTRAINT "PK_shopping_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_5aaa346328d071175cc0903b902" FOREIGN KEY ("ingredientId")
          REFERENCES "ingredients"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "inventory_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "category" character varying NOT NULL DEFAULT '其他',
        "quantity" numeric(10,2) NOT NULL DEFAULT 0,
        "unit" character varying NOT NULL DEFAULT '份',
        "lowStockThreshold" numeric(10,2) NOT NULL DEFAULT 1,
        "restockQuantity" numeric(10,2) NOT NULL DEFAULT 1,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inventory_items" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_inventory_name_legacy" UNIQUE ("name")
      )
    `);

    await queryRunner.query(
      'ALTER TABLE "dishes" ADD COLUMN IF NOT EXISTS "recipeSteps" jsonb NOT NULL DEFAULT \'[]\'::jsonb',
    );
    await queryRunner.query(
      'ALTER TABLE "dishes" ADD COLUMN IF NOT EXISTS "referenceLinks" jsonb NOT NULL DEFAULT \'[]\'::jsonb',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "inventory_items" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "shopping_items" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "menu_items" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "menus" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "dish_ingredients" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "dishes" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "ingredients" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "members" CASCADE');
  }
}
