import { describe, expect, it } from 'vitest';
import type { SmartHomeEntityState } from '@family/contracts';
import { deviceStatusLine, isPercentEntity, percentLabel, type DeviceLike } from './smart-home-device-copy';

function state(value: string, extra: Partial<SmartHomeEntityState> = {}): SmartHomeEntityState {
  return {
    state: value, unit: null, deviceClass: null, position: null, battery: null, lastChanged: null, lastUpdated: null,
    targetTemperature: null, currentTemperature: null, hvacModes: null, minTemperature: null, maxTemperature: null,
    assumed: false, fanSpeed: null, fanMode: null, swingMode: null, humidity: null, ...extra,
  };
}
const device = (icon: DeviceLike['icon'], primaryDomain: string, primary: SmartHomeEntityState | null, featured: DeviceLike['featured'] = []) =>
  ({ icon, primaryDomain, primary, featured }) satisfies DeviceLike;

describe('deviceStatusLine', () => {
  it('扫地机：清扫中带电量（长版写「电量」）；在座上没充满写充电中', () => {
    expect(deviceStatusLine(device('vacuum', 'vacuum', state('cleaning', { battery: 62 }))).text).toBe('正在清扫 · 62%');
    expect(deviceStatusLine(device('vacuum', 'vacuum', state('cleaning', { battery: 87 })), { long: true }).text).toBe('正在清扫 · 电量 87%');
    expect(deviceStatusLine(device('vacuum', 'vacuum', state('docked', { battery: 87 }))).text).toBe('充电中 87%');
  });

  it('窗帘开了一部分、空调制冷带设定温度（长版带室内）、关着写已关', () => {
    expect(deviceStatusLine(device('curtain', 'cover', state('open', { position: 40 }))).text).toBe('开了 40%');
    const ac = state('cool', { targetTemperature: 26, currentTemperature: 27.5 });
    expect(deviceStatusLine(device('air_conditioner', 'climate', ac)).text).toBe('制冷 26°');
    expect(deviceStatusLine(device('air_conditioner', 'climate', ac), { long: true }).text).toBe('制冷 26° · 室内 27.5°');
    expect(deviceStatusLine(device('air_conditioner', 'climate', state('off'))).text).toBe('已关');
  });

  it('洗衣机：有剩余时长的主面板项就写「剩 N 分钟」', () => {
    const line = deviceStatusLine(
      device('washer', 'sensor', state('洗涤中'), [
        { entityId: 'sensor.left', domain: 'sensor', name: '剩余时间', state: state('23', { unit: 'min', deviceClass: 'duration' }) },
      ]),
    );
    expect(line.text).toBe('剩 23 分钟');
  });

  it('净水器：几支滤芯取最低的；没单位但名字写着百分比也算；低于等于 10 变暖橙', () => {
    const line = deviceStatusLine(
      device('water_purifier', 'sensor', state('90'), [
        { entityId: 'sensor.ro', domain: 'sensor', name: 'RO剩余百分比', state: state('8') },
      ]),
    );
    expect(line).toMatchObject({ text: '滤芯剩 8%', tone: 'warn' });
  });

  it('离线、读不到', () => {
    expect(deviceStatusLine(device('switch', 'switch', state('unavailable'))).text).toBe('离线');
    expect(deviceStatusLine(device('switch', 'switch', null))).toMatchObject({ text: '—', tone: 'muted' });
  });
});

describe('百分比类', () => {
  it('单位 % 或名字带「百分比」；短名去掉「百分比」', () => {
    expect(isPercentEntity({ name: '初滤剩余百分比', state: state('90') })).toBe(true);
    expect(isPercentEntity({ name: '电量', state: state('50', { unit: '%' }) })).toBe(true);
    expect(isPercentEntity({ name: '出水TDS', state: state('8', { unit: 'ppm' }) })).toBe(false);
    expect(percentLabel('初滤剩余百分比')).toBe('初滤剩余');
  });
});
