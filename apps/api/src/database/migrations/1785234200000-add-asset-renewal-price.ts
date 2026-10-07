import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * K 收尾：订阅类资产的「每次续费金额」（docs/finance-plan.md §8.4）。空时财务「固定支出」里的资产续费月均退回用购买价格。
 */
export class AddAssetRenewalPrice1785234200000 implements MigrationInterface {
  name = 'AddAssetRenewalPrice1785234200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "home_assets" ADD "renewalPrice" numeric(14,2)`);
    await queryRunner.query(
      `ALTER TABLE "home_assets" ADD CONSTRAINT "CHK_home_assets_renewal_price" CHECK ("renewalPrice" IS NULL OR "renewalPrice" >= 0)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "home_assets" DROP CONSTRAINT "CHK_home_assets_renewal_price"`);
    await queryRunner.query(`ALTER TABLE "home_assets" DROP COLUMN "renewalPrice"`);
  }
}
