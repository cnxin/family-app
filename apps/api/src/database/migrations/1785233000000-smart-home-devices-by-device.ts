import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 智能家居页重做 R1：白名单从「一行 = 一个 HA 实体」改成「一行 = 一台设备」
 * （docs/ui-prototypes/smart-home-redesign.md §4、§5）。
 *
 * 这里只做表结构（离线、可回退）。旧行原地改成「单实体设备」并标 mergeState = 'legacy'；
 * 真正按 HA device_id 归并要读 HA 的注册表，由 API 运行时的 SmartHomeMergeService 在连上 HA 后做（§5.1 ②）。
 * 引用（E4 联动目标、E3 规则、审计）在这里一对一回填到设备 id——此刻一行对一个实体，必然对得上。
 */
const ICON_BY_DOMAIN = `CASE "primaryDomain"
  WHEN 'vacuum' THEN 'vacuum'
  WHEN 'cover' THEN 'curtain'
  WHEN 'climate' THEN 'air_conditioner'
  WHEN 'switch' THEN 'switch'
  WHEN 'input_boolean' THEN 'switch'
  WHEN 'light' THEN 'light'
  WHEN 'fan' THEN 'fan'
  WHEN 'scene' THEN 'scene'
  WHEN 'script' THEN 'scene'
  WHEN 'sensor' THEN 'sensor'
  WHEN 'binary_sensor' THEN 'sensor'
  ELSE 'other' END`;

const ICONS = [
  'vacuum', 'curtain', 'air_conditioner', 'washer', 'dryer', 'water_purifier', 'fridge',
  'switch', 'light', 'fan', 'sensor', 'scene', 'other',
];

type Ref = { deviceId: string; entityId: string } | null;
type OldRules = Record<string, Record<string, unknown> | undefined>;

export class SmartHomeDevicesByDevice1785233000000 implements MigrationInterface {
  name = 'SmartHomeDevicesByDevice1785233000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // ---- smart_home_devices ------------------------------------------------------------------
    await queryRunner.query(`ALTER TABLE "smart_home_devices" DROP CONSTRAINT "CHK_smart_home_devices_domain"`);
    await queryRunner.query(`ALTER TABLE "smart_home_devices" DROP CONSTRAINT "UQ_smart_home_devices_household_entity"`);
    await queryRunner.query(`ALTER TABLE "smart_home_devices" RENAME COLUMN "entityId" TO "primaryEntityId"`);
    await queryRunner.query(`ALTER TABLE "smart_home_devices" RENAME COLUMN "domain" TO "primaryDomain"`);
    await queryRunner.query(`
      ALTER TABLE "smart_home_devices"
        ADD "haDeviceId" character varying(64),
        ADD "icon" character varying(24) NOT NULL DEFAULT 'other',
        ADD "featuredEntityIds" jsonb NOT NULL DEFAULT '[]',
        ADD "hiddenEntityIds" jsonb NOT NULL DEFAULT '[]',
        ADD "knownEntityIds" jsonb NOT NULL DEFAULT '[]',
        ADD "mergeState" character varying(16) NOT NULL DEFAULT 'ok'
    `);
    await queryRunner.query(`
      UPDATE "smart_home_devices"
      SET "mergeState" = 'legacy',
          "knownEntityIds" = jsonb_build_array("primaryEntityId"),
          "icon" = ${ICON_BY_DOMAIN}
    `);
    await queryRunner.query(`
      ALTER TABLE "smart_home_devices"
        ADD CONSTRAINT "CHK_smart_home_devices_domain"
          CHECK ("primaryDomain" NOT IN ('lock', 'alarm_control_panel') AND "primaryEntityId" LIKE "primaryDomain" || '.%'),
        ADD CONSTRAINT "UQ_smart_home_devices_household_primary" UNIQUE ("householdId", "primaryEntityId"),
        ADD CONSTRAINT "CHK_smart_home_devices_icon" CHECK ("icon" IN (${ICONS.map((icon) => `'${icon}'`).join(', ')})),
        ADD CONSTRAINT "CHK_smart_home_devices_merge_state" CHECK ("mergeState" IN ('legacy', 'ok')),
        ADD CONSTRAINT "CHK_smart_home_devices_entity_lists" CHECK (
          CASE WHEN jsonb_typeof("featuredEntityIds") = 'array'
                AND jsonb_typeof("hiddenEntityIds") = 'array'
                AND jsonb_typeof("knownEntityIds") = 'array'
            THEN jsonb_array_length("featuredEntityIds") <= 6
            ELSE false END
        )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_smart_home_devices_household_ha_device"
      ON "smart_home_devices" ("householdId", "haDeviceId") WHERE "haDeviceId" IS NOT NULL
    `);

    // ---- E4 联动：目标按设备 id 引用 ------------------------------------------------------------
    await queryRunner.query(`ALTER TABLE "smart_home_links" ADD "targetDeviceId" uuid`);
    await queryRunner.query(`
      UPDATE "smart_home_links" l SET "targetDeviceId" = d.id
      FROM "smart_home_devices" d
      WHERE d."householdId" = l."householdId" AND d."primaryEntityId" = l."targetEntityId"
    `);
    // 目标早就被移出白名单的（旧代码移出时不查联动）：停用，界面上显示「目标设备不在了」
    await queryRunner.query(`UPDATE "smart_home_links" SET enabled = false WHERE "targetDeviceId" IS NULL`);
    await queryRunner.query(`
      ALTER TABLE "smart_home_links" ADD CONSTRAINT "FK_smart_home_links_target_device"
        FOREIGN KEY ("targetDeviceId") REFERENCES "smart_home_devices"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`CREATE INDEX "IDX_smart_home_links_target_device" ON "smart_home_links" ("targetDeviceId")`);

    // ---- 审计：记是哪台设备 ---------------------------------------------------------------------
    await queryRunner.query(`ALTER TABLE "smart_home_commands" ADD "deviceId" uuid`);
    await queryRunner.query(`
      UPDATE "smart_home_commands" c SET "deviceId" = d.id
      FROM "smart_home_devices" d
      WHERE d."householdId" = c."householdId" AND d."primaryEntityId" = c."entityId"
    `);
    await queryRunner.query(`
      ALTER TABLE "smart_home_commands" ADD CONSTRAINT "FK_smart_home_commands_device"
        FOREIGN KEY ("deviceId") REFERENCES "smart_home_devices"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_smart_home_commands_device_created" ON "smart_home_commands" ("deviceId", "createdAt")
    `);

    // ---- E3 规则：实体 id → { deviceId, entityId } -----------------------------------------------
    const devices: { id: string; householdId: string; primaryEntityId: string }[] = await queryRunner.query(
      `SELECT id, "householdId", "primaryEntityId" FROM "smart_home_devices"`,
    );
    const settings: { householdId: string; rules: OldRules }[] = await queryRunner.query(
      `SELECT "householdId", rules FROM "smart_home_webhook_settings"`,
    );
    for (const row of settings) {
      const refOf = (value: unknown): Ref => {
        if (typeof value !== 'string') return null;
        const device = devices.find((one) => one.householdId === row.householdId && one.primaryEntityId === value);
        return device ? { deviceId: device.id, entityId: value } : null;
      };
      const rules = row.rules ?? {};
      const next = {
        ...rules,
        laundry: rules.laundry
          ? {
              enabled: rules.laundry.enabled,
              washer: refOf(rules.laundry.washerEntityId),
              dryer: refOf(rules.laundry.dryerEntityId),
              doneValue: rules.laundry.doneValue ?? null,
            }
          : rules.laundry,
        vacuum: rules.vacuum ? { enabled: rules.vacuum.enabled, trigger: refOf(rules.vacuum.entityId) } : rules.vacuum,
        filter: rules.filter
          ? { enabled: rules.filter.enabled, trigger: refOf(rules.filter.entityId), threshold: rules.filter.threshold }
          : rules.filter,
      };
      await queryRunner.query(`UPDATE "smart_home_webhook_settings" SET rules = $2 WHERE "householdId" = $1`, [
        row.householdId,
        JSON.stringify(next),
      ]);
    }

    // ---- 归并报告（§5.3）：每个家庭留最近一次 -----------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "smart_home_merge_reports" (
        "householdId" uuid NOT NULL,
        "report" jsonb NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_smart_home_merge_reports" PRIMARY KEY ("householdId"),
        CONSTRAINT "FK_smart_home_merge_reports_household"
          FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "smart_home_merge_reports"');

    const settings: { householdId: string; rules: Record<string, Record<string, unknown> | undefined> }[] =
      await queryRunner.query(`SELECT "householdId", rules FROM "smart_home_webhook_settings"`);
    for (const row of settings) {
      const idOf = (value: unknown) =>
        value && typeof value === 'object' && typeof (value as { entityId?: unknown }).entityId === 'string'
          ? (value as { entityId: string }).entityId
          : null;
      const rules = row.rules ?? {};
      const previous = {
        ...rules,
        laundry: rules.laundry
          ? {
              enabled: rules.laundry.enabled,
              washerEntityId: idOf(rules.laundry.washer),
              dryerEntityId: idOf(rules.laundry.dryer),
              doneValue: rules.laundry.doneValue ?? null,
            }
          : rules.laundry,
        vacuum: rules.vacuum ? { enabled: rules.vacuum.enabled, entityId: idOf(rules.vacuum.trigger) } : rules.vacuum,
        filter: rules.filter
          ? { enabled: rules.filter.enabled, entityId: idOf(rules.filter.trigger), threshold: rules.filter.threshold }
          : rules.filter,
      };
      await queryRunner.query(`UPDATE "smart_home_webhook_settings" SET rules = $2 WHERE "householdId" = $1`, [
        row.householdId,
        JSON.stringify(previous),
      ]);
    }

    await queryRunner.query('DROP INDEX IF EXISTS "IDX_smart_home_commands_device_created"');
    await queryRunner.query('ALTER TABLE "smart_home_commands" DROP CONSTRAINT IF EXISTS "FK_smart_home_commands_device"');
    await queryRunner.query('ALTER TABLE "smart_home_commands" DROP COLUMN IF EXISTS "deviceId"');

    await queryRunner.query('DROP INDEX IF EXISTS "IDX_smart_home_links_target_device"');
    await queryRunner.query('ALTER TABLE "smart_home_links" DROP CONSTRAINT IF EXISTS "FK_smart_home_links_target_device"');
    await queryRunner.query('ALTER TABLE "smart_home_links" DROP COLUMN IF EXISTS "targetDeviceId"');

    await queryRunner.query('DROP INDEX IF EXISTS "UQ_smart_home_devices_household_ha_device"');
    await queryRunner.query(`
      ALTER TABLE "smart_home_devices"
        DROP CONSTRAINT "CHK_smart_home_devices_entity_lists",
        DROP CONSTRAINT "CHK_smart_home_devices_merge_state",
        DROP CONSTRAINT "CHK_smart_home_devices_icon",
        DROP CONSTRAINT "UQ_smart_home_devices_household_primary",
        DROP CONSTRAINT "CHK_smart_home_devices_domain",
        DROP COLUMN "mergeState",
        DROP COLUMN "knownEntityIds",
        DROP COLUMN "hiddenEntityIds",
        DROP COLUMN "featuredEntityIds",
        DROP COLUMN "icon",
        DROP COLUMN "haDeviceId"
    `);
    await queryRunner.query(`ALTER TABLE "smart_home_devices" RENAME COLUMN "primaryDomain" TO "domain"`);
    await queryRunner.query(`ALTER TABLE "smart_home_devices" RENAME COLUMN "primaryEntityId" TO "entityId"`);
    await queryRunner.query(`
      ALTER TABLE "smart_home_devices"
        ADD CONSTRAINT "UQ_smart_home_devices_household_entity" UNIQUE ("householdId", "entityId"),
        ADD CONSTRAINT "CHK_smart_home_devices_domain"
          CHECK ("domain" NOT IN ('lock', 'alarm_control_panel') AND "entityId" LIKE "domain" || '.%')
    `);
  }
}
