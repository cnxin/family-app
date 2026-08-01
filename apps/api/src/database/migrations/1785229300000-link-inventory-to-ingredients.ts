import { MigrationInterface, QueryRunner } from 'typeorm';

export class LinkInventoryToIngredients1785229300000 implements MigrationInterface {
  name = 'LinkInventoryToIngredients1785229300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inventory_items" ADD "ingredientId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_items" ADD CONSTRAINT "FK_inventory_items_ingredient" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_inventory_household_ingredient_unit" ON "inventory_items" ("householdId", "ingredientId", "unit") WHERE "ingredientId" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_items" ADD "requiredQty" numeric(10,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_items" ADD "availableQty" numeric(10,2)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shopping_items" DROP COLUMN IF EXISTS "availableQty"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_items" DROP COLUMN IF EXISTS "requiredQty"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_inventory_household_ingredient_unit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_items" DROP CONSTRAINT IF EXISTS "FK_inventory_items_ingredient"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "ingredientId"`,
    );
  }
}
