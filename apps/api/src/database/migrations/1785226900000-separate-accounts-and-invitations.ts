import { MigrationInterface, QueryRunner } from 'typeorm';
import { DEFAULT_HOUSEHOLD_ID } from '../database.constants';

interface LegacyMemberRow {
  id: string;
  name: string;
  pinHash: string | null;
}

function normalizedLoginName(value: string) {
  return value.trim().toLocaleLowerCase('en-US');
}

function legacyLoginName(member: LegacyMemberRow, used: Set<string>) {
  const fallback = `member-${member.id.replace(/-/g, '').slice(0, 8)}`;
  const base = (member.name.trim() || fallback).slice(0, 64);
  let candidate = base;
  let sequence = 1;
  while (used.has(normalizedLoginName(candidate))) {
    const suffix = `-${sequence++}`;
    candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`;
  }
  used.add(normalizedLoginName(candidate));
  return candidate;
}

export class SeparateAccountsAndInvitations1785226900000
  implements MigrationInterface
{
  name = 'SeparateAccountsAndInvitations1785226900000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "accounts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "loginName" character varying(64) NOT NULL,
        "loginNameNormalized" character varying(64) NOT NULL,
        "passwordHash" character varying,
        "disabledAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_accounts" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_accounts_login_name_normalized"
      ON "accounts" ("loginNameNormalized")
    `);

    await queryRunner.query(
      'ALTER TABLE "members" ADD COLUMN "accountId" uuid',
    );
    const members = (await queryRunner.query(`
      SELECT "id", "name", "pinHash"
      FROM "members"
      ORDER BY "createdAt", "id"
    `)) as LegacyMemberRow[];
    const usedLoginNames = new Set<string>();
    for (const member of members) {
      const loginName = legacyLoginName(member, usedLoginNames);
      const [account] = (await queryRunner.query(
        `INSERT INTO "accounts"
           ("loginName", "loginNameNormalized", "passwordHash")
         VALUES ($1, $2, $3)
         RETURNING "id"`,
        [loginName, normalizedLoginName(loginName), member.pinHash],
      )) as { id: string }[];
      await queryRunner.query(
        'UPDATE "members" SET "accountId" = $1 WHERE "id" = $2',
        [account.id, member.id],
      );
    }
    await queryRunner.query(`
      ALTER TABLE "members"
      ADD CONSTRAINT "FK_members_account" FOREIGN KEY ("accountId")
      REFERENCES "accounts"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "members"
      ADD CONSTRAINT "UQ_members_household_account"
      UNIQUE ("householdId", "accountId")
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_members_account" ON "members" ("accountId")',
    );

    await queryRunner.query(
      'ALTER TABLE "auth_sessions" ADD COLUMN "accountId" uuid',
    );
    await queryRunner.query(`
      UPDATE "auth_sessions" session
      SET "accountId" = member."accountId"
      FROM "members" member
      WHERE member."id" = session."memberId"
    `);
    await queryRunner.query(
      'ALTER TABLE "auth_sessions" ALTER COLUMN "accountId" SET NOT NULL',
    );
    await queryRunner.query(`
      ALTER TABLE "auth_sessions"
      ADD CONSTRAINT "FK_auth_sessions_account" FOREIGN KEY ("accountId")
      REFERENCES "accounts"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_auth_sessions_account_status"
      ON "auth_sessions" ("accountId", "revokedAt")
    `);

    await queryRunner.query('ALTER TABLE "members" DROP COLUMN "pinHash"');

    await queryRunner.query(`
      CREATE TABLE "household_invitations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "tokenHash" character varying(64) NOT NULL,
        "memberName" character varying(64) NOT NULL,
        "avatarEmoji" character varying(16) NOT NULL DEFAULT '🙂',
        "role" character varying NOT NULL DEFAULT 'member',
        "invitedById" uuid,
        "acceptedByAccountId" uuid,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "acceptedAt" TIMESTAMP WITH TIME ZONE,
        "revokedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_household_invitations" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_household_invitations_role"
          CHECK ("role" IN ('admin', 'member')),
        CONSTRAINT "FK_household_invitations_household" FOREIGN KEY ("householdId")
          REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_household_invitations_invited_by" FOREIGN KEY ("invitedById")
          REFERENCES "members"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_household_invitations_accepted_by_account"
          FOREIGN KEY ("acceptedByAccountId") REFERENCES "accounts"("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_household_invitations_token_hash"
      ON "household_invitations" ("tokenHash")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_household_invitations_household_status"
      ON "household_invitations" ("householdId", "acceptedAt", "revokedAt")
    `);

    // The household-scope backfill creates this row even on a genuinely empty DB.
    await queryRunner.query(
      `DELETE FROM "households" household
       WHERE household."id" = $1
         AND NOT EXISTS (SELECT 1 FROM "members" WHERE "householdId" = household."id")
         AND NOT EXISTS (SELECT 1 FROM "ingredients" WHERE "householdId" = household."id")
         AND NOT EXISTS (SELECT 1 FROM "dishes" WHERE "householdId" = household."id")
         AND NOT EXISTS (SELECT 1 FROM "menus" WHERE "householdId" = household."id")
         AND NOT EXISTS (SELECT 1 FROM "shopping_items" WHERE "householdId" = household."id")
         AND NOT EXISTS (SELECT 1 FROM "inventory_items" WHERE "householdId" = household."id")`,
      [DEFAULT_HOUSEHOLD_ID],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "household_invitations"');

    await queryRunner.query(
      'ALTER TABLE "members" ADD COLUMN "pinHash" character varying',
    );
    await queryRunner.query(`
      UPDATE "members" member
      SET "pinHash" = account."passwordHash"
      FROM "accounts" account
      WHERE account."id" = member."accountId"
    `);

    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_auth_sessions_account_status"',
    );
    await queryRunner.query(
      'ALTER TABLE "auth_sessions" DROP CONSTRAINT IF EXISTS "FK_auth_sessions_account"',
    );
    await queryRunner.query(
      'ALTER TABLE "auth_sessions" DROP COLUMN IF EXISTS "accountId"',
    );

    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_members_account"',
    );
    await queryRunner.query(
      'ALTER TABLE "members" DROP CONSTRAINT IF EXISTS "UQ_members_household_account"',
    );
    await queryRunner.query(
      'ALTER TABLE "members" DROP CONSTRAINT IF EXISTS "FK_members_account"',
    );
    await queryRunner.query(
      'ALTER TABLE "members" DROP COLUMN IF EXISTS "accountId"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "accounts"');
  }
}
