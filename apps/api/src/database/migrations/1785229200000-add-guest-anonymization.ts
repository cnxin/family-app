import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGuestAnonymization1785229200000 implements MigrationInterface {
  name = 'AddGuestAnonymization1785229200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "guests" ADD "anonymizedAt" timestamptz`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "guests" DROP COLUMN IF EXISTS "anonymizedAt"`);
  }
}
