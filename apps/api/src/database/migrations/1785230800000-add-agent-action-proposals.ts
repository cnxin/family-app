import { MigrationInterface, QueryRunner } from 'typeorm';

const PROPOSAL_TOOLS = [
  'propose_task',
  'propose_reminder',
  'propose_poll',
  'propose_menu',
  'propose_shopping_items',
];

export class AddAgentActionProposals1785230800000
  implements MigrationInterface
{
  name = 'AddAgentActionProposals1785230800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const proposalTools = JSON.stringify(PROPOSAL_TOOLS).replace(/'/g, "''");
    await queryRunner.query(`
      ALTER TABLE "agent_settings"
      ALTER COLUMN "proposalToolsEnabled" SET DEFAULT '${proposalTools}'::jsonb
    `);
    await queryRunner.query(`
      UPDATE "agent_settings"
      SET "proposalToolsEnabled" = '${proposalTools}'::jsonb
      WHERE "proposalToolsEnabled" = '[]'::jsonb
    `);
    await queryRunner.query(`
      CREATE TABLE "agent_action_proposals" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "runId" uuid NOT NULL,
        "createdByMemberId" uuid NOT NULL,
        "confirmedByMemberId" uuid,
        "actionType" character varying(24) NOT NULL,
        "payload" jsonb NOT NULL,
        "preview" jsonb NOT NULL,
        "requestFingerprint" character varying(64) NOT NULL,
        "idempotencyKey" character varying(180) NOT NULL,
        "confirmationKey" character varying(180),
        "expectedSourceVersion" integer,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "confirmedAt" TIMESTAMP WITH TIME ZONE,
        "executedAt" TIMESTAMP WITH TIME ZONE,
        "resultModule" character varying(40),
        "resultId" character varying(120),
        "failureCode" character varying(64),
        "failureMessage" character varying(300),
        "version" integer NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_action_proposals" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_agent_action_proposals_creation" UNIQUE ("householdId", "idempotencyKey"),
        CONSTRAINT "UQ_agent_action_proposals_confirmation" UNIQUE ("householdId", "confirmationKey"),
        CONSTRAINT "CHK_agent_action_proposals_type" CHECK ("actionType" IN ('task', 'reminder', 'poll', 'menu', 'shopping')),
        CONSTRAINT "CHK_agent_action_proposals_status" CHECK ("status" IN ('pending', 'confirmed', 'executed', 'rejected', 'expired', 'failed')),
        CONSTRAINT "CHK_agent_action_proposals_version" CHECK ("version" >= 1),
        CONSTRAINT "FK_agent_action_proposals_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agent_action_proposals_run" FOREIGN KEY ("runId") REFERENCES "agent_runs"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_agent_action_proposals_created_by" FOREIGN KEY ("createdByMemberId") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_agent_action_proposals_confirmed_by" FOREIGN KEY ("confirmedByMemberId") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_agent_action_proposals_member_status"
      ON "agent_action_proposals" ("householdId", "createdByMemberId", "status", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_agent_action_proposals_run_created"
      ON "agent_action_proposals" ("runId", "createdAt")
    `);
    await queryRunner.query(`
      CREATE FUNCTION "reject_agent_action_proposal_delete"()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'agent action proposals are immutable history' USING ERRCODE = '55000';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_agent_action_proposals_no_delete"
      BEFORE DELETE ON "agent_action_proposals"
      FOR EACH ROW EXECUTE FUNCTION "reject_agent_action_proposal_delete"()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER "TRG_agent_action_proposals_no_delete" ON "agent_action_proposals"',
    );
    await queryRunner.query('DROP FUNCTION "reject_agent_action_proposal_delete"');
    await queryRunner.query('DROP TABLE "agent_action_proposals"');
    await queryRunner.query(`
      ALTER TABLE "agent_settings"
      ALTER COLUMN "proposalToolsEnabled" SET DEFAULT '[]'::jsonb
    `);
  }
}
