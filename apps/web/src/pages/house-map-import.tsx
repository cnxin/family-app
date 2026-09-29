import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MAP_VIEWBOX_MAX_HEIGHT, MAP_VIEWBOX_WIDTH, type MapPolygon, type StorageLocation } from '@family/contracts';
import { shapePoints } from '@family/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { locationKeys, useHouseholdMap, useLocations, usePutMap, useUploadMapBackground } from '../lib/queries';
import { pushToast } from '../lib/toast';
import { canvasToUpload, cropToCanvas, ImportCrop, type CropBox } from '../components/map/import-crop';
import { ImportName, type RoomDraft } from '../components/map/import-name';
import { MapCanvas } from '../components/map/map-canvas';
import type { MapItem, MapTool } from '../components/map/map-types';
import { useSoftNavigate } from '../components/soft-link';
import { Button, EmptyState, Page, Panel, Segmented } from '../components/ui';

/**
 * /house/map/import：导入向导（item-location-plan §3 I2a），四步每步可退回：
 * ① 裁剪 ② 房间（在截图上拖矩形手画；自动识别另接）③ 起名字 ④ 完成。
 * 手画这条路从第一天起就得能走通：识别不到、识别得不对，都落到这里接着画。
 */

const STEPS = ['裁剪', '房间', '名字', '完成'] as const;

export function HouseMapImportPage() {
  const { session } = useAuth();
  const manager = session?.member.role !== 'member';
  const navigate = useSoftNavigate();
  const client = useQueryClient();
  const map = useHouseholdMap();
  const locations = useLocations(false);
  const putMap = usePutMap();
  const upload = useUploadMapBackground();
  const [step, setStep] = useState(0);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<CropBox | null>(null);
  const [cropped, setCropped] = useState<{ canvas: HTMLCanvasElement; url: string } | null>(null);
  const [drafts, setDrafts] = useState<RoomDraft[]>([]);
  const [tool, setTool] = useState<MapTool>('room');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => () => {
    if (cropped) URL.revokeObjectURL(cropped.url);
  }, [cropped]);

  const viewBox = useMemo(() => {
    if (!cropped) return { w: MAP_VIEWBOX_WIDTH, h: MAP_VIEWBOX_WIDTH } as const;
    const h = Math.round((MAP_VIEWBOX_WIDTH * cropped.canvas.height) / cropped.canvas.width);
    return { w: MAP_VIEWBOX_WIDTH, h: Math.min(MAP_VIEWBOX_MAX_HEIGHT, Math.max(100, h)) } as const;
  }, [cropped]);
  const items = useMemo<MapItem[]>(
    () => drafts.map((one, index) => ({ id: one.id, parentId: null, kind: 'room', name: one.name || `房间 ${index + 1}`, shape: one.shape })),
    [drafts],
  );
  const rooms = (locations.data ?? []).filter((one) => one.kind === 'room' && !one.systemKey);
  const hadShapes = (locations.data ?? []).some((one) => one.mapShape);
  const names = drafts.map((one) => one.name.trim());
  const namesOk = drafts.length > 0 && names.every(Boolean) && new Set(names).size === names.length;

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      pushToast('要一张图片（扫地机 App 里的地图截图）');
      return;
    }
    const url = URL.createObjectURL(file);
    const next = new Image();
    next.onload = () => {
      setImage(next);
      setCrop({ x: 0, y: 0, w: next.naturalWidth, h: next.naturalHeight });
      setDrafts([]);
    };
    next.onerror = () => pushToast('这张图打不开，换一张试试');
    next.src = url;
  };

  const confirmCrop = () => {
    if (!image || !crop) return;
    const canvas = cropToCanvas(image, crop);
    canvas.toBlob((blob) => {
      if (!blob) return;
      setCropped({ canvas, url: URL.createObjectURL(blob) });
      setDrafts([]);
      setStep(1);
    });
  };

  const finish = async () => {
    if (!cropped || !namesOk) return;
    setSaving(true);
    try {
      await putMap.mutateAsync({ viewBox, ...(map.data ? { clearShapes: true } : {}) });
      await upload.mutateAsync(await canvasToUpload(cropped.canvas));
      for (const draft of drafts) {
        const name = draft.name.trim();
        const existing = rooms.find((one) => one.name === name);
        const room = existing ?? (await api<StorageLocation>('/locations', { method: 'POST', body: { name } }));
        await api<StorageLocation>(`/locations/${room.id}/shape`, { method: 'PATCH', body: { mapShape: draft.shape } });
      }
      await client.invalidateQueries({ queryKey: locationKeys.all });
      navigator.vibrate?.(12);
      pushToast(`地图导好了：${drafts.length} 个房间`);
      navigate('/house/map');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '导入失败');
    } finally {
      setSaving(false);
    }
  };

  if (!manager) {
    return (
      <Page title="导入家庭地图">
        <Panel><EmptyState emoji="🗺️" title="家庭地图由管理员来画" hint="画好之后在「地图」里就能看" /></Panel>
      </Page>
    );
  }

  const canNext = [Boolean(image && crop), drafts.length > 0, namesOk, false][step];
  return (
    <Page
      title="导入家庭地图"
      subtitle={`第 ${step + 1} 步 · ${STEPS[step]}`}
      actions={
        <div className="flex gap-2">
          <Button variant="ghost" className="min-h-11 border border-border" onClick={() => (step === 0 ? navigate('/house/map') : setStep(step - 1))}>
            {step === 0 ? '取消' : '上一步'}
          </Button>
          {step < 3 ? (
            <Button className="min-h-11" disabled={!canNext} onClick={() => (step === 0 ? confirmCrop() : setStep(step + 1))}>
              下一步
            </Button>
          ) : (
            <Button className="min-h-11" disabled={!namesOk || saving} onClick={() => void finish()}>
              {saving ? '保存中…' : '完成'}
            </Button>
          )}
        </div>
      }
      toolbar={
        <ol className="flex gap-1.5 text-[12.5px]" aria-label="步骤">
          {STEPS.map((label, index) => (
            <li key={label} aria-current={index === step ? 'step' : undefined}
              className={'rounded-full px-3 py-1 ' + (index === step ? 'bg-accent-soft font-medium text-accent' : index < step ? 'text-ink' : 'text-ink-soft')}>
              {index + 1} {label}
            </li>
          ))}
        </ol>
      }
    >
      <div data-import-step={step} className="flex min-h-0 w-full flex-1 flex-col gap-3">
        {step === 0 ? (
          <>
            <label className="flex min-h-11 w-fit cursor-pointer items-center rounded-lg border border-border bg-surface px-4 text-[14px] hover:bg-muted">
              {image ? '换一张图' : '选一张扫地机地图截图'}
              <input type="file" accept="image/*" className="sr-only" aria-label="选择地图截图" onChange={(event) => pickFile(event.target.files?.[0])} />
            </label>
            {image && crop ? (
              <>
                <p className="text-[13px] text-ink-soft">拖四个角把 App 的按钮、图例、机器人图标框到外面，只留房间。</p>
                {/* 整张图一屏看得全：宽度按图的比例限制在 62vh 高以内 */}
                <div className="mx-auto w-full" style={{ maxWidth: `min(640px, calc(62vh * ${image.naturalWidth / image.naturalHeight}))` }}>
                  <ImportCrop image={image} crop={crop} onCrop={setCrop} />
                </div>
              </>
            ) : (
              <Panel><EmptyState emoji="🧹" title="扫地机 App →「地图」→ 截图" hint="石头、追觅、米家都行；没有扫地机，拍一张户型图也可以，后面自己画房间" /></Panel>
            )}
          </>
        ) : null}
        {step === 1 && cropped ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented value={tool} onChange={setTool} options={[{ value: 'room', label: '画房间' }, { value: 'select', label: '改形状' }]} />
              {selectedId ? (
                <Button variant="ghost" className="min-h-10 border border-border text-danger" onClick={() => { setDrafts(drafts.filter((one) => one.id !== selectedId)); setSelectedId(null); }}>
                  删掉选中的
                </Button>
              ) : null}
              <span className="text-[13px] text-ink-soft">已画 {drafts.length} 个房间</span>
            </div>
            <p className="text-[13px] text-ink-soft">
              {tool === 'room' ? '按着房间的边拖一个矩形；L 形房间先画一个矩形，再到「改形状」里拖顶点、双击边加顶点。灰色没扫到的地方不用画。' : '点一个房间出顶点：拖顶点改形状，双击边加顶点，右键顶点删掉。'}
            </p>
            <div className="relative h-[60vh] min-h-[320px] overflow-hidden rounded-card border border-border bg-muted lg:h-auto lg:flex-1">
              <MapCanvas
                label="在截图上画房间"
                viewBox={viewBox}
                items={items}
                background={cropped.url}
                mode="edit-full"
                tool={tool}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onHint={pushToast}
                onShapesChange={(changes) =>
                  setDrafts((list) => list.map((one) => {
                    const change = changes.find((c) => c.id === one.id);
                    return change && change.shape.type === 'polygon' ? { ...one, shape: change.shape } : one;
                  }))
                }
                onDraw={(_kind, rect) => {
                  const id = crypto.randomUUID();
                  setDrafts((list) => [...list, { id, name: '', shape: { type: 'polygon', points: shapePoints(rect) } as MapPolygon }]);
                  setSelectedId(id);
                }}
              />
            </div>
          </>
        ) : null}
        {step === 2 && cropped ? (
          <ImportName
            viewBox={viewBox}
            background={cropped.url}
            drafts={drafts}
            current={Math.min(current, drafts.length - 1)}
            onCurrent={setCurrent}
            existingNames={rooms.map((one) => one.name)}
            onRename={(id, name) => setDrafts((list) => list.map((one) => (one.id === id ? { ...one, name } : one)))}
            onRemove={(id) => setDrafts((list) => list.filter((one) => one.id !== id))}
          />
        ) : null}
        {step === 3 && cropped ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
            {/* 预览就是导好之后「看」模式的样子：只有房间，不再用截图当底 */}
            <div className="relative h-[50vh] min-h-[300px] overflow-hidden rounded-card border border-border bg-muted lg:h-auto lg:flex-1">
              <MapCanvas label="导好之后的地图" viewBox={viewBox} items={items} mode="view" selectedId={null} onSelect={() => undefined} />
            </div>
            <Panel title={`${drafts.length} 个房间`} className="lg:w-[340px] lg:flex-none" grow={false}>
              <ul className="flex flex-wrap gap-2 p-3">
                {drafts.map((one) => (
                  <li key={one.id} className="rounded-full border border-border px-3 py-1 text-[13.5px]">
                    {one.name}
                    {!saving && rooms.some((room) => room.name === one.name.trim()) ? <span className="text-ink-soft"> · 用已有的</span> : null}
                  </li>
                ))}
              </ul>
              <p className="px-3 pb-3 text-[13px] text-ink-soft">
                截图存成编辑时的描图参考，房间画到图上；和位置清单里同名的房间直接用那个房间（里面的柜子和东西都不动）。
                {hadShapes ? ' 现在地图上画的房间和柜子形状会先清掉（位置和东西都不动），柜子要重新画。' : ''}
              </p>
            </Panel>
          </div>
        ) : null}
      </div>
    </Page>
  );
}
