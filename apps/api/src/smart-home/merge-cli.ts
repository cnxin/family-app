import { readFileSync } from 'node:fs';
import { formatMergeReport, mergeReport, planMerge, type LegacyRow } from './smart-home-devices';
import type { HomeAssistantRawState } from './home-assistant.client';
import type { HomeAssistantRegistries } from './home-assistant.ws';

/**
 * 「按实体 → 按设备」归并的 dry-run（smart-home-redesign §5.3）：只读两份导出文件，打印归并结果，不连库、不连 HA、不写任何东西。
 * 升级演示栈之前先跑它，结果贴给 King，点头再升级；升级后 GET /smart-home/devices/merge-report 应与它一致。
 *
 *   node dist/smart-home/merge-cli.js --rows rows.json --registries registries.json [--states states.json] [--json]
 *
 * rows.json：白名单旧行的数组，R1 前后两种列名都认（entityId / domain 或 primaryEntityId / primaryDomain），例如
 *   SELECT json_agg(d) FROM smart_home_devices d WHERE "householdId" = '…'
 * registries.json：{ devices, entities, areas }，即 HA WebSocket 的 config/device_registry|entity_registry|area_registry/list；
 * states.json（可选）：HA 的 GET /api/states，用来给实体起名。
 */
function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readJson<T>(path: string | undefined, label: string): T {
  if (!path) throw new Error(`缺少 --${label}`);
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

type RawRow = Partial<LegacyRow> & { entityId?: string; domain?: string; mergeState?: string };

function main() {
  const raw = readJson<RawRow[] | null>(arg('rows'), 'rows') ?? [];
  const registries = readJson<HomeAssistantRegistries>(arg('registries'), 'registries');
  const states = arg('states') ? readJson<HomeAssistantRawState[]>(arg('states'), 'states') : [];
  // R1 之后的库里只有 legacy 行要归并；R1 之前的库全部是
  const rows: LegacyRow[] = raw
    .filter((row) => row.mergeState === undefined || row.mergeState === 'legacy')
    .map((row) => ({
      id: String(row.id),
      primaryEntityId: String(row.primaryEntityId ?? row.entityId),
      primaryDomain: String(row.primaryDomain ?? row.domain),
      displayName: String(row.displayName),
      area: row.area ?? null,
      controllable: Boolean(row.controllable),
      minRole: String(row.minRole ?? 'admin'),
      pinnedToToday: Boolean(row.pinnedToToday),
      sortOrder: Number(row.sortOrder ?? 0),
    }));
  const plan = planMerge(rows, registries, new Map(states.map((state) => [state.entity_id, state])));
  const report = mergeReport(plan, rows, { dryRun: true, mergedAt: new Date() });
  console.log(process.argv.includes('--json') ? JSON.stringify(report, null, 2) : formatMergeReport(report));
}

main();
