import { describe, expect, it } from 'vitest';
import { choiceLayout, formatWithUnit, releasedEntities, snapToStep } from './smart-home-controls';

describe('snapToStep', () => {
  it('收进范围并对齐步长', () => {
    expect(snapToStep(55.4, 0, 100, 1)).toBe(55);
    expect(snapToStep(120, 0, 100, 1)).toBe(100);
    expect(snapToStep(-3, 0, 100, 5)).toBe(0);
    expect(snapToStep(26.3, 16, 30, 0.5)).toBe(26.5);
  });

  it('步长从最小值起算、没有浮点尾巴', () => {
    expect(snapToStep(0.1 + 0.2, 0, 1, 0.1)).toBe(0.3);
    expect(snapToStep(16.9, 16.5, 30, 1)).toBe(16.5);
    expect(snapToStep(17, 16.5, 30, 1)).toBe(17.5);
  });
});

describe('formatWithUnit', () => {
  it('百分比、温度贴着写，其余空一格；小数位跟步长', () => {
    expect(formatWithUnit(60, '%')).toBe('60%');
    expect(formatWithUnit(26.5, '°C', 0.5)).toBe('26.5°C');
    expect(formatWithUnit(3, 'min')).toBe('3 min');
    expect(formatWithUnit(7, null)).toBe('7');
  });
});

describe('choiceLayout', () => {
  it('4 项以内分段，再多下拉', () => {
    expect(choiceLayout(4)).toBe('segmented');
    expect(choiceLayout(5)).toBe('dropdown');
  });
});

describe('releasedEntities', () => {
  const pending = {
    'select.a': { requestId: '1', baseline: '2026-09-29T01:00:00Z', value: 'high' },
    'number.b': { requestId: '2', baseline: null, value: 3 },
    'switch.c': { requestId: '3', baseline: '2026-09-29T01:00:00Z', value: undefined },
  };

  it('lastUpdated 变了才放锁；没变、还没读到的不放', () => {
    expect(
      releasedEntities(pending, {
        'select.a': '2026-09-29T01:00:05Z',
        'number.b': null,
      }).sort(),
    ).toEqual(['select.a']);
    expect(releasedEntities(pending, { 'number.b': '2026-09-29T01:00:05Z' })).toEqual(['number.b']);
  });
});
