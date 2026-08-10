import { MigrationInterface, QueryRunner } from 'typeorm';

const READ_TOOLS = [
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
];

const PREVIOUS_READ_TOOLS = READ_TOOLS.filter(
  (tool) => !['get_tasks', 'get_shopping_list', 'get_meal_plan'].includes(tool),
);

function json(value: string[]) {
  return JSON.stringify(value).replace(/'/g, "''");
}

export class AddAgentDailyReadTools1785231200000
  implements MigrationInterface
{
  name = 'AddAgentDailyReadTools1785231200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agent_settings"
      ALTER COLUMN "readToolsEnabled" SET DEFAULT '${json(READ_TOOLS)}'::jsonb
    `);
    for (const tool of ['get_tasks', 'get_shopping_list', 'get_meal_plan']) {
      await queryRunner.query(`
        UPDATE "agent_settings"
        SET "readToolsEnabled" = "readToolsEnabled" || '["${tool}"]'::jsonb
        WHERE "readToolsEnabled" @> '${json(PREVIOUS_READ_TOOLS)}'::jsonb
          AND NOT ("readToolsEnabled" ? '${tool}')
      `);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "agent_settings"
      SET "readToolsEnabled" = "readToolsEnabled"
        - 'get_tasks' - 'get_shopping_list' - 'get_meal_plan'
    `);
    await queryRunner.query(`
      ALTER TABLE "agent_settings"
      ALTER COLUMN "readToolsEnabled" SET DEFAULT '${json(PREVIOUS_READ_TOOLS)}'::jsonb
    `);
  }
}
