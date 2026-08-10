import { MigrationInterface, QueryRunner } from 'typeorm';

export class AgentRunRetryPresentations1785231300000
  implements MigrationInterface
{
  name = 'AgentRunRetryPresentations1785231300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agent_runs" ADD "retryOfRunId" uuid`);
    await queryRunner.query(`
      ALTER TABLE "agent_runs"
      ADD CONSTRAINT "FK_agent_runs_retry_of"
      FOREIGN KEY ("retryOfRunId") REFERENCES "agent_runs"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_agent_runs_retry_of"
      ON "agent_runs" ("retryOfRunId")
      WHERE "retryOfRunId" IS NOT NULL
    `);
    await queryRunner.query(
      `ALTER TABLE "agent_tool_events" ADD "presentationCiphertext" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_tool_events" ADD "presentationNonce" character varying(32)`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_tool_events" ADD "presentationVersion" integer`,
    );
    await queryRunner.query(`
      ALTER TABLE "agent_tool_events"
      ADD CONSTRAINT "CHK_agent_tool_events_presentation"
      CHECK (
        ("presentationCiphertext" IS NULL AND "presentationNonce" IS NULL AND "presentationVersion" IS NULL)
        OR
        ("presentationCiphertext" IS NOT NULL AND "presentationNonce" IS NOT NULL AND "presentationVersion" >= 1)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_tool_events" DROP CONSTRAINT IF EXISTS "CHK_agent_tool_events_presentation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_tool_events" DROP COLUMN "presentationVersion"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_tool_events" DROP COLUMN "presentationNonce"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_tool_events" DROP COLUMN "presentationCiphertext"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_agent_runs_retry_of"`);
    await queryRunner.query(
      `ALTER TABLE "agent_runs" DROP CONSTRAINT IF EXISTS "FK_agent_runs_retry_of"`,
    );
    await queryRunner.query(`ALTER TABLE "agent_runs" DROP COLUMN "retryOfRunId"`);
  }
}
