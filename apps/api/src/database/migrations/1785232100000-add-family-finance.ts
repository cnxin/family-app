import { MigrationInterface, QueryRunner } from 'typeorm';

const LEGACY_READ_TOOLS = [
  'get_today_summary',
  'get_calendar',
  'get_tasks',
  'get_shopping_list',
  'get_meal_plan',
  'get_inventory_alerts',
  'search_knowledge',
  'get_travel_checklist',
  'get_watch_candidates',
  'get_recent_memories',
  'get_member_tasks',
  'get_family_schedule',
  'get_inventory_summary',
  'search_recipes',
  'get_dish_plan',
  'get_weather',
  'get_member_profile',
];
const READ_TOOLS = [...LEGACY_READ_TOOLS, 'get_finance_summary'];
const LEGACY_PROPOSAL_TOOLS = [
  'propose_task',
  'propose_reminder',
  'propose_poll',
  'propose_menu',
  'propose_shopping_items',
  'propose_plan',
];
const PROPOSAL_TOOLS = [
  ...LEGACY_PROPOSAL_TOOLS,
  'propose_finance_transaction',
];

function json(value: string[]) {
  return JSON.stringify(value).replace(/'/g, "''");
}

export class AddFamilyFinance1785232100000 implements MigrationInterface {
  name = 'AddFamilyFinance1785232100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "finance_accounts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "name" character varying(80) NOT NULL,
        "type" character varying(16) NOT NULL,
        "openingBalance" numeric(14,2) NOT NULL DEFAULT 0,
        "currency" character varying(3) NOT NULL DEFAULT 'CNY',
        "isActive" boolean NOT NULL DEFAULT true,
        "version" integer NOT NULL DEFAULT 1,
        "createdById" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_accounts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_finance_accounts_household_name" UNIQUE ("householdId", "name"),
        CONSTRAINT "CHK_finance_accounts_type" CHECK ("type" IN ('cash', 'bank', 'alipay', 'wechat', 'other')),
        CONSTRAINT "CHK_finance_accounts_currency" CHECK ("currency" = 'CNY'),
        CONSTRAINT "CHK_finance_accounts_version" CHECK ("version" >= 1),
        CONSTRAINT "FK_finance_accounts_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_finance_accounts_created_by" FOREIGN KEY ("createdById") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_finance_accounts_household_active" ON "finance_accounts" ("householdId", "isActive", "createdAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE "finance_categories" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "name" character varying(80) NOT NULL,
        "kind" character varying(16) NOT NULL,
        "systemKey" character varying(64),
        "icon" character varying(32) NOT NULL DEFAULT 'circle',
        "color" character varying(7) NOT NULL DEFAULT '#26734D',
        "sortOrder" integer NOT NULL DEFAULT 0,
        "isActive" boolean NOT NULL DEFAULT true,
        "version" integer NOT NULL DEFAULT 1,
        "createdById" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_categories" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_finance_categories_household_kind_name" UNIQUE ("householdId", "kind", "name"),
        CONSTRAINT "CHK_finance_categories_kind" CHECK ("kind" IN ('expense', 'income')),
        CONSTRAINT "CHK_finance_categories_version" CHECK ("version" >= 1),
        CONSTRAINT "FK_finance_categories_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_finance_categories_created_by" FOREIGN KEY ("createdById") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_finance_categories_household_system_key" ON "finance_categories" ("householdId", "systemKey") WHERE "systemKey" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_finance_categories_household_kind_active" ON "finance_categories" ("householdId", "kind", "isActive", "sortOrder")`,
    );

    await queryRunner.query(`
      CREATE TABLE "finance_transactions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "type" character varying(16) NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "currency" character varying(3) NOT NULL DEFAULT 'CNY',
        "title" character varying(120) NOT NULL,
        "note" character varying(1000),
        "occurredOn" date NOT NULL,
        "categoryId" uuid,
        "actorId" uuid NOT NULL,
        "actorName" character varying(80) NOT NULL,
        "sourceType" character varying(32) NOT NULL,
        "sourceId" character varying(180) NOT NULL,
        "idempotencyKey" character varying(180) NOT NULL,
        "requestFingerprint" character varying(64) NOT NULL,
        "reversalOfId" uuid,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT "PK_finance_transactions" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_finance_transactions_type" CHECK ("type" IN ('expense', 'income', 'transfer', 'reversal')),
        CONSTRAINT "CHK_finance_transactions_source_type" CHECK ("sourceType" IN ('manual', 'agent', 'shopping_item', 'asset', 'media_subscription', 'finance_transaction')),
        CONSTRAINT "CHK_finance_transactions_amount" CHECK ("amount" > 0),
        CONSTRAINT "CHK_finance_transactions_currency" CHECK ("currency" = 'CNY'),
        CONSTRAINT "CHK_finance_transactions_category" CHECK (("type" IN ('expense', 'income') AND "categoryId" IS NOT NULL) OR ("type" IN ('transfer', 'reversal'))),
        CONSTRAINT "CHK_finance_transactions_reversal" CHECK (("type" = 'reversal' AND "reversalOfId" IS NOT NULL) OR ("type" <> 'reversal' AND "reversalOfId" IS NULL)),
        CONSTRAINT "FK_finance_transactions_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_finance_transactions_category" FOREIGN KEY ("categoryId") REFERENCES "finance_categories"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_finance_transactions_actor" FOREIGN KEY ("actorId") REFERENCES "members"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_finance_transactions_reversal_of" FOREIGN KEY ("reversalOfId") REFERENCES "finance_transactions"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_finance_transactions_household_idempotency" ON "finance_transactions" ("householdId", "idempotencyKey")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_finance_transactions_reversal" ON "finance_transactions" ("reversalOfId") WHERE "reversalOfId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_finance_transactions_household_occurred" ON "finance_transactions" ("householdId", "occurredOn", "createdAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE "finance_postings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "transactionId" uuid NOT NULL,
        "accountId" uuid NOT NULL,
        "delta" numeric(14,2) NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT "PK_finance_postings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_finance_postings_delta" CHECK ("delta" <> 0),
        CONSTRAINT "FK_finance_postings_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_finance_postings_transaction" FOREIGN KEY ("transactionId") REFERENCES "finance_transactions"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_finance_postings_account" FOREIGN KEY ("accountId") REFERENCES "finance_accounts"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_finance_postings_account_created" ON "finance_postings" ("accountId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_finance_postings_household_transaction" ON "finance_postings" ("householdId", "transactionId")`,
    );

    await queryRunner.query(`
      CREATE TABLE "finance_budgets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "categoryId" uuid NOT NULL,
        "month" character varying(7) NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "updatedById" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_budgets" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_finance_budgets_household_category_month" UNIQUE ("householdId", "categoryId", "month"),
        CONSTRAINT "CHK_finance_budgets_amount" CHECK ("amount" >= 0),
        CONSTRAINT "CHK_finance_budgets_month" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
        CONSTRAINT "CHK_finance_budgets_version" CHECK ("version" >= 1),
        CONSTRAINT "FK_finance_budgets_household" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_finance_budgets_category" FOREIGN KEY ("categoryId") REFERENCES "finance_categories"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_finance_budgets_updated_by" FOREIGN KEY ("updatedById") REFERENCES "members"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_finance_budgets_household_month" ON "finance_budgets" ("householdId", "month")`,
    );

    await queryRunner.query(`
      CREATE FUNCTION "reject_finance_ledger_mutation"()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'finance ledger is immutable' USING ERRCODE = '55000';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_finance_transactions_immutable"
      BEFORE UPDATE OR DELETE ON "finance_transactions"
      FOR EACH ROW EXECUTE FUNCTION "reject_finance_ledger_mutation"()
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_finance_postings_immutable"
      BEFORE UPDATE OR DELETE ON "finance_postings"
      FOR EACH ROW EXECUTE FUNCTION "reject_finance_ledger_mutation"()
    `);

    await queryRunner.query(`
      ALTER TABLE "household_activity_logs"
      DROP CONSTRAINT "CHK_household_activity_logs_module"
    `);
    await queryRunner.query(`
      ALTER TABLE "household_activity_logs"
      ADD CONSTRAINT "CHK_household_activity_logs_module"
      CHECK ("module" IN ('member', 'invitation', 'menu', 'calendar', 'task', 'poll', 'reminder', 'shopping', 'inventory', 'recipe', 'media', 'guest', 'asset', 'points', 'knowledge', 'memory', 'travel', 'finance', 'system'))
    `);
    await queryRunner.query(`
      ALTER TABLE "agent_action_proposals"
      DROP CONSTRAINT "CHK_agent_action_proposals_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "agent_action_proposals"
      ADD CONSTRAINT "CHK_agent_action_proposals_type"
      CHECK ("actionType" IN ('task', 'reminder', 'poll', 'menu', 'shopping', 'finance'))
    `);

    await queryRunner.query(`
      ALTER TABLE "agent_settings"
      ALTER COLUMN "readToolsEnabled" SET DEFAULT '${json(READ_TOOLS)}'::jsonb,
      ALTER COLUMN "proposalToolsEnabled" SET DEFAULT '${json(PROPOSAL_TOOLS)}'::jsonb
    `);
    await queryRunner.query(`
      UPDATE "agent_settings"
      SET "readToolsEnabled" = "readToolsEnabled" || '["get_finance_summary"]'::jsonb
      WHERE "readToolsEnabled" @> '${json(LEGACY_READ_TOOLS)}'::jsonb
        AND NOT ("readToolsEnabled" ? 'get_finance_summary')
    `);
    await queryRunner.query(`
      UPDATE "agent_settings"
      SET "proposalToolsEnabled" = "proposalToolsEnabled" || '["propose_finance_transaction"]'::jsonb
      WHERE "proposalToolsEnabled" @> '${json(LEGACY_PROPOSAL_TOOLS)}'::jsonb
        AND NOT ("proposalToolsEnabled" ? 'propose_finance_transaction')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "agent_settings"
      SET "proposalToolsEnabled" = "proposalToolsEnabled" - 'propose_finance_transaction',
          "readToolsEnabled" = "readToolsEnabled" - 'get_finance_summary'
    `);
    await queryRunner.query(`
      ALTER TABLE "agent_settings"
      ALTER COLUMN "readToolsEnabled" SET DEFAULT '${json(LEGACY_READ_TOOLS)}'::jsonb,
      ALTER COLUMN "proposalToolsEnabled" SET DEFAULT '${json(LEGACY_PROPOSAL_TOOLS)}'::jsonb
    `);
    await queryRunner.query(`ALTER TABLE "agent_action_proposals" DROP CONSTRAINT "CHK_agent_action_proposals_type"`);
    await queryRunner.query(`ALTER TABLE "agent_action_proposals" ADD CONSTRAINT "CHK_agent_action_proposals_type" CHECK ("actionType" IN ('task', 'reminder', 'poll', 'menu', 'shopping'))`);
    await queryRunner.query(`ALTER TABLE "household_activity_logs" DROP CONSTRAINT "CHK_household_activity_logs_module"`);
    await queryRunner.query(`ALTER TABLE "household_activity_logs" ADD CONSTRAINT "CHK_household_activity_logs_module" CHECK ("module" IN ('member', 'invitation', 'menu', 'calendar', 'task', 'poll', 'reminder', 'shopping', 'inventory', 'recipe', 'media', 'guest', 'asset', 'points', 'knowledge', 'memory', 'travel', 'system'))`);
    await queryRunner.query(`DROP TRIGGER "TRG_finance_postings_immutable" ON "finance_postings"`);
    await queryRunner.query(`DROP TRIGGER "TRG_finance_transactions_immutable" ON "finance_transactions"`);
    await queryRunner.query(`DROP FUNCTION "reject_finance_ledger_mutation"`);
    await queryRunner.query(`DROP TABLE "finance_budgets"`);
    await queryRunner.query(`DROP TABLE "finance_postings"`);
    await queryRunner.query(`DROP TABLE "finance_transactions"`);
    await queryRunner.query(`DROP TABLE "finance_categories"`);
    await queryRunner.query(`DROP TABLE "finance_accounts"`);
  }
}
