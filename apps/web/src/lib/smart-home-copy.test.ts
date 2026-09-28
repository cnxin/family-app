import { describe, expect, it } from 'vitest';
import type { SmartHomeEntityState } from '@family/contracts';
import { groupByArea, smartHomeStateLine } from './smart-home-copy';

function state(value: string, extra: Partial<SmartHomeEntityState> = {}): SmartHomeEntityState {
  return { state: value, unit: null, deviceClass: null, position: null, battery: null, lastChanged: null, ...extra };
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
