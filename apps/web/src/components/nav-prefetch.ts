import { useQueryClient } from '@tanstack/react-query';
import type { NavScene, NavSegment } from '../lib/nav';
import { useAuth } from '../lib/auth';
import { prefetchRoute } from '../lib/prefetch';

/** 指针一碰就预取；等手指抬起来路由切过去，数据多半已经在缓存里了。 */
export function usePrefetch() {
  const client = useQueryClient();
  const { session } = useAuth();
  return {
    bind: (path: string) => ({
      onPointerEnter: () => prefetchRoute(client, path, session?.member),
      onPointerDown: () => prefetchRoute(client, path, session?.member),
    }),
    /** 弹出面板时把这一组都预取掉——面板停留的那一两秒正好用来拉数据。 */
    all: (segments: NavSegment[]) => {
      for (const segment of segments) {
        if (segment.ready && segment.path) prefetchRoute(client, segment.path, session?.member);
      }
    },
  };
}

export function segmentHref(scene: NavScene, segment: NavSegment) {
  return segment.ready && segment.path ? segment.path : `${scene.path}/${segment.key}`;
}

