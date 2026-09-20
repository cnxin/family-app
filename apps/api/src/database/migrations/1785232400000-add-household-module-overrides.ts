import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHouseholdModuleOverrides1785232400000 implements MigrationInterface {
  name = 'AddHouseholdModuleOverrides1785232400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE household_module_overrides (
      household_id uuid NOT NULL,
      key varchar(32) NOT NULL,
      override varchar(3) NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid NOT NULL,
      CONSTRAINT "PK_household_module_overrides" PRIMARY KEY (household_id, key),
      CONSTRAINT "CHK_household_module_overrides_value" CHECK (override IN ('on', 'off')),
      CONSTRAINT "FK_household_module_overrides_household" FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
      CONSTRAINT "FK_household_module_overrides_updated_by" FOREIGN KEY (updated_by) REFERENCES members(id) ON DELETE RESTRICT
    )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE household_module_overrides');
  }
}
