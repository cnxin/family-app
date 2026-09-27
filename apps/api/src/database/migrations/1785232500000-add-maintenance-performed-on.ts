import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMaintenancePerformedOn1785232500000 implements MigrationInterface {
  name = 'AddMaintenancePerformedOn1785232500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE maintenance_records ADD COLUMN "performedOn" date');
    // 维护记录有「不可修改」触发器：回填只在本迁移的事务里临时关掉它，回填完立即恢复。
    // 空库演练发现不了这一点，有记录的库上会直接失败，见 refactor-plan 教训 29。
    await queryRunner.query(
      'ALTER TABLE maintenance_records DISABLE TRIGGER "TR_maintenance_records_immutable"',
    );
    // 原始 performedAt 是真实时刻；逐行使用所属家庭时区，不能截 UTC 日期。
    await queryRunner.query(`UPDATE maintenance_records r
      SET "performedOn" = (r."performedAt" AT TIME ZONE h.timezone)::date
      FROM households h WHERE h.id = r."householdId"`);
    await queryRunner.query(
      'ALTER TABLE maintenance_records ENABLE TRIGGER "TR_maintenance_records_immutable"',
    );
    await queryRunner.query('ALTER TABLE maintenance_records ALTER COLUMN "performedOn" SET NOT NULL');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE maintenance_records DROP COLUMN "performedOn"');
  }
}
