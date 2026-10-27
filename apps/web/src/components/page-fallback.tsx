import { useEffect, useState } from 'react';
import { ListSkeleton } from './skeleton';

/**
 * 懒加载页面下载中的占位。局域网里一个分块几毫秒就到，先空着 150ms，超过了再出骨架屏；
 * 否则每次切页都闪一下骨架，比什么都不显示更晃眼。出现时用 ease-out 淡入。
 */
export function PageFallback({ delayMs = 150 }: { delayMs?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);
  if (!show) return null;
  return (
    <div className="p-3 motion-safe:animate-[float-in_150ms_cubic-bezier(0,0,0.2,1)]" aria-busy>
      <ListSkeleton rows={5} />
    </div>
  );
}
