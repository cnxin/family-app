import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentMemory1785231700000 implements MigrationInterface {
  name = 'AddAgentMemory1785231700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "agent_memory_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "ownerMemberId" uuid NOT NULL,
        "scope" character varying(16) NOT NULL DEFAULT 'member_private',
        "kind" character varying(24) NOT NULL DEFAULT 'preference',
        "category" character varying(32) NOT NULL,
        "memoryKey" character varying(32) NOT NULL,
        "contentCiphertext" text,
        "contentNonce" character varying(32),
        "contentVersion" integer,
        "sourceType" character varying(32) NOT NULL,
        "sourceId" character varying(120),
        "sourceConversationId" uuid,
        "sourceMessageId" uuid,
        "status" character varying(16) NOT NULL DEFAULT 'candidate',
        "confirmedByMemberId" uuid,
        "confidenceSource" character varying(24) NOT NULL DEFAULT 'summary_candidate',
        "validFrom" TIMESTAMP WITH TIME ZONE,
        "expiresAt" TIMESTAMP WITH TIME ZONE,
        "version" integer NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_memory_items" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_agent_memory_items_scope" CHECK ("scope" IN ('member_private', 'household')),
        CONSTRAINT "CHK_agent_memory_items_kind" CHECK ("kind" IN ('preference', 'fact', 'episodic_summary', 'routine_context')),
        CONSTRAINT "CHK_agent_memory_items_status" CHECK ("status" IN ('candidate', 'active', 'revoked', 'forgotten', 'expired')),
        CONSTRAINT "CHK_agent_memory_items_confidence_source" CHECK ("confidenceSource" IN ('explicit', 'business', 'summary_candidate')),
        CONSTRAINT "CHK_agent_memory_items_content" CHECK (
          ("status" IN ('forgotten', 'expired') AND "contentCiphertext" IS NULL AND "contentNonce" IS NULL AND "contentVersion" IS NULL)
          OR
          ("status" NOT IN ('forgotten', 'expired') AND "contentCiphertext" IS NOT NULL AND "contentNonce" IS NOT NULL AND "contentVersion" IS NOT NULL AND "contentVersion" >= 1)
        ),
        CONSTRAINT "CHK_agent_memory_items_version" CHECK ("version" >= 1),
        CONSTRAINT "FK_agent_memory_items_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agent_memory_items_owner" FOREIGN KEY ("ownerMemberId") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_agent_memory_items_source_conversation" FOREIGN KEY ("sourceConversationId") REFERENCES "agent_conversations"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_agent_memory_items_confirmed_by" FOREIGN KEY ("confirmedByMemberId") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_agent_memory_items_active_key"
      ON "agent_memory_items" ("householdId", "ownerMemberId", "scope", "memoryKey")
      WHERE "status" = 'active'
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_agent_memory_items_household_owner_status"
      ON "agent_memory_items" ("householdId", "ownerMemberId", "scope", "status", "updatedAt")
    `);

    await queryRunner.query(`
      CREATE TABLE "agent_memory_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "memoryItemId" uuid NOT NULL,
        "actorMemberId" uuid NOT NULL,
        "operation" character varying(16) NOT NULL,
        "fromScope" character varying(16),
        "toScope" character varying(16),
        "sourceType" character varying(32) NOT NULL,
        "sourceId" character varying(120),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_memory_events" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_agent_memory_events_operation" CHECK ("operation" IN ('created', 'confirmed', 'corrected', 'shared', 'revoked', 'forgotten', 'expired')),
        CONSTRAINT "FK_agent_memory_events_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agent_memory_events_item" FOREIGN KEY ("memoryItemId") REFERENCES "agent_memory_items"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_agent_memory_events_actor" FOREIGN KEY ("actorMemberId") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_agent_memory_events_item_created"
      ON "agent_memory_events" ("memoryItemId", "createdAt")
    `);
    await queryRunner.query(`
      CREATE FUNCTION "reject_agent_memory_event_mutation"()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'agent memory events are immutable' USING ERRCODE = '55000';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_agent_memory_events_immutable"
      BEFORE UPDATE OR DELETE ON "agent_memory_events"
      FOR EACH ROW EXECUTE FUNCTION "reject_agent_memory_event_mutation"()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "TRG_agent_memory_events_immutable" ON "agent_memory_events"`,
    );
    await queryRunner.query(`DROP FUNCTION "reject_agent_memory_event_mutation"`);
    await queryRunner.query(`DROP TABLE "agent_memory_events"`);
    await queryRunner.query(`DROP TABLE "agent_memory_items"`);
  }
}
