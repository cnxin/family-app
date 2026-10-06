import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * J2 助理原话（docs/architecture.md §2.3、§4 J2）：⌘K / 今天页搜索条 / 小管家对话每「一次输入结束」记一条，
 * 第 0 档模板迭代与评测集的唯一数据源。只存本地库、不出网；试用期不自动清理（J3 评测集固定后再定保留期）。
 * clientId 是前端打开面板时生成的幂等键：同一家、同一人、同一个 clientId 只落一条。
 */
export class AddAssistantUtterances1785233600000 implements MigrationInterface {
  name = 'AddAssistantUtterances1785233600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "assistant_utterances" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "memberId" uuid NOT NULL,
        "clientId" uuid NOT NULL,
        "text" character varying(200) NOT NULL,
        "source" character varying(24) NOT NULL,
        "tier" smallint,
        "intentId" character varying(80),
        "confidence" numeric(4,3),
        "outcome" character varying(16) NOT NULL,
        "chosenKind" character varying(16),
        "chosenId" character varying(120),
        "correctedIntentId" character varying(80),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_assistant_utterances_client" UNIQUE ("householdId", "memberId", "clientId"),
        CONSTRAINT "CHK_assistant_utterances_text" CHECK (char_length("text") BETWEEN 1 AND 200),
        CONSTRAINT "CHK_assistant_utterances_source" CHECK ("source" IN ('command_palette', 'today_search', 'agent_chat')),
        CONSTRAINT "CHK_assistant_utterances_outcome" CHECK ("outcome" IN ('navigated', 'proposed', 'candidates', 'no_match', 'dismissed')),
        CONSTRAINT "CHK_assistant_utterances_chosen_kind" CHECK ("chosenKind" IS NULL OR "chosenKind" IN ('action', 'page', 'dish', 'item', 'agent')),
        CONSTRAINT "CHK_assistant_utterances_tier" CHECK ("tier" IS NULL OR "tier" BETWEEN 0 AND 2),
        CONSTRAINT "CHK_assistant_utterances_confidence" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
        CONSTRAINT "PK_assistant_utterances" PRIMARY KEY ("id"),
        CONSTRAINT "FK_assistant_utterances_household"
          FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_assistant_utterances_member"
          FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_assistant_utterances_household_created" ON "assistant_utterances" ("householdId", "createdAt")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_assistant_utterances_household_created"`);
    await queryRunner.query(`DROP TABLE "assistant_utterances"`);
  }
}
