import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearChunkReloadFlag, shouldReloadForChunkError } from './lazy-page';

/** 用一个最简的内存版 sessionStorage 顶替（vitest 跑在 node 环境）。 */
function installSessionStorage(store: Map<string, string> | null) {
  const stub = store
    ? {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      }
    : {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => {
          throw new Error('SecurityError');
        },
        removeItem: () => {
          throw new Error('SecurityError');
        },
      };
  Object.defineProperty(globalThis, 'sessionStorage', { value: stub, configurable: true });
}

describe('懒加载分块取不到时的整页刷新', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    installSessionStorage(store);
  });
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'sessionStorage');
  });

  it('第一次失败刷新，并记一笔；紧接着再失败不刷新（防死循环）', () => {
    expect(shouldReloadForChunkError()).toBe(true);
    expect(store.get('family-app.chunk-reload')).toBe('1');
    expect(shouldReloadForChunkError()).toBe(false);
  });

  it('某个分块加载成功后清掉标记，下次发版再 404 还能刷新一次', () => {
    expect(shouldReloadForChunkError()).toBe(true);
    clearChunkReloadFlag();
    expect(store.has('family-app.chunk-reload')).toBe(false);
    expect(shouldReloadForChunkError()).toBe(true);
  });

  it('拿不到 sessionStorage（隐私模式）时照常刷新，不抛错', () => {
    installSessionStorage(null);
    expect(shouldReloadForChunkError()).toBe(true);
    expect(() => clearChunkReloadFlag()).not.toThrow();
  });
});
