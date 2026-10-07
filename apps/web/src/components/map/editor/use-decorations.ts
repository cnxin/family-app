import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { HouseholdMap, MapDecoration } from '@family/contracts';
import { ApiError, api } from '../../../lib/api';
import { mapKeys } from '../../../lib/queries';
import { pushToast } from '../../../lib/toast';

// 装饰类家具（地图编辑器 v2 §3.4）：整列替换，带版本号。先写缓存（画面立刻变），再排队 PUT——
// 一次只发一个，下一次用上一次回来的版本号，免得自己的连续操作撞 409；真撞了（别的设备刚改过）就提示并重新拉。

/** 老缓存里没有 decorations：给一个固定的空数组（画布靠 items 引用判断预览是否作废） */
const NONE: MapDecoration[] = [];

export function useDecorations(map: HouseholdMap) {
  const client = useQueryClient();
  const version = useRef(map.decorationsVersion ?? 0);
  const pending = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  // 没有在途请求时跟着服务端走（别的设备改了、/events 推过来重拉）
  useEffect(() => {
    if (!pending.current) version.current = map.decorationsVersion ?? 0;
  }, [map.decorationsVersion]);

  const save = useCallback(
    (items: MapDecoration[]): Promise<boolean> => {
      client.setQueryData<HouseholdMap | null>(mapKeys.map, (old) => (old ? { ...old, decorations: items } : old));
      pending.current += 1;
      const run = chain.current.then(async () => {
        try {
          const next = await api<HouseholdMap>('/map/decorations', { method: 'PUT', body: { version: version.current, items } });
          version.current = next.decorationsVersion;
          // 后面还有排着的：别拿这次的结果盖掉更新的本地状态
          if (pending.current === 1) client.setQueryData(mapKeys.map, next);
          return true;
        } catch (error) {
          pushToast(error instanceof ApiError && error.status === 409 ? '家具刚在别的设备上改过，已重新载入' : '家具没保存上，检查一下网络', undefined, 'error');
          await client.invalidateQueries({ queryKey: mapKeys.map });
          // 重拉回来的是服务端现在的版本：接着用它（上面的 effect 在请求还挂着时不会同步）
          version.current = client.getQueryData<HouseholdMap | null>(mapKeys.map)?.decorationsVersion ?? version.current;
          return false;
        } finally {
          pending.current -= 1;
        }
      });
      chain.current = run;
      return run;
    },
    [client],
  );

  const flush = useCallback(() => chain.current.then(() => undefined), []);

  const items = map.decorations ?? NONE;
  return useMemo(() => ({ items, save, flush }), [items, save, flush]);
}
