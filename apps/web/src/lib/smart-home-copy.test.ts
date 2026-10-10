import { describe, expect, it } from 'vitest';
import type { SmartHomeEntityState } from '@family/contracts';
import {
  arrangeDirectory,
  groupByArea,
  percentLabel,
  primaryButton,
  smartHomeKind,
  smartHomeTileLine,
  todayDevices,
  type DeviceLike,
} from './smart-home-copy';

// 一句状态（smartHomeStateLine / deviceStatusLine）的用例在 packages/shared/tests/smart-home-status.test.mjs（第四批收尾挪过去）。

function state(value: string, extra: Partial<SmartHomeEntityState> = {}): SmartHomeEntityState {
  return {
    state: value,
    unit: null,
    deviceClass: null,
    position: null,
    battery: null,
    lastChanged: null,
    lastUpdated: null,
    fanSpeed: null,
    fanMode: null,
    swingMode: null,
    humidity: null,
    targetTemperature: null,
    currentTemperature: null,
    hvacModes: null,
    minTemperature: null,
    maxTemperature: null,
    assumed: false,
    ...extra,
  };
}

describe('groupByArea', () => {
  it('按分组名排，没分组的归「其他」放最后，组内顺序不变', () => {
    const groups = groupByArea([
      { id: 1, area: '阳台' },
      { id: 2, area: null },
      { id: 3, area: '客厅' },
      { id: 4, area: '客厅' },
    ]);
    expect(groups.map((group) => group.area)).toEqual(['客厅', '阳台', '其他']);
    expect(groups[0].items.map((item) => item.id)).toEqual([3, 4]);
  });
});

describe('arrangeDirectory', () => {
  const entry = (entityId: string, name: string, primary: boolean) => ({
    entityId,
    domain: entityId.split('.')[0] as never,
    name,
    fullName: `厨下净水 ${name}`,
    primary,
  });
  const devices = [
    {
      name: '厨下净水',
      entities: [
        entry('sensor.ro_life', 'RO滤芯寿命', true),
        entry('binary_sensor.ro_expiring', 'RO到期预警', true),
        entry('sensor.wifi', 'WiFi信号', false),
        entry('sensor.firmware', '固件版本', false),
      ],
    },
    { name: 'Roborock S8', entities: [entry('vacuum.s8', 'Roborock S8', true), entry('select.mop', '拖地强度', false)] },
  ];

  it('默认每台设备只摆主实体，其余折进「更多」', () => {
    const [purifier, vacuum] = arrangeDirectory(devices, { query: '', kind: 'all' });
    expect(purifier.shown.map((one) => one.name)).toEqual(['RO滤芯寿命', 'RO到期预警']);
    expect(purifier.more.map((one) => one.name)).toEqual(['WiFi信号', '固件版本']);
    expect(vacuum.more).toHaveLength(1);
  });

  it('搜到实体就直接摆出来（诊断类也是），搜不到的设备不显示', () => {
    const result = arrangeDirectory(devices, { query: '固件', kind: 'all' });
    expect(result).toHaveLength(1);
    expect(result[0].shown.map((one) => one.entityId)).toEqual(['sensor.firmware']);
    expect(result[0].more).toEqual([]);
    expect(arrangeDirectory(devices, { query: 'select.mop', kind: 'all' })[0].shown[0].name).toBe('拖地强度');
  });

  it('搜设备名：整台设备照常折叠', () => {
    const [purifier] = arrangeDirectory(devices, { query: '厨下', kind: 'all' });
    expect(purifier.shown).toHaveLength(2);
    expect(purifier.more).toHaveLength(2);
  });

  it('chip 按类型筛，筛空的设备不显示', () => {
    const vacuums = arrangeDirectory(devices, { query: '', kind: 'vacuum' });
    expect(vacuums.map((group) => group.device.name)).toEqual(['Roborock S8']);
    expect(vacuums[0].more).toEqual([]);
    const sensors = arrangeDirectory(devices, { query: '', kind: 'sensor' });
    expect(sensors.map((group) => group.device.name)).toEqual(['厨下净水']);
    expect(arrangeDirectory(devices, { query: '', kind: 'other' })[0].more[0].entityId).toBe('select.mop');
  });

  it('类型归类', () => {
    expect(smartHomeKind('light')).toBe('switch');
    expect(smartHomeKind('binary_sensor')).toBe('sensor');
    expect(smartHomeKind('scene')).toBe('other');
  });
});

describe('百分比类', () => {
  // 「是不是百分比类」isPercentEntity 的三条在 shared 的测试里
  it('短名去掉「百分比」', () => {
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
