import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * H3 E1：Home Assistant 实体白名单。连接设置复用 integrations / integration_secrets（kind = 'home_assistant'），
 * 这里只加白名单表。门锁、安防两个 domain 在库里也拒绝（home-assistant-plan §8 拍板 2）。
 */
export class AddSmartHomeDevices1785232600000 implements MigrationInterface {
  name = 'AddSmartHomeDevices1785232600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "smart_home_devices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "householdId" uuid NOT NULL,
        "entityId" character varying(255) NOT NULL,
        "domain" character varying(32) NOT NULL,
        "displayName" character varying(40) NOT NULL,
        "area" character varying(20),
        "sortOrder" integer NOT NULL DEFAULT 0,
        "controllable" boolean NOT NULL DEFAULT false,
        "minRole" character varying(16) NOT NULL DEFAULT 'admin',
        "pinnedToToday" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_smart_home_devices" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_smart_home_devices_household_entity" UNIQUE ("householdId", "entityId"),
        CONSTRAINT "CHK_smart_home_devices_domain"
          CHECK ("domain" NOT IN ('lock', 'alarm_control_panel') AND "entityId" LIKE "domain" || '.%'),
        CONSTRAINT "CHK_smart_home_devices_min_role" CHECK ("minRole" IN ('owner', 'admin', 'member')),
        CONSTRAINT "FK_smart_home_devices_household"
          FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "smart_home_devices"');
  }
}
