import type { CropBox } from '../../components/map/import-crop';
import type { DetectResult } from './detect-rooms';

// 主线程这边：把图片像素交给 Worker（转移缓冲区，不拷贝），等结果；超时或出错交给调用方落到手画。

const TIMEOUT = 15_000;
let worker: Worker | null = null;
let seq = 0;

function pixels(source: HTMLCanvasElement | HTMLImageElement) {
  const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(source, 0, 0);
  const { data } = context.getImageData(0, 0, width, height);
  return { width, height, data };
}

function run<T>(kind: 'crop' | 'detect', source: HTMLCanvasElement | HTMLImageElement): Promise<T> {
  worker ??= new Worker(new URL('./detect-rooms.worker.ts', import.meta.url), { type: 'module' });
  const current = worker;
  const id = (seq += 1);
  const image = pixels(source);
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      // 卡住的 Worker 不要了，下次重新起
      current.terminate();
      if (worker === current) worker = null;
      reject(new Error('识别超时'));
    }, TIMEOUT);
    const onMessage = (event: MessageEvent<{ id: number; ok: boolean; result?: T; message?: string }>) => {
      if (event.data.id !== id) return;
      cleanup();
      if (event.data.ok) resolve(event.data.result as T);
      else reject(new Error(event.data.message ?? '识别失败'));
    };
    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(event.message || '识别失败'));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      current.removeEventListener('message', onMessage);
      current.removeEventListener('error', onError);
    };
    current.addEventListener('message', onMessage);
    current.addEventListener('error', onError);
    current.postMessage({ id, kind, image }, [image.data.buffer]);
  });
}

/** 截图里房间所在的外接框，导入向导第 1 步的默认裁剪 */
export const suggestCropInWorker = (image: HTMLImageElement) => run<CropBox>('crop', image);
/** 裁好的图 → 房间多边形草稿（坐标在 viewBox 里） */
export const detectRoomsInWorker = (canvas: HTMLCanvasElement) => run<DetectResult>('detect', canvas);
