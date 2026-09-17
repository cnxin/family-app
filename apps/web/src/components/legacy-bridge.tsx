import { useLocation } from 'react-router-dom';
import { legacyUrl, sceneOf, segmentOf } from '../lib/nav';

/** 还没搬到新客户端的分段：说清楚现状，给一个一键回旧版的出口。 */
export function LegacyBridge() {
  const { pathname } = useLocation();
  const scene = sceneOf(pathname);
  const segment = segmentOf(scene, pathname);
  if (!segment) return null;

  return (
    <div className="mx-auto w-full max-w-[1160px] px-4 lg:mx-0 lg:px-8 pb-24 pt-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="text-4xl">{scene.icon}</span>
        <h1 className="text-xl font-semibold">{segment.label}还在旧版</h1>
        <p className="max-w-[420px] text-[13px] leading-relaxed text-ink-soft">
          新客户端正在一页一页搬，这个还没轮到。旧版功能完整，数据是同一份，
          在那边做的改动这边刷新就能看到。
        </p>
        <a
          href={legacyUrl(segment.legacy ?? '/')}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-[filter] duration-150 hover:brightness-110"
        >
          在旧版打开{segment.label} ↗
        </a>
      </div>
    </div>
  );
}
