import { describe, expect, it } from 'vitest';
import { ancestorsOf } from './location-memory';

describe('ancestorsOf', () => {
  const rows = [
    { id: 'room', parentId: null },
    { id: 'cabinet', parentId: 'room' },
    { id: 'shelf', parentId: 'cabinet' },
  ];

  it('层格的上级链是 房间 → 柜子；房间没有上级；找不到或没给为空', () => {
    expect(ancestorsOf(rows, 'shelf')).toEqual(['room', 'cabinet']);
    expect(ancestorsOf(rows, 'room')).toEqual([]);
    expect(ancestorsOf(rows, 'missing')).toEqual([]);
    expect(ancestorsOf(rows, null)).toEqual([]);
  });
});
