import { describe, expect, it } from 'vitest';
import type { SmartHomeEntityState } from '@family/contracts';
import {
  deviceStatusLine,
  isPercentEntity,
  percentLabel,
  primaryButton,
  smartHomeTileLine,
  todayDevices,
  type DeviceLike,
} from './smart-home-device-copy';

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

describe('primaryButton', () => {
  it('写按下会发生什么；只读类、离线没有', () => {
    expect(primaryButton('vacuum', state('cleaning'))).toEqual({ action: 'pause', label: '暂停' });
    expect(primaryButton('vacuum', state('paused'))?.label).toBe('继续');
    expect(primaryButton('vacuum', state('docked'))?.label).toBe('开始');
    expect(primaryButton('vacuum', state('error'))).toBeNull();
    expect(primaryButton('cover', state('closed'))?.label).toBe('打开');
    expect(primaryButton('cover', state('open'))?.label).toBe('关上');
    expect(primaryButton('cover', state('closing'))?.label).toBe('停');
    expect(primaryButton('climate', state('cool'))?.label).toBe('关掉');
    expect(primaryButton('switch', state('off'))?.label).toBe('打开');
    expect(primaryButton('sensor', state('12'))).toBeNull();
    expect(primaryButton('switch', state('unavailable'))).toBeNull();
  });
});

describe('今天页设备区块与家里页状态行（H3 E5）', () => {
  const row = (name: string, extra: Partial<{ pinnedToToday: boolean; online: boolean; primaryDomain: string; primary: SmartHomeEntityState | null; icon: DeviceLike['icon'] }> = {}) => ({
    name, icon: 'switch' as DeviceLike['icon'], primaryDomain: 'switch', primary: state('off'), featured: [], pinnedToToday: false, online: true, ...extra,
  });

  it('今天页只放勾了的设备，按原顺序取前 4 台；场景不算，也不算进「全部 N 台」', () => {
    const devices = [
      row('场景', { primaryDomain: 'scene', pinnedToToday: true }),
      ...['一', '二', '三', '四', '五'].map((name) => row(name, { pinnedToToday: true })),
      row('没勾'),
    ];
    const { shown, total } = todayDevices(devices, 4);
    expect(shown.map((one) => one.name)).toEqual(['一', '二', '三', '四']);
    expect(total).toBe(6);
    expect(todayDevices([row('没勾')], 4).shown).toEqual([]);
  });

  it('状态行：连着数运行 / 要留意 / 离线；都没开写「都歇着」；断开、没连、没设备分别处理', () => {
    const connected = { configured: true, available: true };
    const running = row('扫地机', { icon: 'vacuum', primaryDomain: 'vacuum', primary: state('cleaning', { battery: 60 }) });
    const low = row('净水', { icon: 'water_purifier', primaryDomain: 'sensor', primary: state('8', { unit: '%' }) });
    const gone = row('插座', { online: false, primary: state('unavailable') });
    expect(smartHomeTileLine({ connection: connected, devices: [running, low, gone, row('灯')] })).toBe(
      '4 台设备 · 1 台在运行 · 1 台要留意 · 1 台离线',
    );
    expect(smartHomeTileLine({ connection: connected, devices: [row('灯')] })).toBe('1 台设备 · 都歇着');
    expect(smartHomeTileLine({ connection: { configured: true, available: false }, devices: [row('灯')] })).toBe('连不上 Home Assistant');
    expect(smartHomeTileLine({ connection: { configured: false, available: false }, devices: [] })).toBeUndefined();
    expect(smartHomeTileLine({ connection: connected, devices: [row('场景', { primaryDomain: 'scene' })] })).toBeUndefined();
  });
});
