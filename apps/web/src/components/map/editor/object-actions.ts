import type { MapDecoration, MapShape, StorageLocation } from '@family/contracts';
import { pushToast } from '../../../lib/toast';
import { furnitureSpec } from '../furniture-catalog';
import type { FurniturePanelMode } from './furniture-panel';
import type { MoreAction, ToolbarAction } from './floating-toolbar';
import { aligned, neighbourPoints, rectangularized, turned } from './shape-actions';

// 选中对象的浮动小工具条和「更多」（地图编辑器 v2 §1.3）：
// 房间：改名 · 删除 · 更多（矩形化 · 对齐相邻 · 拆分 · 合并到…，只在电脑上）
// 柜子 / 收纳家具：改名 · 转 90° · 删除 · 更多（吸附墙边 · 换成别的家具… · 挪到别的房间…）
// 装饰类：转 90° · 删除 · 更多（同上）；不起名（拍板 4），删了能撤销。

export type Selection = { type: 'location'; location: StorageLocation } | { type: 'decor'; decor: MapDecoration };

interface Context {
  desktop: boolean;
  locations: StorageLocation[];
  decorations: MapDecoration[];
  snap: boolean;
  setSnap: (on: boolean) => void;
  rename: () => void;
  askRemove: (location: StorageLocation) => void;
  commitShapes: (changes: { id: string; shape: MapShape | null }[], label: string) => void;
  commitDecor: (after: MapDecoration[], label: string) => void;
  openPanel: (mode: FurniturePanelMode) => void;
  relocate: (id: string) => void;
  deselect: () => void;
  split: (room: StorageLocation) => void;
  merge: (room: StorageLocation) => void;
}

const decorShape = (one: MapDecoration): MapShape => ({ type: 'rect', x: one.x, y: one.y, w: one.w, h: one.h, ...(one.rotation ? { rotation: one.rotation } : {}) });

export function objectActions(selection: Selection, ctx: Context): { actions: ToolbarAction[]; more: MoreAction[] } {
  const byId = new Map(ctx.locations.map((one) => [one.id, one]));
  const id = selection.type === 'decor' ? selection.decor.id : selection.location.id;
  const shape = selection.type === 'decor' ? decorShape(selection.decor) : selection.location.mapShape;
  const parentId = selection.type === 'decor' ? selection.decor.roomId : selection.location.parentId;

  if (selection.type === 'location' && selection.location.kind === 'room') {
    const room = selection.location;
    const onlyDesktop = ctx.desktop ? undefined : '在电脑上做';
    return {
      actions: [
        { key: 'rename', label: '改名', onClick: ctx.rename },
        { key: 'remove', label: '删除', danger: true, onClick: () => ctx.askRemove(room) },
      ],
      more: room.mapShape
        ? [
            { key: 'rect', label: '矩形化', hint: onlyDesktop ?? '外接矩形', disabled: !ctx.desktop, onClick: () => ctx.commitShapes([{ id: room.id, shape: rectangularized(room.mapShape!) }], '矩形化') },
            {
              key: 'align',
              label: '对齐相邻',
              hint: onlyDesktop ?? '拉齐公共墙',
              disabled: !ctx.desktop,
              onClick: () => {
                const result = aligned(room.mapShape!, neighbourPoints(ctx.locations, room.id));
                if (!result) pushToast('旁边没有贴得够近的墙');
                else {
                  ctx.commitShapes([{ id: room.id, shape: result.shape }], '对齐相邻');
                  pushToast(`拉齐了 ${result.moved} 面墙`, undefined, 'success');
                }
              },
            },
            { key: 'split', label: '拆分', hint: onlyDesktop ?? '从墙到墙画一条线', disabled: !ctx.desktop, onClick: () => ctx.split(room) },
            { key: 'merge', label: '合并到…', hint: onlyDesktop ?? '再点挨着的房间', disabled: !ctx.desktop, onClick: () => ctx.merge(room) },
          ]
        : [],
    };
  }

  const rotate = () => {
    const next = shape ? turned(shape, parentId ? byId.get(parentId)?.mapShape : null) : null;
    if (next) ctx.commitShapes([{ id, shape: next }], '转 90°');
    else pushToast('转过来会出房间，先往中间挪一挪');
  };
  const actions: ToolbarAction[] = [];
  if (selection.type === 'location') actions.push({ key: 'rename', label: '改名', onClick: ctx.rename });
  if (shape?.type === 'rect') actions.push({ key: 'rotate', label: '↻ 90°', onClick: rotate });
  actions.push({
    key: 'remove',
    label: '删除',
    danger: true,
    onClick: () => {
      if (selection.type === 'location') return ctx.askRemove(selection.location);
      ctx.commitDecor(ctx.decorations.filter((one) => one.id !== id), '删家具');
      ctx.deselect();
      navigator.vibrate?.(10);
    },
  });

  const kind = selection.type === 'decor' ? selection.decor.kind : selection.location.icon;
  const more: MoreAction[] = [
    { key: 'snap', label: ctx.snap ? '吸附墙边：开' : '吸附墙边：关', hint: ctx.snap ? '点一下关掉' : '点一下打开', onClick: () => ctx.setSnap(!ctx.snap) },
    {
      key: 'replace',
      label: '换成别的家具…',
      onClick: () =>
        ctx.openPanel({
          type: 'replace',
          group: selection.type === 'decor' ? 'decor' : 'storage',
          current: kind ?? null,
          name: selection.type === 'decor' ? furnitureSpec(kind)?.label ?? '家具' : selection.location.name,
        }),
    },
    { key: 'relocate', label: '挪到别的房间…', hint: '再点目标房间', onClick: () => ctx.relocate(id) },
  ];
  return { actions, more };
}
