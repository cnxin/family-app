import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecipeVariants1785227100000 implements MigrationInterface {
  name = 'AddRecipeVariants1785227100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "dish_recipe_variants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "dishId" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "authorMemberId" uuid,
        "isDefault" boolean NOT NULL DEFAULT false,
        "isArchived" boolean NOT NULL DEFAULT false,
        "note" character varying(1000),
        "estMinutes" integer,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_dish_recipe_variants" PRIMARY KEY ("id"),
        CONSTRAINT "FK_dish_recipe_variants_household" FOREIGN KEY ("householdId")
          REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_dish_recipe_variants_dish" FOREIGN KEY ("dishId")
          REFERENCES "dishes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_dish_recipe_variants_author" FOREIGN KEY ("authorMemberId")
          REFERENCES "members"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_dish_recipe_variants_household_dish"
      ON "dish_recipe_variants" ("householdId", "dishId", "isArchived")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_dish_recipe_variants_default"
      ON "dish_recipe_variants" ("dishId")
      WHERE "isDefault" = true AND "isArchived" = false
    `);

    await queryRunner.query(`
      CREATE TABLE "dish_recipe_variant_steps" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "variantId" uuid NOT NULL,
        "position" integer NOT NULL,
        "text" character varying(2000) NOT NULL,
        "imageUrl" character varying(500),
        CONSTRAINT "PK_dish_recipe_variant_steps" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_dish_recipe_variant_steps_position"
          UNIQUE ("variantId", "position"),
        CONSTRAINT "FK_dish_recipe_variant_steps_variant" FOREIGN KEY ("variantId")
          REFERENCES "dish_recipe_variants"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "dish_recipe_variant_links" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "variantId" uuid NOT NULL,
        "position" integer NOT NULL,
        "title" character varying(120),
        "url" character varying(1000) NOT NULL,
        CONSTRAINT "PK_dish_recipe_variant_links" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_dish_recipe_variant_links_position"
          UNIQUE ("variantId", "position"),
        CONSTRAINT "FK_dish_recipe_variant_links_variant" FOREIGN KEY ("variantId")
          REFERENCES "dish_recipe_variants"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "dish_recipe_variant_ingredients" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "variantId" uuid NOT NULL,
        "ingredientId" uuid NOT NULL,
        "quantity" numeric(10,2) NOT NULL,
        "unit" character varying(32) NOT NULL,
        CONSTRAINT "PK_dish_recipe_variant_ingredients" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_dish_recipe_variant_ingredients_item"
          UNIQUE ("variantId", "ingredientId", "unit"),
        CONSTRAINT "FK_dish_recipe_variant_ingredients_variant" FOREIGN KEY ("variantId")
          REFERENCES "dish_recipe_variants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_dish_recipe_variant_ingredients_ingredient" FOREIGN KEY ("ingredientId")
          REFERENCES "ingredients"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "member_dish_skills" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "memberId" uuid NOT NULL,
        "dishId" uuid NOT NULL,
        "preferredRecipeId" uuid,
        "level" character varying NOT NULL DEFAULT 'can_cook',
        "note" character varying(500),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_member_dish_skills" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_member_dish_skills_level"
          CHECK ("level" IN ('learning', 'can_cook', 'signature')),
        CONSTRAINT "UQ_member_dish_skills_member_dish"
          UNIQUE ("householdId", "memberId", "dishId"),
        CONSTRAINT "FK_member_dish_skills_household" FOREIGN KEY ("householdId")
          REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_member_dish_skills_member" FOREIGN KEY ("memberId")
          REFERENCES "members"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_member_dish_skills_dish" FOREIGN KEY ("dishId")
          REFERENCES "dishes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_member_dish_skills_preferred_recipe" FOREIGN KEY ("preferredRecipeId")
          REFERENCES "dish_recipe_variants"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_member_dish_skills_household_member"
      ON "member_dish_skills" ("householdId", "memberId")
    `);

    await queryRunner.query(`
      INSERT INTO "dish_recipe_variants"
        ("householdId", "dishId", "name", "isDefault", "note", "estMinutes")
      SELECT "householdId", "id", '家庭默认', true, "note", "estMinutes"
      FROM "dishes"
    `);
    await queryRunner.query(`
      INSERT INTO "dish_recipe_variant_steps"
        ("variantId", "position", "text", "imageUrl")
      SELECT variant."id", step.position::integer,
        step.value->>'text', NULLIF(step.value->>'imageUrl', '')
      FROM "dishes" dish
      JOIN "dish_recipe_variants" variant
        ON variant."dishId" = dish."id" AND variant."isDefault" = true
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(dish."recipeSteps", '[]'::jsonb)
      ) WITH ORDINALITY AS step(value, position)
      WHERE COALESCE(step.value->>'text', '') <> ''
    `);
    await queryRunner.query(`
      INSERT INTO "dish_recipe_variant_links"
        ("variantId", "position", "title", "url")
      SELECT variant."id", link.position::integer,
        NULLIF(link.value->>'title', ''), link.value->>'url'
      FROM "dishes" dish
      JOIN "dish_recipe_variants" variant
        ON variant."dishId" = dish."id" AND variant."isDefault" = true
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(dish."referenceLinks", '[]'::jsonb)
      ) WITH ORDINALITY AS link(value, position)
      WHERE COALESCE(link.value->>'url', '') <> ''
    `);
    await queryRunner.query(`
      INSERT INTO "dish_recipe_variant_ingredients"
        ("variantId", "ingredientId", "quantity", "unit")
      SELECT variant."id", item."ingredientId", item."quantity", item."unit"
      FROM "dish_ingredients" item
      JOIN "dish_recipe_variants" variant
        ON variant."dishId" = item."dishId" AND variant."isDefault" = true
    `);

    await queryRunner.query(
      'ALTER TABLE "menu_items" ADD COLUMN "recipeVariantId" uuid',
    );
    await queryRunner.query(
      'ALTER TABLE "menu_items" ADD COLUMN "recipeSnapshot" jsonb',
    );
    await queryRunner.query(`
      UPDATE "menu_items" item
      SET "recipeVariantId" = variant."id"
      FROM "dish_recipe_variants" variant
      WHERE variant."dishId" = item."dishId" AND variant."isDefault" = true
    `);
    await queryRunner.query(`
      ALTER TABLE "menu_items"
      ADD CONSTRAINT "FK_menu_items_recipe_variant" FOREIGN KEY ("recipeVariantId")
      REFERENCES "dish_recipe_variants"("id") ON DELETE SET NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "menu_items" DROP CONSTRAINT IF EXISTS "FK_menu_items_recipe_variant"',
    );
    await queryRunner.query(
      'ALTER TABLE "menu_items" DROP COLUMN IF EXISTS "recipeSnapshot"',
    );
    await queryRunner.query(
      'ALTER TABLE "menu_items" DROP COLUMN IF EXISTS "recipeVariantId"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "member_dish_skills"');
    await queryRunner.query(
      'DROP TABLE IF EXISTS "dish_recipe_variant_ingredients"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "dish_recipe_variant_links"');
    await queryRunner.query('DROP TABLE IF EXISTS "dish_recipe_variant_steps"');
    await queryRunner.query('DROP TABLE IF EXISTS "dish_recipe_variants"');
  }
}
