/// <reference lib="webworker" />
import { detectRooms, suggestCrop, type DetectInput } from './detect-rooms';

// 房间识别和建议裁剪框都在 Worker 里跑，主线程只管画面（item-location-plan §3 I2a；API 不加图像依赖）。

type Request = { id: number; kind: 'crop' | 'detect'; image: DetectInput };

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, kind, image } = event.data;
  try {
    const result = kind === 'crop' ? suggestCrop(image) : detectRooms(image, () => performance.now());
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, message: error instanceof Error ? error.message : String(error) });
  }
};
