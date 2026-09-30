// 生成 UUID v4。crypto.randomUUID 只在安全上下文（HTTPS / localhost）里有——家里人用局域网 IP
// （http://192.168.x.x:8088）打开就是不安全上下文，直接调会抛「crypto.randomUUID is not a function」。
// crypto.getRandomValues 在不安全上下文也能用，拿它拼一个。源码里不要直接写 crypto.randomUUID（静态检查会拦）。

export function newId(): string {
  const native = globalThis.crypto && 'randomUUID' in globalThis.crypto ? globalThis.crypto.randomUUID : undefined;
  if (typeof native === 'function') return native.call(globalThis.crypto);
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // 版本 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 变体
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
