import { lazy, type ComponentType } from 'react';

const RELOAD_FLAG = 'family-app.chunk-reload';

function readFlag() {
  try {
    return sessionStorage.getItem(RELOAD_FLAG) === '1';
  } catch {
    return false;
  }
}

function writeFlag(on: boolean) {
  try {
    if (on) sessionStorage.setItem(RELOAD_FLAG, '1');
    else sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    // 隐私模式等拿不到 sessionStorage：只是少了防重入，照常刷新
  }
}

/**
 * 页面按路由懒加载：各页的代码只在第一次进入时才下载，首屏不用背着 45 个页面。
 *
 * 发版后资源文件名会换，开着的旧标签页再点进一个没进过的页面，取到的是已经不存在的分块（404）。
 * 这时整页刷新一次拿新的 index.html；用 sessionStorage 记一笔只刷一次，真坏了就把错误抛给上层，不会反复刷。
 */
export function lazyPage<M extends Record<string, unknown>, K extends keyof M>(
  loader: () => Promise<M>,
  name: K,
) {
  return lazy(async () => {
    try {
      const mod = await loader();
      writeFlag(false);
      return { default: mod[name] as ComponentType };
    } catch (error) {
      if (readFlag()) throw error;
      writeFlag(true);
      window.location.reload();
      // 刷新已经发出，这里一直挂起，免得先闪一下错误页
      return new Promise<{ default: ComponentType }>(() => {});
    }
  });
}

/** 给单测用：只暴露决策，不碰 React。 */
export function shouldReloadForChunkError() {
  if (readFlag()) return false;
  writeFlag(true);
  return true;
}

export function clearChunkReloadFlag() {
  writeFlag(false);
}
