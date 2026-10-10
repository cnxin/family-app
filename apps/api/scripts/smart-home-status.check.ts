// 设备一句状态两份实现一致（J4 第四批）：服务端（小管家 get_device_status）用 @family/shared 的 deviceStatusLine，
// web 控制页卡片用 apps/web/src/lib/smart-home-device-copy.ts。web 那份试用期不动，这里拿同一批状态逐条比对，
// 哪边改了说法另一边没跟上就报错。run-api-tests.mjs 全量模式里执行；单独跑：
//   node -r ts-node/register scripts/smart-home-status.check.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import type { SmartHomeEntityState } from '@family/contracts';
import { deviceStatusLine, smartHomeStateLine, type SmartHomeDeviceLike } from '@family/shared';

// apps/web 是 ESM 包，不能直接 require：读源码转成 CommonJS 再求值（两份文件只引了彼此和 contracts 的类型）
const webModules = new Map<string, Record<string, unknown>>();
function loadWeb(name: string): Record<string, unknown> {
  const cached = webModules.get(name);
  if (cached) return cached;
  const source = readFileSync(join(__dirname, '../../web/src/lib', `${name}.ts`), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  });
  const exports: Record<string, unknown> = {};
  webModules.set(name, exports);
  const requireWeb = (spec: string) => {
    if (spec.startsWith('./')) return loadWeb(spec.slice(2));
    throw new Error(`web 卡片文案引了意料之外的模块：${spec}`);
  };
  new Function('exports', 'require', outputText)(exports, requireWeb);
  return exports;
}
type StateLineFn = typeof smartHomeStateLine;
type DeviceLineFn = typeof deviceStatusLine;
const webStateLine = loadWeb('smart-home-copy').smartHomeStateLine as StateLineFn;
const webDeviceStatusLine = loadWeb('smart-home-device-copy').deviceStatusLine as DeviceLineFn;

const blank: SmartHomeEntityState = {
  state: 'off',
  unit: null,
  deviceClass: null,
  position: null,
  battery: null,
  lastChanged: null,
  lastUpdated: null,
  targetTemperature: null,
  currentTemperature: null,
  hvacModes: null,
  minTemperature: null,
  maxTemperature: null,
  assumed: false,
  fanSpeed: null,
  fanMode: null,
  swingMode: null,
  humidity: null,
};
const state = (patch: Partial<SmartHomeEntityState>): SmartHomeEntityState => ({ ...blank, ...patch });

const DOMAINS = [
  'vacuum', 'cover', 'light', 'switch', 'input_boolean', 'fan', 'humidifier', 'binary_sensor', 'climate', 'water_heater',
  'scene', 'script', 'sensor', 'number', 'select', 'text', 'button',
] as const;
const STATES = [
  null,
  state({ state: 'unavailable' }),
  state({ state: 'unknown' }),
  state({ state: 'on' }),
  state({ state: 'off' }),
  state({ state: 'cleaning', battery: 80 }),
  state({ state: 'docked', battery: 60 }),
  state({ state: 'docked', battery: 100 }),
  state({ state: 'paused' }),
  state({ state: 'open', position: 40 }),
  state({ state: 'closed', position: 0 }),
  state({ state: 'opening' }),
  state({ state: 'cool', targetTemperature: 26, currentTemperature: 28.4 }),
  state({ state: 'heat', targetTemperature: 22.5 }),
  state({ state: 'on', deviceClass: 'door' }),
  state({ state: 'off', deviceClass: 'moisture' }),
  state({ state: '23.46', unit: '°C', deviceClass: 'temperature' }),
  state({ state: '45', unit: 'min', deviceClass: 'duration' }),
  state({ state: '2026-10-10T08:30:00+00:00', deviceClass: 'timestamp' }),
  state({ state: '标准模式' }),
];
const ICONS = ['vacuum', 'curtain', 'air_conditioner', 'washer', 'dryer', 'water_purifier', 'switch', 'light', 'fan', 'sensor', 'other'] as const;
const FEATURED: SmartHomeDeviceLike['featured'][] = [
  [],
  [{ entityId: 'sensor.left', domain: 'sensor', name: '剩余时间', state: state({ state: '35', unit: 'min', deviceClass: 'duration' }) }],
  [{ entityId: 'sensor.left_h', domain: 'sensor', name: 'remaining time', state: state({ state: '1.5', unit: 'h' }) }],
  [
    { entityId: 'sensor.filter_a', domain: 'sensor', name: '初滤剩余百分比', state: state({ state: '8' }) },
    { entityId: 'sensor.filter_b', domain: 'sensor', name: '精滤', state: state({ state: '63', unit: '%' }) },
  ],
];

let compared = 0;
for (const domain of DOMAINS) {
  for (const entity of STATES) {
    assert.deepEqual(smartHomeStateLine(domain, entity), webStateLine(domain, entity), `${domain} ${JSON.stringify(entity?.state)}`);
    compared += 1;
  }
}
for (const icon of ICONS) {
  for (const primaryDomain of ['vacuum', 'cover', 'climate', 'switch', 'sensor', 'light'] as const) {
    for (const primary of STATES) {
      for (const featured of FEATURED) {
        for (const long of [false, true]) {
          const device = { icon, primaryDomain, primary, featured };
          assert.deepEqual(
            deviceStatusLine(device, { long }),
            webDeviceStatusLine(device, { long }),
            `${icon} / ${primaryDomain} / ${JSON.stringify(primary?.state)} / ${featured.length} / long=${long}`,
          );
          compared += 1;
        }
      }
    }
  }
}
console.log(`  ✓ 设备一句状态：@family/shared 与 web 卡片逐条一致（${compared} 组）`);
