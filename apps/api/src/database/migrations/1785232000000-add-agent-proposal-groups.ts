import { MigrationInterface, QueryRunner } from 'typeorm';

const LEGACY_PROPOSAL_TOOLS = [
  'propose_task',
  'propose_reminder',
  'propose_poll',
  'propose_menu',
  'propose_shopping_items',
];
const PROPOSAL_TOOLS = [...LEGACY_PROPOSAL_TOOLS, 'propose_plan'];

function json(value: string[]) {
  return JSON.stringify(value).replace(/'/g, "''");
}

export class AddAgentProposalGroups1785232000000
  implements MigrationInterface
{
  name = 'AddAgentProposalGroups1785232000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agent_settings"
      ALTER COLUMN "proposalToolsEnabled" SET DEFAULT '${json(PROPOSAL_TOOLS)}'::jsonb
    `);
    await queryRunner.query(`
      UPDATE "agent_settings"
      SET "proposalToolsEnabled" = "proposalToolsEnabled" || '["propose_plan"]'::jsonb
      WHERE "proposalToolsEnabled" @> '${json(LEGACY_PROPOSAL_TOOLS)}'::jsonb
        AND NOT ("proposalToolsEnabled" ? 'propose_plan')
    `);

    await queryRunner.query(`
      CREATE TABLE "agent_proposal_groups" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "conversationId" uuid,
        "runId" uuid NOT NULL,
        "requestedByMemberId" uuid NOT NULL,
        "title" character varying(120) NOT NULL,
        "summary" character varying(400) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "confirmedByMemberId" uuid,
        "confirmedAt" TIMESTAMP WITH TIME ZONE,
        "rejectedAt" TIMESTAMP WITH TIME ZONE,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_proposal_groups" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_agent_proposal_groups_status" CHECK ("status" IN ('pending', 'confirmed', 'rejected', 'expired', 'failed')),
        CONSTRAINT "CHK_agent_proposal_groups_version" CHECK ("version" >= 1),
        CONSTRAINT "FK_agent_proposal_groups_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agent_proposal_groups_conversation" FOREIGN KEY ("conversationId") REFERENCES "agent_conversations"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_agent_proposal_groups_run" FOREIGN KEY ("runId") REFERENCES "agent_runs"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_agent_proposal_groups_requested_by" FOREIGN KEY ("requestedByMemberId") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_agent_proposal_groups_confirmed_by" FOREIGN KEY ("confirmedByMemberId") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_agent_proposal_groups_household_status_created"
      ON "agent_proposal_groups" ("householdId", "status", "createdAt")
    `);

    await queryRunner.query(`
      ALTER TABLE "agent_action_proposals"
      ADD COLUMN "groupId" uuid,
      ADD COLUMN "stepOrder" integer,
      ADD CONSTRAINT "FK_agent_action_proposals_group"
        FOREIGN KEY ("groupId") REFERENCES "agent_proposal_groups"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      CREATE TABLE "agent_proposal_group_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "groupId" uuid NOT NULL,
        "actorMemberId" uuid NOT NULL,
        "operation" character varying(16) NOT NULL,
        "stepCount" integer NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_proposal_group_events" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_agent_proposal_group_events_operation" CHECK ("operation" IN ('created', 'confirmed', 'rejected', 'expired', 'failed')),
        CONSTRAINT "FK_agent_proposal_group_events_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agent_proposal_group_events_group" FOREIGN KEY ("groupId") REFERENCES "agent_proposal_groups"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agent_proposal_group_events_actor" FOREIGN KEY ("actorMemberId") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_agent_proposal_group_events_group_created"
      ON "agent_proposal_group_events" ("groupId", "createdAt")
    `);
    await queryRunner.query(`
      CREATE FUNCTION "reject_agent_proposal_group_event_mutation"()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'agent proposal group events are immutable' USING ERRCODE = '55000';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_agent_proposal_group_events_immutable"
      BEFORE UPDATE OR DELETE ON "agent_proposal_group_events"
      FOR EACH ROW EXECUTE FUNCTION "reject_agent_proposal_group_event_mutation"()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "TRG_agent_proposal_group_events_immutable" ON "agent_proposal_group_events"`,
    );
    await queryRunner.query(
      `DROP FUNCTION "reject_agent_proposal_group_event_mutation"`,
    );
    await queryRunner.query(`DROP TABLE "agent_proposal_group_events"`);
    await queryRunner.query(`
      ALTER TABLE "agent_action_proposals"
      DROP CONSTRAINT "FK_agent_action_proposals_group",
      DROP COLUMN "stepOrder",
      DROP COLUMN "groupId"
    `);
    await queryRunner.query(`DROP TABLE "agent_proposal_groups"`);
    await queryRunner.query(`
      UPDATE "agent_settings"
      SET "proposalToolsEnabled" = "proposalToolsEnabled" - 'propose_plan'
      WHERE "proposalToolsEnabled" ? 'propose_plan'
    `);
    await queryRunner.query(`
      ALTER TABLE "agent_settings"
      ALTER COLUMN "proposalToolsEnabled" SET DEFAULT '${json(LEGACY_PROPOSAL_TOOLS)}'::jsonb
    `);
  }
}
