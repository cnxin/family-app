import { MigrationInterface, QueryRunner } from 'typeorm';

export class LinkAgentMessagesToRuns1785231100000
  implements MigrationInterface
{
  name = 'LinkAgentMessagesToRuns1785231100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_messages" ADD "runId" uuid`,
    );
    await queryRunner.query(`
      ALTER TABLE "agent_messages"
      ADD CONSTRAINT "FK_agent_messages_run"
      FOREIGN KEY ("runId") REFERENCES "agent_runs"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_agent_messages_run_created"
      ON "agent_messages" ("runId", "createdAt")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_agent_messages_run_created"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_messages" DROP CONSTRAINT IF EXISTS "FK_agent_messages_run"`,
    );
    await queryRunner.query(`ALTER TABLE "agent_messages" DROP COLUMN "runId"`);
  }
}
