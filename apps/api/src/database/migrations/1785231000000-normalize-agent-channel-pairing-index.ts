import { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizeAgentChannelPairingIndex1785231000000
  implements MigrationInterface
{
  name = 'NormalizeAgentChannelPairingIndex1785231000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_agent_channel_pairings_code"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_agent_channel_pairings_household_code"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_agent_channel_pairings_code"
      ON "agent_channel_pairings" ("codeHash")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_agent_channel_pairings_code"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_agent_channel_pairings_household_code"
      ON "agent_channel_pairings" ("householdId", "codeHash")
    `);
  }
}
