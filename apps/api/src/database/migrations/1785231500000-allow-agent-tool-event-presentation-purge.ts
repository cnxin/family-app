import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowAgentToolEventPresentationPurge1785231500000
  implements MigrationInterface
{
  name = 'AllowAgentToolEventPresentationPurge1785231500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "reject_agent_tool_event_mutation"()
      RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'UPDATE'
          AND OLD."presentationCiphertext" IS NOT NULL
          AND NEW."presentationCiphertext" IS NULL
          AND NEW."presentationNonce" IS NULL
          AND NEW."presentationVersion" IS NULL
          AND (
            to_jsonb(NEW)
              - 'presentationCiphertext'
              - 'presentationNonce'
              - 'presentationVersion'
          ) = (
            to_jsonb(OLD)
              - 'presentationCiphertext'
              - 'presentationNonce'
              - 'presentationVersion'
          )
        THEN
          RETURN NEW;
        END IF;

        RAISE EXCEPTION 'agent tool events are immutable' USING ERRCODE = '55000';
      END;
      $$ LANGUAGE plpgsql
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "reject_agent_tool_event_mutation"()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'agent tool events are immutable' USING ERRCODE = '55000';
      END;
      $$ LANGUAGE plpgsql
    `);
  }
}
