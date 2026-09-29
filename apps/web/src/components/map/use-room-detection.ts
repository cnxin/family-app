import { useCallback, useRef, useState } from 'react';
import type { MapPolygon } from '@family/contracts';
import { detectRoomsInWorker } from '../../lib/floorplan/run-detect';
import type { RoomDraft } from './import-name';

export type DetectState =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'done'; count: number; ms: number }
  | { state: 'failed'; message: string };

/**
 * 导入向导第 2 步的自动识别（item-location-plan §3 I2a）：在 Worker 里跑，结果只是草稿。
 * 认不出（纯手绘图、黑白图）或出错都不是死路：回到手画，草稿保持空。
 * 每张裁好的图只自动跑一次；「重新识别」手动再来。
 */
export function useRoomDetection(onDrafts: (drafts: RoomDraft[]) => void) {
  const [status, setStatus] = useState<DetectState>({ state: 'idle' });
  const token = useRef(0);

  const run = useCallback(
    async (canvas: HTMLCanvasElement) => {
      const mine = (token.current += 1);
      setStatus({ state: 'running' });
      try {
        const result = await detectRoomsInWorker(canvas);
        if (mine !== token.current) return;
        onDrafts(
          result.rooms.map((room) => ({
            id: crypto.randomUUID(),
            name: '',
            shape: { type: 'polygon', points: room.points } as MapPolygon,
          })),
        );
        setStatus(result.rooms.length ? { state: 'done', count: result.rooms.length, ms: result.ms } : { state: 'failed', message: '没认出房间' });
      } catch (error) {
        if (mine !== token.current) return;
        setStatus({ state: 'failed', message: error instanceof Error ? error.message : '识别失败' });
      }
    },
    [onDrafts],
  );

  /** 换了图 / 重新裁剪：作废进行中的那次 */
  const reset = useCallback(() => {
    token.current += 1;
    setStatus({ state: 'idle' });
  }, []);

  return { status, run, reset };
}
