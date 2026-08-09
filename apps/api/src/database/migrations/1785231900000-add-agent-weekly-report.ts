import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentWeeklyReport1785231900000
  implements MigrationInterface
{
  name = 'AddAgentWeeklyReport1785231900000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_routines" DROP CONSTRAINT "CHK_agent_routines_kind"`,
    );
    await queryRunner.query(`
      ALTER TABLE "agent_routines"
      ADD CONSTRAINT "CHK_agent_routines_kind"
      CHECK ("kind" IN ('nightly_digest', 'weekly_report'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "agent_routines" WHERE "kind" = 'weekly_report'`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_routines" DROP CONSTRAINT "CHK_agent_routines_kind"`,
    );
    await queryRunner.query(`
      ALTER TABLE "agent_routines"
      ADD CONSTRAINT "CHK_agent_routines_kind"
      CHECK ("kind" IN ('nightly_digest'))
    `);
  }
}
