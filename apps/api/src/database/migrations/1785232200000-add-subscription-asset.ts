import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionAsset1785232200000 implements MigrationInterface {
  name = 'AddSubscriptionAsset1785232200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "home_assets" ADD "renewsOn" date`,
    );
    await queryRunner.query(
      `ALTER TABLE "home_assets" DROP CONSTRAINT "CHK_home_assets_category"`,
    );
    await queryRunner.query(`
      ALTER TABLE "home_assets"
      ADD CONSTRAINT "CHK_home_assets_category"
      CHECK ("category" IN ('appliance', 'furniture', 'electronics', 'tool', 'subscription', 'other'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "home_assets" WHERE "category" = 'subscription'`,
    );
    await queryRunner.query(
      `ALTER TABLE "home_assets" DROP CONSTRAINT "CHK_home_assets_category"`,
    );
    await queryRunner.query(`
      ALTER TABLE "home_assets"
      ADD CONSTRAINT "CHK_home_assets_category"
      CHECK ("category" IN ('appliance', 'furniture', 'electronics', 'tool', 'other'))
    `);
    await queryRunner.query(
      `ALTER TABLE "home_assets" DROP COLUMN "renewsOn"`,
    );
  }
}
