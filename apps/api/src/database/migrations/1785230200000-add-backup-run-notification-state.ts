import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBackupRunNotificationState1785230200000
  implements MigrationInterface
{
  name = 'AddBackupRunNotificationState1785230200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "backup_runs" ADD COLUMN IF NOT EXISTS "notifiedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "backup_runs" DROP COLUMN IF EXISTS "notifiedAt"`,
    );
  }
}
