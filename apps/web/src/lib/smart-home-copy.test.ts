import { describe, expect, it } from 'vitest';
import type { SmartHomeEntityState } from '@family/contracts';
import { arrangeDirectory, groupByArea, smartHomeButtons, smartHomeKind, smartHomeStateLine } from './smart-home-copy';

function state(value: string, extra: Partial<SmartHomeEntityState> = {}): SmartHomeEntityState {
  return {
    state: value,
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
    ...extra,
  };
}

describe('smartHomeStateLine', () => {
  it('连不上时一律一条横线，离线 / 不知道单独说', () => {
    expect(smartHomeStateLine('vacuum', null)).toEqual({ text: '—', detail: null, tone: 'muted' });
    expect(smartHomeStateLine('cover', state('unavailable')).text).toBe('离线');
    expect(smartHomeStateLine('sensor', state('unknown')).text).toBe('不知道');
  });

  it('扫地机：状态说人话，带电量', () => {
    expect(smartHomeStateLine('vacuum', state('cleaning', { battery: 62 }))).toEqual({
      text: '正在清扫',
      detail: '电量 62%',
      tone: 'on',
    });
    expect(smartHomeStateLine('vacuum', state('docked')).text).toBe('在充电座上');
    expect(smartHomeStateLine('vacuum', state('error')).tone).toBe('warn');
  });

  it('窗帘：开着带开合百分比，全开、关着不带', () => {
    expect(smartHomeStateLine('cover', state('open', { position: 80 }))).toMatchObject({ text: '开着', detail: '开了 80%' });
    expect(smartHomeStateLine('cover', state('open', { position: 100 })).detail).toBeNull();
    expect(smartHomeStateLine('cover', state('closed', { position: 0 }))).toMatchObject({ text: '关着', detail: null });
  });

  it('传感器：数值 + 中文单位，百分号紧跟', () => {
    expect(smartHomeStateLine('sensor', state('38', { unit: 'min' })).text).toBe('38 分钟');
    expect(smartHomeStateLine('sensor', state('12', { unit: '%' })).text).toBe('12%');
    expect(smartHomeStateLine('sensor', state('23.46', { unit: '°C' })).text).toBe('23.5°C');
    expect(smartHomeStateLine('sensor', state('2026-09-28T06:30:00+00:00', { deviceClass: 'timestamp' })).text).toBe('14:30');
  });

  it('二元传感器按 device_class 说', () => {
    expect(smartHomeStateLine('binary_sensor', state('on', { deviceClass: 'running' })).text).toBe('运行中');
    expect(smartHomeStateLine('binary_sensor', state('off', { deviceClass: 'running' })).text).toBe('没在运行');
    expect(smartHomeStateLine('binary_sensor', state('on')).text).toBe('是');
  });

  it('开关类与空调', () => {
    expect(smartHomeStateLine('switch', state('on')).tone).toBe('on');
    expect(smartHomeStateLine('light', state('off')).text).toBe('关着');
    expect(smartHomeStateLine('climate', state('cool')).text).toBe('制冷');
    expect(smartHomeStateLine('climate', state('heat', { targetTemperature: 26, currentTemperature: 28.4 })).detail).toBe(
      '设定 26° · 室内 28.4°',
    );
    expect(smartHomeStateLine('climate', state('off', { targetTemperature: 26, currentTemperature: 28 })).detail).toBe('室内 28°');
  });
});

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

describe('smartHomeButtons', () => {
  const labels = (domain: Parameters<typeof smartHomeButtons>[0], value: string | null) =>
    smartHomeButtons(domain, value === null ? null : state(value)).map((one) => one.label);

  it('扫地机按当前状态只摆说得通的', () => {
    expect(labels('vacuum', 'docked')).toEqual(['开始清扫']);
    expect(labels('vacuum', 'cleaning')).toEqual(['暂停', '回充']);
    expect(labels('vacuum', 'paused')).toEqual(['继续清扫', '回充']);
    expect(labels('vacuum', 'returning')).toEqual(['暂停']);
    expect(labels('vacuum', null)).toEqual(['开始清扫']);
  });

  it('窗帘开停关、开关按现状反着来、场景执行、传感器没有按钮', () => {
    expect(labels('cover', 'open')).toEqual(['打开', '停', '关上']);
    expect(labels('switch', 'on')).toEqual(['关掉']);
    expect(labels('switch', 'off')).toEqual(['打开']);
    expect(labels('scene', '2026-09-28T00:00:00Z')).toEqual(['执行']);
    expect(labels('sensor', '12')).toEqual([]);
  });
});

describe('空调按钮（试探性）', () => {
  it('关着只给「打开」；开着给关掉、其余模式、调温', () => {
    expect(smartHomeButtons('climate', state('off')).map((one) => one.label)).toEqual(['打开']);
    expect(smartHomeButtons('climate', state('cool')).map((one) => one.label)).toEqual([
      '关掉', '制热', '送风', '自动', '调低 1°', '调高 1°',
    ]);
  });

  it('只摆 HA 说这台有的模式', () => {
    const buttons = smartHomeButtons('climate', state('cool', { hvacModes: ['off', 'cool', 'heat'] }));
    expect(buttons.map((one) => one.action)).toEqual(['turn_off', 'mode_heat', 'temperature_down', 'temperature_up']);
  });
});
