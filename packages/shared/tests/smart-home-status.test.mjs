// 设备的一句状态（smartHomeStateLine / deviceStatusLine / isPercentEntity）。第四批收尾从 apps/web 的
// smart-home-copy.test.ts、smart-home-device-copy.test.ts 搬来，用例一条不少；测 dist（先 build:packages）。
// run-api-tests.mjs 全量模式里执行；单独跑：node --test packages/shared/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceStatusLine, isPercentEntity, smartHomeStateLine } from '../dist/index.js';

function state(value, extra = {}) {
  return {
    state: value, unit: null, deviceClass: null, position: null, battery: null, lastChanged: null, lastUpdated: null,
    targetTemperature: null, currentTemperature: null, hvacModes: null, minTemperature: null, maxTemperature: null,
    assumed: false, fanSpeed: null, fanMode: null, swingMode: null, humidity: null, ...extra,
  };
}
const device = (icon, primaryDomain, primary, featured = []) => ({ icon, primaryDomain, primary, featured });
const like = (actual, expected) => {
  for (const [key, value] of Object.entries(expected)) assert.equal(actual[key], value, key);
};

// ---- smartHomeStateLine（原 apps/web/src/lib/smart-home-copy.test.ts） ----

test('smartHomeStateLine：连不上时一律一条横线，离线 / 不知道单独说', () => {
  assert.deepEqual(smartHomeStateLine('vacuum', null), { text: '—', detail: null, tone: 'muted' });
  assert.equal(smartHomeStateLine('cover', state('unavailable')).text, '离线');
  assert.equal(smartHomeStateLine('sensor', state('unknown')).text, '不知道');
});

test('smartHomeStateLine：扫地机状态说人话，带电量', () => {
  assert.deepEqual(smartHomeStateLine('vacuum', state('cleaning', { battery: 62 })), { text: '正在清扫', detail: '电量 62%', tone: 'on' });
  assert.equal(smartHomeStateLine('vacuum', state('docked')).text, '在充电座上');
  assert.equal(smartHomeStateLine('vacuum', state('error')).tone, 'warn');
});

test('smartHomeStateLine：窗帘开着带开合百分比，全开、关着不带', () => {
  like(smartHomeStateLine('cover', state('open', { position: 80 })), { text: '开着', detail: '开了 80%' });
  assert.equal(smartHomeStateLine('cover', state('open', { position: 100 })).detail, null);
  like(smartHomeStateLine('cover', state('closed', { position: 0 })), { text: '关着', detail: null });
});

test('smartHomeStateLine：传感器数值 + 中文单位，百分号紧跟', () => {
  assert.equal(smartHomeStateLine('sensor', state('38', { unit: 'min' })).text, '38 分钟');
  assert.equal(smartHomeStateLine('sensor', state('12', { unit: '%' })).text, '12%');
  assert.equal(smartHomeStateLine('sensor', state('23.46', { unit: '°C' })).text, '23.5°C');
  assert.equal(smartHomeStateLine('sensor', state('2026-09-28T06:30:00+00:00', { deviceClass: 'timestamp' })).text, '14:30');
});

test('smartHomeStateLine：二元传感器按 device_class 说', () => {
  assert.equal(smartHomeStateLine('binary_sensor', state('on', { deviceClass: 'running' })).text, '运行中');
  assert.equal(smartHomeStateLine('binary_sensor', state('off', { deviceClass: 'running' })).text, '没在运行');
  assert.equal(smartHomeStateLine('binary_sensor', state('on')).text, '是');
});

test('smartHomeStateLine：开关类与空调', () => {
  assert.equal(smartHomeStateLine('switch', state('on')).tone, 'on');
  assert.equal(smartHomeStateLine('light', state('off')).text, '关着');
  assert.equal(smartHomeStateLine('climate', state('cool')).text, '制冷');
  assert.equal(
    smartHomeStateLine('climate', state('heat', { targetTemperature: 26, currentTemperature: 28.4 })).detail,
    '设定 26° · 室内 28.4°',
  );
  assert.equal(smartHomeStateLine('climate', state('off', { targetTemperature: 26, currentTemperature: 28 })).detail, '室内 28°');
});

// ---- deviceStatusLine / isPercentEntity（原 apps/web/src/lib/smart-home-device-copy.test.ts） ----

test('deviceStatusLine：扫地机清扫中带电量（长版写「电量」）；在座上没充满写充电中', () => {
  assert.equal(deviceStatusLine(device('vacuum', 'vacuum', state('cleaning', { battery: 62 }))).text, '正在清扫 · 62%');
  assert.equal(deviceStatusLine(device('vacuum', 'vacuum', state('cleaning', { battery: 87 })), { long: true }).text, '正在清扫 · 电量 87%');
  assert.equal(deviceStatusLine(device('vacuum', 'vacuum', state('docked', { battery: 87 }))).text, '充电中 87%');
});

test('deviceStatusLine：窗帘开了一部分、空调制冷带设定温度（长版带室内）、关着写已关', () => {
  assert.equal(deviceStatusLine(device('curtain', 'cover', state('open', { position: 40 }))).text, '开了 40%');
  const ac = state('cool', { targetTemperature: 26, currentTemperature: 27.5 });
  assert.equal(deviceStatusLine(device('air_conditioner', 'climate', ac)).text, '制冷 26°');
  assert.equal(deviceStatusLine(device('air_conditioner', 'climate', ac), { long: true }).text, '制冷 26° · 室内 27.5°');
  assert.equal(deviceStatusLine(device('air_conditioner', 'climate', state('off'))).text, '已关');
});

test('deviceStatusLine：洗衣机有剩余时长的主面板项就写「剩 N 分钟」', () => {
  const line = deviceStatusLine(
    device('washer', 'sensor', state('洗涤中'), [
      { entityId: 'sensor.left', domain: 'sensor', name: '剩余时间', state: state('23', { unit: 'min', deviceClass: 'duration' }) },
    ]),
  );
  assert.equal(line.text, '剩 23 分钟');
});

test('deviceStatusLine：净水器几支滤芯取最低的；没单位但名字写着百分比也算；低于等于 10 变暖橙', () => {
  const line = deviceStatusLine(
    device('water_purifier', 'sensor', state('90'), [
      { entityId: 'sensor.ro', domain: 'sensor', name: 'RO剩余百分比', state: state('8') },
    ]),
  );
  like(line, { text: '滤芯剩 8%', tone: 'warn' });
});

test('deviceStatusLine：离线、读不到', () => {
  assert.equal(deviceStatusLine(device('switch', 'switch', state('unavailable'))).text, '离线');
  like(deviceStatusLine(device('switch', 'switch', null)), { text: '—', tone: 'muted' });
});

test('isPercentEntity：单位 % 或名字带「百分比」', () => {
  assert.equal(isPercentEntity({ name: '初滤剩余百分比', state: state('90') }), true);
  assert.equal(isPercentEntity({ name: '电量', state: state('50', { unit: '%' }) }), true);
  assert.equal(isPercentEntity({ name: '出水TDS', state: state('8', { unit: 'ppm' }) }), false);
});
