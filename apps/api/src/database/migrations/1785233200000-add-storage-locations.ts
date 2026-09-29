import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I1 位置字典（docs/item-location-plan.md §2.1、§2.3）：storage_locations 三级树 + 库存物品默认位置、批次位置、资产位置。
 * 同一层里没归档的不重名（根与子各一个部分唯一索引）；系统节点「未整理」每家至多一个。
 * 引用一律 RESTRICT：有引用的位置只能归档。mapShape 给 I2 地图留着，I1 不写。
 * 资产的旧 location 文本不动，也不自动迁移（详情里「整理到位置」手动归）。
 */
export class AddStorageLocations1785233200000 implements MigrationInterface {
  name = 'AddStorageLocations1785233200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "storage_locations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "parentId" uuid,
        "kind" character varying(16) NOT NULL,
        "name" character varying(40) NOT NULL,
        "icon" character varying(40),
        "sortOrder" integer NOT NULL DEFAULT '0',
        "mapShape" jsonb,
        "note" text,
        "systemKey" character varying(16),
        "archivedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_storage_locations_system"
          CHECK ("systemKey" IS NULL OR ("systemKey" = 'unsorted' AND "kind" = 'room')),
        CONSTRAINT "CHK_storage_locations_room_parent" CHECK (("kind" = 'room') = ("parentId" IS NULL)),
        CONSTRAINT "CHK_storage_locations_kind" CHECK ("kind" IN ('room', 'zone', 'container', 'slot')),
        CONSTRAINT "PK_storage_locations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_storage_locations_household"
          FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_storage_locations_parent"
          FOREIGN KEY ("parentId") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_storage_locations_system" ON "storage_locations" ("householdId", "systemKey") WHERE "systemKey" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_storage_locations_child_name" ON "storage_locations" ("householdId", "parentId", "name") WHERE "parentId" IS NOT NULL AND "archivedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_storage_locations_root_name" ON "storage_locations" ("householdId", "name") WHERE "parentId" IS NULL AND "archivedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_storage_locations_household_parent" ON "storage_locations" ("householdId", "parentId")`,
    );

    await queryRunner.query(`ALTER TABLE "home_assets" ADD "locationId" uuid`);
    await queryRunner.query(`ALTER TABLE "inventory_items" ADD "defaultLocationId" uuid`);
    await queryRunner.query(`ALTER TABLE "inventory_batches" ADD "locationId" uuid`);
    await queryRunner.query(`ALTER TABLE "inventory_batches" ADD "locationUpdatedAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`CREATE INDEX "IDX_home_assets_location" ON "home_assets" ("locationId")`);
    await queryRunner.query(`CREATE INDEX "IDX_inventory_items_default_location" ON "inventory_items" ("defaultLocationId")`);
    await queryRunner.query(`CREATE INDEX "IDX_inventory_batches_location" ON "inventory_batches" ("locationId")`);
    await queryRunner.query(
      `ALTER TABLE "home_assets" ADD CONSTRAINT "FK_home_assets_location" FOREIGN KEY ("locationId") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_items" ADD CONSTRAINT "FK_inventory_items_default_location" FOREIGN KEY ("defaultLocationId") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_batches" ADD CONSTRAINT "FK_inventory_batches_location" FOREIGN KEY ("locationId") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "inventory_batches" DROP CONSTRAINT "FK_inventory_batches_location"`);
    await queryRunner.query(`ALTER TABLE "inventory_items" DROP CONSTRAINT "FK_inventory_items_default_location"`);
    await queryRunner.query(`ALTER TABLE "home_assets" DROP CONSTRAINT "FK_home_assets_location"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_inventory_batches_location"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_inventory_items_default_location"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_home_assets_location"`);
    await queryRunner.query(`ALTER TABLE "inventory_batches" DROP COLUMN "locationUpdatedAt"`);
    await queryRunner.query(`ALTER TABLE "inventory_batches" DROP COLUMN "locationId"`);
    await queryRunner.query(`ALTER TABLE "inventory_items" DROP COLUMN "defaultLocationId"`);
    await queryRunner.query(`ALTER TABLE "home_assets" DROP COLUMN "locationId"`);
    await queryRunner.query(`DROP TABLE "storage_locations"`);
  }
}
