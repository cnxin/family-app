import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFamilyAgent1785230700000 implements MigrationInterface {
  name = 'AddFamilyAgent1785230700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "agent_settings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "runtimeKind" character varying(16) NOT NULL DEFAULT 'fake',
        "runtimeProfile" character varying(64) NOT NULL DEFAULT 'default',
        "modelAlias" character varying(120) NOT NULL DEFAULT 'hermes-agent',
        "retentionDays" integer NOT NULL DEFAULT 7,
        "readToolsEnabled" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "proposalToolsEnabled" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "version" integer NOT NULL DEFAULT 1,
        "updatedByMemberId" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_settings" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_agent_settings_household" UNIQUE ("householdId"),
        CONSTRAINT "CHK_agent_settings_runtime_kind" CHECK ("runtimeKind" IN ('fake', 'hermes')),
        CONSTRAINT "CHK_agent_settings_retention_days" CHECK ("retentionDays" BETWEEN 1 AND 30),
        CONSTRAINT "FK_agent_settings_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agent_settings_updated_by" FOREIGN KEY ("updatedByMemberId") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "agent_conversations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "createdByMemberId" uuid NOT NULL,
        "source" character varying(16) NOT NULL DEFAULT 'app',
        "title" character varying(120) NOT NULL DEFAULT '新对话',
        "status" character varying(16) NOT NULL DEFAULT 'active',
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_conversations" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_agent_conversations_status" CHECK ("status" IN ('active', 'archived', 'expired')),
        CONSTRAINT "CHK_agent_conversations_source" CHECK ("source" IN ('app')),
        CONSTRAINT "FK_agent_conversations_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agent_conversations_created_by" FOREIGN KEY ("createdByMemberId") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_agent_conversations_household_member"
      ON "agent_conversations" ("householdId", "createdByMemberId", "updatedAt")
    `);
    await queryRunner.query(`
      CREATE TABLE "agent_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "conversationId" uuid NOT NULL,
        "memberId" uuid,
        "role" character varying(16) NOT NULL,
        "contentCiphertext" text NOT NULL,
        "contentNonce" character varying(32) NOT NULL,
        "contentVersion" integer NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_messages" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_agent_messages_role" CHECK ("role" IN ('user', 'assistant')),
        CONSTRAINT "CHK_agent_messages_content_version" CHECK ("contentVersion" >= 1),
        CONSTRAINT "FK_agent_messages_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agent_messages_conversation" FOREIGN KEY ("conversationId") REFERENCES "agent_conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agent_messages_member" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_agent_messages_conversation_created"
      ON "agent_messages" ("conversationId", "createdAt")
    `);
    await queryRunner.query(`
      CREATE TABLE "agent_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "conversationId" uuid NOT NULL,
        "requestedByMemberId" uuid NOT NULL,
        "clientRequestId" character varying(180) NOT NULL,
        "runtimeKind" character varying(16) NOT NULL,
        "runtimeVersion" character varying(64) NOT NULL,
        "modelAlias" character varying(120) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'queued',
        "allowedTools" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "authorizationExpiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "startedAt" TIMESTAMP WITH TIME ZONE,
        "finishedAt" TIMESTAMP WITH TIME ZONE,
        "cancelRequestedAt" TIMESTAMP WITH TIME ZONE,
        "inputTokens" integer,
        "outputTokens" integer,
        "estimatedCost" numeric(12,6),
        "errorCode" character varying(64),
        "errorMessage" character varying(300),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_runs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_agent_runs_household_idempotency" UNIQUE ("householdId", "clientRequestId"),
        CONSTRAINT "CHK_agent_runs_status" CHECK ("status" IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        CONSTRAINT "CHK_agent_runs_runtime_kind" CHECK ("runtimeKind" IN ('fake', 'hermes')),
        CONSTRAINT "CHK_agent_runs_tokens" CHECK (("inputTokens" IS NULL OR "inputTokens" >= 0) AND ("outputTokens" IS NULL OR "outputTokens" >= 0)),
        CONSTRAINT "FK_agent_runs_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agent_runs_conversation" FOREIGN KEY ("conversationId") REFERENCES "agent_conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agent_runs_requested_by" FOREIGN KEY ("requestedByMemberId") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_agent_runs_conversation_created"
      ON "agent_runs" ("conversationId", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_agent_runs_authorization_expiry"
      ON "agent_runs" ("authorizationExpiresAt")
    `);
    await queryRunner.query(`
      CREATE TABLE "agent_tool_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "runId" uuid NOT NULL,
        "toolName" character varying(80) NOT NULL,
        "sourceModule" character varying(40) NOT NULL,
        "sourceId" character varying(120),
        "status" character varying(16) NOT NULL,
        "inputSummary" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "outputSummary" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "finishedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_agent_tool_events" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_agent_tool_events_status" CHECK ("status" IN ('running', 'completed', 'failed')),
        CONSTRAINT "FK_agent_tool_events_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agent_tool_events_run" FOREIGN KEY ("runId") REFERENCES "agent_runs"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_agent_tool_events_run_started"
      ON "agent_tool_events" ("runId", "startedAt")
    `);
    await queryRunner.query(`
      CREATE FUNCTION "reject_agent_tool_event_mutation"()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'agent tool events are immutable' USING ERRCODE = '55000';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_agent_tool_events_immutable"
      BEFORE UPDATE OR DELETE ON "agent_tool_events"
      FOR EACH ROW EXECUTE FUNCTION "reject_agent_tool_event_mutation"()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER "TRG_agent_tool_events_immutable" ON "agent_tool_events"',
    );
    await queryRunner.query('DROP FUNCTION "reject_agent_tool_event_mutation"');
    await queryRunner.query('DROP TABLE "agent_tool_events"');
    await queryRunner.query('DROP TABLE "agent_runs"');
    await queryRunner.query('DROP TABLE "agent_messages"');
    await queryRunner.query('DROP TABLE "agent_conversations"');
    await queryRunner.query('DROP TABLE "agent_settings"');
  }
}
