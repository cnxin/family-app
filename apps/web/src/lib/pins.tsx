import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { shelfModuleKey, type ShelfModuleKey } from '@family/contracts';

export const PIN_LIMIT = 4;
function readPins(key: string): ShelfModuleKey[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return [...new Set(stored.filter((value): value is ShelfModuleKey => shelfModuleKey.safeParse(value).success))].slice(0, PIN_LIMIT);
  } catch {
    return [];
  }
}
interface PinsValue { pins: ShelfModuleKey[]; toggle: (key: ShelfModuleKey) => void }
const PinsContext = createContext<PinsValue | null>(null);

/** 由外壳按 memberId 挂载；隐藏只过滤显示，绝不删存储记录。 */
export function PinsProvider({ memberId, children }: { memberId: string; children: ReactNode }) {
  const storageKey = `fa.pins.${memberId}`;
  const [pins, setPins] = useState(() => readPins(storageKey));
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setPins(readPins(storageKey));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [storageKey]);
  const toggle = useCallback((key: ShelfModuleKey) => {
    setPins((current) => {
      const next = current.includes(key) ? current.filter((one) => one !== key)
        : current.length < PIN_LIMIT ? [...current, key] : current;
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* 仍保留本次会话 */ }
      return next;
    });
  }, [storageKey]);
  return <PinsContext.Provider value={{ pins, toggle }}>{children}</PinsContext.Provider>;
}
export function usePins() {
  const value = useContext(PinsContext);
  if (!value) throw new Error('usePins 必须在 PinsProvider 里用');
  return value;
}
