import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I2 家庭地图（docs/item-location-plan.md §2.2）：一个家庭一张（留 isActive，将来多张不改表）。
 * viewBox 宽固定 1000、高按导入时裁剪后的图片比例；房间 / 柜子的形状存在 storage_locations.mapShape。
 * 底图是 uploads/.private/maps/<家庭>/ 下的一个文件，这里只记文件名（整个 uploads 目录本来就在备份里）。
 */
export class AddHouseholdMaps1785233300000 implements MigrationInterface {
  name = 'AddHouseholdMaps1785233300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "household_maps" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "title" character varying(40) NOT NULL DEFAULT '家',
        "isActive" boolean NOT NULL DEFAULT true,
        "viewBoxWidth" integer NOT NULL,
        "viewBoxHeight" integer NOT NULL,
        "backgroundFile" character varying(80),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_household_maps_viewbox"
          CHECK ("viewBoxWidth" = 1000 AND "viewBoxHeight" BETWEEN 100 AND 4000),
        CONSTRAINT "PK_household_maps" PRIMARY KEY ("id"),
        CONSTRAINT "FK_household_maps_household"
          FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_household_maps_active" ON "household_maps" ("householdId") WHERE "isActive"`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_household_maps_active"`);
    await queryRunner.query(`DROP TABLE "household_maps"`);
  }
}
