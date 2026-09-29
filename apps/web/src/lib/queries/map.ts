import { useEffect, useMemo } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HouseholdMap, ItemLocationHit, PutHouseholdMapBody } from '@family/contracts';
import { api, apiBlob, postForm } from '../api';
import { locationKeys } from './locations';

// I2 家庭地图。键都挂在 locations 下：/events 推 locations 时一起失效（lib/events.ts）。

export const mapKeys = {
  map: ['locations', 'map'] as const,
  /** 不挂在 locations 下：底图只随 updatedAt 换，/events 推 locations 时不必重新下载图片 */
  background: (version: string) => ['map-background', version] as const,
  find: (q: string) => ['locations', 'find', q] as const,
};

export function useHouseholdMap() {
  return useQuery({ queryKey: mapKeys.map, queryFn: () => api<HouseholdMap | null>('/map') });
}

/**
 * 底图的 object URL（底图要登录才能取，不能直接给 <image href>）。
 * 以 updatedAt 为版本：换了底图键就变；旧 URL 在换掉后回收。
 */
export function useMapBackground(map: HouseholdMap | null | undefined) {
  const version = map?.hasBackground ? map.updatedAt : '';
  const blob = useQuery({
    queryKey: mapKeys.background(version),
    queryFn: () => apiBlob('/map/background'),
    enabled: Boolean(version),
    staleTime: Infinity,
  });
  const url = useMemo(() => (blob.data ? URL.createObjectURL(blob.data) : null), [blob.data]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return version ? url : null;
}

/** 按名字找东西上次放在哪（地图搜索高亮、⌘K）；q 为空不发请求 */
export function useFindItemLocations(q: string) {
  const needle = q.trim();
  return useQuery({
    queryKey: mapKeys.find(needle),
    queryFn: () => api<ItemLocationHit[]>(`/locations/find?q=${encodeURIComponent(needle)}`),
    enabled: needle.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function usePutMap() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: PutHouseholdMapBody) => api<HouseholdMap>('/map', { method: 'PUT', body }),
    onSuccess: (map) => {
      client.setQueryData(mapKeys.map, map);
      void client.invalidateQueries({ queryKey: locationKeys.all });
    },
  });
}

export function useUploadMapBackground() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (file: Blob) => {
      const form = new FormData();
      form.append('file', file, file.type === 'image/png' ? 'map.png' : file.type === 'image/webp' ? 'map.webp' : 'map.jpg');
      return postForm<HouseholdMap>('/map/background', form);
    },
    onSuccess: (map) => client.setQueryData(mapKeys.map, map),
  });
}
