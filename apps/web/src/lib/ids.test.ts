import { afterEach, describe, expect, it } from 'vitest';
import { newId } from './ids';

// 局域网 IP 打开（不安全上下文）时没有 crypto.randomUUID，newId 要退到 getRandomValues 拼 UUID v4。

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const original = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID');

describe('newId', () => {
  afterEach(() => {
    // node 里 randomUUID 在原型上，测试只是在实例上盖了一层：删掉那层就恢复
    if (original) Object.defineProperty(globalThis.crypto, 'randomUUID', original);
    else Reflect.deleteProperty(globalThis.crypto, 'randomUUID');
  });

  it('有 randomUUID 时用它', () => {
    expect(newId()).toMatch(V4);
  });

  it('没有 randomUUID（不安全上下文）时照样给合法的 v4，且不重复', () => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
    const ids = new Set(Array.from({ length: 200 }, () => newId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(V4);
  });
});
