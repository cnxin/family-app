import type { MapShape } from '@family/contracts';

/** 画在地图上的一块：房间（多边形）、房间里的区域 / 柜子（矩形）。导入向导里的草稿也用它。 */
export interface MapItem {
  id: string;
  parentId: string | null;
  kind: 'room' | 'zone' | 'container';
  name: string;
  shape: MapShape;
}

export interface ShapeChange {
  id: string;
  shape: MapShape;
}

/** 看：点房间 / 柜子；编辑（电脑）：顶点、拖动、缩放、画新的；编辑（手机）：只拖柜子 */
export type MapMode = 'view' | 'edit-full' | 'edit-containers';
export type MapTool = 'select' | 'room' | 'container';
