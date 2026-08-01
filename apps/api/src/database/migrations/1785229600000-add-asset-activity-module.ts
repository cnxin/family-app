import { MigrationInterface, QueryRunner } from 'typeorm';

const BEFORE_MODULES =
  "'member', 'invitation', 'menu', 'calendar', 'task', 'poll', 'reminder', 'shopping', 'inventory', 'recipe', 'media', 'guest', 'system'";
const AFTER_MODULES =
  "'member', 'invitation', 'menu', 'calendar', 'task', 'poll', 'reminder', 'shopping', 'inventory', 'recipe', 'media', 'guest', 'asset', 'system'";

export class AddAssetActivityModule1785229600000
  implements MigrationInterface
{
  name = 'AddAssetActivityModule1785229600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.replaceConstraint(queryRunner, AFTER_MODULES);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "household_activity_logs"
      SET
        "module" = 'system',
        "metadata" = COALESCE("metadata", '{}'::jsonb) || '{"originalModule":"asset"}'::jsonb
      WHERE "module" = 'asset'
    `);
    await this.replaceConstraint(queryRunner, BEFORE_MODULES);
  }

  private async replaceConstraint(
    queryRunner: QueryRunner,
    modules: string,
  ) {
    await queryRunner.query(
      `ALTER TABLE "household_activity_logs" DROP CONSTRAINT "CHK_household_activity_logs_module"`,
    );
    await queryRunner.query(
      `ALTER TABLE "household_activity_logs" ADD CONSTRAINT "CHK_household_activity_logs_module" CHECK ("module" IN (${modules}))`,
    );
  }
}
