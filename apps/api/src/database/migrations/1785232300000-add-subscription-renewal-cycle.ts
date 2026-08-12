import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionRenewalCycle1785232300000
  implements MigrationInterface
{
  name = 'AddSubscriptionRenewalCycle1785232300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "home_assets" ADD "renewalIntervalMonths" smallint`,
    );
    await queryRunner.query(`
      ALTER TABLE "home_assets"
      ADD CONSTRAINT "CHK_home_assets_renewal_interval"
      CHECK ("renewalIntervalMonths" IS NULL OR "renewalIntervalMonths" IN (1, 3, 6, 12))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "home_assets" DROP CONSTRAINT "CHK_home_assets_renewal_interval"`,
    );
    await queryRunner.query(
      `ALTER TABLE "home_assets" DROP COLUMN "renewalIntervalMonths"`,
    );
  }
}
