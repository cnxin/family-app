// 选择器记住「上次用的位置」，下次打开默认高亮它（item-location-plan §3 I1）。按成员存在本机，换设备不跟着走。

const key = (memberId: string) => `fa.lastLocation.${memberId}`;

export function rememberedLocation(memberId: string | undefined): string | null {
  if (!memberId || typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key(memberId));
  } catch {
    return null;
  }
}

export function rememberLocation(memberId: string | undefined, locationId: string) {
  if (!memberId) return;
  try {
    window.localStorage.setItem(key(memberId), locationId);
  } catch {
    // 存不进去就算了：只是少一个默认值
  }
}

/** 这个位置的上级链（从房间开始），用来把选择器直接打开到它所在的那一层。 */
export function ancestorsOf(locations: { id: string; parentId: string | null }[], id: string | null): string[] {
  const byId = new Map(locations.map((one) => [one.id, one]));
  const chain: string[] = [];
  let current = id ? byId.get(id) : undefined;
  while (current?.parentId && chain.length < 3) {
    chain.unshift(current.parentId);
    current = byId.get(current.parentId);
  }
  return chain;
}
