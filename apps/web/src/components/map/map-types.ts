import type { MapShape } from '@family/contracts';

/**
 * 画在地图上的一块：房间（多边形）、房间里的区域 / 柜子（矩形）、装饰类家具（矩形，只画不进树）。导入向导里的草稿也用它。
 * 装饰的 parentId = 它所在的房间（roomId），name 是类型名（不起名，拍板 4）。
 */
export interface MapItem {
  id: string;
  parentId: string | null;
  kind: 'room' | 'zone' | 'container' | 'decor';
  name: string;
  shape: MapShape;
  /** 家具类型（收纳类柜子 / 装饰类）；自定义柜子是 null */
  icon?: string | null;
}

export interface ShapeChange {
  id: string;
  shape: MapShape;
}

/** 看：点房间 / 柜子；编辑（电脑）：顶点、拖动、缩放、画新的；编辑（手机）：只拖柜子 */
export type MapMode = 'view' | 'edit-full' | 'edit-containers';
/** split：拆分房间时从墙到墙拖一条线（v2 §2.3） */
export type MapTool = 'select' | 'room' | 'container' | 'split';
