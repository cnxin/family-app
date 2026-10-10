import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 第四批收尾：readToolsEnabled 的默认值与 contracts 的 AGENT_READ_TOOLS 对齐（含顺序）。
 * 之前库里的默认值一直缺 get_asset_detail（AddAgentLocationTools 起漏的），而新家庭由 AgentService.ensureSettings
 * 按 AGENT_READ_TOOLS 建、是带它的——两边不一致。回填照 AddAgentBatch4ReadTools：只给「⊇ 现在 25 个默认且不含
 * get_asset_detail」的家庭补上，管理员手动关过工具的家庭不动；已经有它的（ensureSettings 建的）也不动。
 */
const PREVIOUS_DEFAULT = [
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
  'get_finance_summary',
  'find_item',
  'list_location_contents',
  'get_reminders',
  'get_polls',
  'get_points_summary',
  'get_upcoming_visits',
  'get_device_status',
];
/** == contracts 的 AGENT_READ_TOOLS（2026-10-11，26 个，manifest 推导的顺序）。 */
const NEW_DEFAULT = [
  'get_today_summary',
  'get_family_schedule',
  'get_member_profile',
  'get_weather',
  'search_knowledge',
  'get_recent_memories',
  'get_travel_checklist',
  'get_polls',
  'search_recipes',
  'get_points_summary',
  'get_upcoming_visits',
  'get_finance_summary',
  'get_shopping_list',
  'get_tasks',
  'get_member_tasks',
  'get_calendar',
  'get_reminders',
  'get_meal_plan',
  'get_dish_plan',
  'find_item',
  'list_location_contents',
  'get_inventory_alerts',
  'get_inventory_summary',
  'get_asset_detail',
  'get_watch_candidates',
  'get_device_status',
];
const json = (value: unknown) => JSON.stringify(value).replace(/'/g, "''");

export class AddAgentAssetDetailDefault1785234700000 implements MigrationInterface {
  name = 'AddAgentAssetDetailDefault1785234700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agent_settings"
      ALTER COLUMN "readToolsEnabled" SET DEFAULT '${json(NEW_DEFAULT)}'::jsonb
    `);
    await queryRunner.query(`
      UPDATE "agent_settings"
      SET "readToolsEnabled" = "readToolsEnabled" || '["get_asset_detail"]'::jsonb
      WHERE "readToolsEnabled" @> '${json(PREVIOUS_DEFAULT)}'::jsonb
        AND NOT ("readToolsEnabled" ? 'get_asset_detail')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // 只拿掉本迁移补上的：回填前就有它的家庭（ensureSettings 建的）分不出来，一并保留 —— 与回填条件对称做不到，
    // 所以 down 不动数据，只把默认值换回去（多一个 get_asset_detail 只是多一个可用的只读工具）。
    await queryRunner.query(`
      ALTER TABLE "agent_settings"
      ALTER COLUMN "readToolsEnabled" SET DEFAULT '${json(PREVIOUS_DEFAULT)}'::jsonb
    `);
  }
}
