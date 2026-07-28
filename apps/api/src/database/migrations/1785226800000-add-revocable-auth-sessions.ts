import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRevocableAuthSessions1785226800000
  implements MigrationInterface
{
  name = 'AddRevocableAuthSessions1785226800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "auth_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "memberId" uuid NOT NULL,
        "refreshTokenHash" character varying(64) NOT NULL,
        "roleSnapshot" character varying NOT NULL,
        "credentialSnapshot" character varying(64) NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "revokedAt" TIMESTAMP WITH TIME ZONE,
        "lastUsedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_auth_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_auth_sessions_role_snapshot"
          CHECK ("roleSnapshot" IN ('owner', 'admin', 'member')),
        CONSTRAINT "FK_auth_sessions_household" FOREIGN KEY ("householdId")
          REFERENCES "households"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_auth_sessions_member" FOREIGN KEY ("memberId")
          REFERENCES "members"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_auth_sessions_refresh_token_hash"
      ON "auth_sessions" ("refreshTokenHash")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_auth_sessions_member_status"
      ON "auth_sessions" ("memberId", "revokedAt")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "auth_sessions"');
  }
}
