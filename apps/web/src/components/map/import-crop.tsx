import { useEffect, useRef, useState, type PointerEvent } from 'react';

// 导入向导第 1 步：拖一个框，把扫地机 App 的按钮、图例、机器人图标裁掉（item-location-plan §3 I2a）。
// 框的坐标用原图像素；四个角拖大小，框里拖位置。

export interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Grip = 'move' | 'nw' | 'ne' | 'sw' | 'se';

export function ImportCrop({
  image,
  crop,
  onCrop,
}: {
  image: HTMLImageElement;
  crop: CropBox;
  onCrop: (crop: CropBox) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const natural = { w: image.naturalWidth, h: image.naturalHeight };

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const scale = width ? width / natural.w : 1;
  const min = Math.max(40, natural.w * 0.08);

  const start = (event: PointerEvent, grip: Grip) => {
    event.preventDefault();
    event.stopPropagation();
    const origin = { x: event.clientX, y: event.clientY, crop };
    const move = (e: globalThis.PointerEvent) => {
      const dx = (e.clientX - origin.x) / scale;
      const dy = (e.clientY - origin.y) / scale;
      const c = origin.crop;
      let x1 = c.x;
      let y1 = c.y;
      let x2 = c.x + c.w;
      let y2 = c.y + c.h;
      if (grip === 'move') {
        const nx = Math.min(natural.w - c.w, Math.max(0, c.x + dx));
        const ny = Math.min(natural.h - c.h, Math.max(0, c.y + dy));
        onCrop({ x: Math.round(nx), y: Math.round(ny), w: c.w, h: c.h });
        return;
      }
      if (grip.includes('w')) x1 = Math.min(x2 - min, Math.max(0, c.x + dx));
      if (grip.includes('e')) x2 = Math.max(x1 + min, Math.min(natural.w, x2 + dx));
      if (grip.includes('n')) y1 = Math.min(y2 - min, Math.max(0, c.y + dy));
      if (grip.includes('s')) y2 = Math.max(y1 + min, Math.min(natural.h, y2 + dy));
      onCrop({ x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const s = scale;
  const grips: Grip[] = ['nw', 'ne', 'sw', 'se'];
  return (
    <div ref={box} data-import-crop className="relative w-full touch-none select-none">
      {/* 图和压暗层裁在圆角框里；抓手放外层，角上那半个不会被裁掉、点得到 */}
      <div className="relative overflow-hidden rounded-card border border-border bg-muted">
        <img src={image.src} alt="要导入的地图截图" className="block w-full" draggable={false} />
        {width ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute border-2 border-accent shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
            style={{ left: crop.x * scale, top: crop.y * scale, width: crop.w * scale, height: crop.h * scale }}
          />
        ) : null}
      </div>
      {width ? (
        <>
          <div
            role="slider"
            aria-label="裁剪框"
            aria-valuetext={`${crop.w} × ${crop.h}`}
            tabIndex={0}
            className="absolute cursor-move"
            style={{ left: crop.x * s, top: crop.y * s, width: crop.w * s, height: crop.h * s }}
            onPointerDown={(event) => start(event, 'move')}
          />
          {grips.map((grip) => (
            <div
              key={grip}
              data-crop-grip={grip}
              className="absolute size-11 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize"
              style={{
                left: (grip.includes('w') ? crop.x : crop.x + crop.w) * s,
                top: (grip.includes('n') ? crop.y : crop.y + crop.h) * s,
              }}
              onPointerDown={(event) => start(event, grip)}
            >
              <span className="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-surface" />
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}

/** 把裁好的一块画到 canvas 上（最宽 1600 px），给识别和上传用。 */
export function cropToCanvas(image: HTMLImageElement, crop: CropBox) {
  const scale = Math.min(1, 1600 / crop.w);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(crop.w * scale);
  canvas.height = Math.round(crop.h * scale);
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = scale < 1;
  context.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** 底图 ≤ 2 MB：先试 PNG（截图色块多，PNG 往往最小），太大就 JPEG，再大就缩。 */
export async function canvasToUpload(canvas: HTMLCanvasElement): Promise<Blob> {
  const encode = (source: HTMLCanvasElement, type: string, quality?: number) =>
    new Promise<Blob>((resolve, reject) => source.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片编码失败'))), type, quality));
  const limit = 1.9 * 1024 * 1024;
  let source = canvas;
  for (let round = 0; round < 4; round += 1) {
    const png = await encode(source, 'image/png');
    if (png.size <= limit) return png;
    const jpeg = await encode(source, 'image/jpeg', 0.86);
    if (jpeg.size <= limit) return jpeg;
    const smaller = document.createElement('canvas');
    smaller.width = Math.round(source.width * 0.75);
    smaller.height = Math.round(source.height * 0.75);
    smaller.getContext('2d')!.drawImage(source, 0, 0, smaller.width, smaller.height);
    source = smaller;
  }
  throw new Error('图片太大了，裁小一点再试');
}
