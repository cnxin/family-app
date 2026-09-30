import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 地图编辑器 v2 家具库（docs/ui-prototypes/map-editor-v2.md §3.4）：装饰类家具（沙发、床、马桶……）只画不进位置树，
 * 整列存在地图上；带版本号，整列替换时对不上就 409。收纳类家具是位置，类型存 storage_locations.icon，不用改表。
 */
export class AddMapDecorations1785233500000 implements MigrationInterface {
  name = 'AddMapDecorations1785233500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "household_maps" ADD "decorations" jsonb NOT NULL DEFAULT '[]'::jsonb`);
    await queryRunner.query(`ALTER TABLE "household_maps" ADD "decorationsVersion" integer NOT NULL DEFAULT '0'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "household_maps" DROP COLUMN "decorationsVersion"`);
    await queryRunner.query(`ALTER TABLE "household_maps" DROP COLUMN "decorations"`);
  }
}
