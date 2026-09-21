import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMaintenancePerformedOn1785232500000 implements MigrationInterface {
  name = 'AddMaintenancePerformedOn1785232500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE maintenance_records ADD COLUMN "performedOn" date');
    // 原始 performedAt 是真实时刻；逐行使用所属家庭时区，不能截 UTC 日期。
    await queryRunner.query(`UPDATE maintenance_records r
      SET "performedOn" = (r."performedAt" AT TIME ZONE h.timezone)::date
      FROM households h WHERE h.id = r."householdId"`);
    await queryRunner.query('ALTER TABLE maintenance_records ALTER COLUMN "performedOn" SET NOT NULL');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE maintenance_records DROP COLUMN "performedOn"');
  }
}
