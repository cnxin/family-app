import { shelfModuleKey, type AuthSession, type ShelfModuleKey } from '@family/contracts';

/** 场景保留规范路径；导航层级和手机菜单独立组织，不再由 URL 决定功能权重。 */
export type NavTier = 'core' | 'shelf' | 'settings';
type NavMember = Pick<AuthSession['member'], 'role'> | null | undefined;

export interface NavSegment {
  key: string;
  label: string;
  tier: NavTier;
  glyph: string;
  /** 新客户端里的路径；没搬过来时为空 */
  path?: string;
  /** 旧客户端（8088）里的路径，用于「在旧版打开」 */
  legacy?: string;
  ready?: boolean;
  /** 只有家庭管理员能看到 */
  managerOnly?: boolean;
}

export interface NavScene {
  key: string;
  label: string;
  icon: string;
  path: string;
  /** 场景本身就是一页时没有分段（比如「今天」） */
  segments: NavSegment[];
}

export const SCENES: NavScene[] = [
  {
    key: 'today',
    label: '今天',
    icon: '🏠',
    path: '/',
    segments: [],
  },
  {
    key: 'eat',
    label: '吃饭',
    icon: '🍚',
    path: '/eat',
    segments: [
      { key: 'order', tier: 'core', glyph: '点', label: '点菜', path: '/eat/order', ready: true },
      { key: 'kitchen', tier: 'core', glyph: '厨', label: '厨房', path: '/eat/kitchen', ready: true },
      { key: shelfModuleKey.enum.recipes, tier: 'shelf', glyph: '菜', label: '菜谱', path: '/eat/recipes', ready: true },
    ],
  },
  {
    key: 'schedule',
    label: '日程',
    icon: '📅',
    path: '/schedule',
    segments: [
      { key: 'calendar', tier: 'core', glyph: '历', label: '日历', path: '/schedule/calendar', ready: true },
      { key: 'tasks', tier: 'core', glyph: '待', label: '任务', path: '/schedule/tasks', ready: true },
      { key: shelfModuleKey.enum.reminders, tier: 'shelf', glyph: '醒', label: '提醒', path: '/schedule/reminders', ready: true },
      { key: shelfModuleKey.enum.polls, tier: 'shelf', glyph: '票', label: '投票', path: '/schedule/polls', ready: true },
      { key: 'notifications', tier: 'core', glyph: '信', label: '消息', path: '/schedule/notifications', ready: true },
    ],
  },
  {
    key: 'house',
    label: '家里',
    icon: '🧰',
    path: '/house',
    // 保留已有路径分组；购物在 core 与手机「吃饭」里呈现，不搬 URL。
    segments: [
      { key: shelfModuleKey.enum.inventory, tier: 'shelf', glyph: '库', label: '库存', path: '/house/inventory', ready: true },
      { key: 'shopping', tier: 'core', glyph: '购', label: '购物', path: '/house/shopping', ready: true },
      { key: shelfModuleKey.enum.assets, tier: 'shelf', glyph: '资', label: '资产', path: '/house/assets', ready: true },
      { key: shelfModuleKey.enum.finance, tier: 'shelf', glyph: '账', label: '财务', path: '/house/finance', ready: true, managerOnly: true },
      { key: shelfModuleKey.enum.points, tier: 'shelf', glyph: '分', label: '积分', path: '/house/points', ready: true },
      { key: shelfModuleKey.enum.guests, tier: 'shelf', glyph: '客', label: '访客', path: '/house/guests', ready: true },
      { key: 'members', tier: 'settings', glyph: '员', label: '成员', path: '/house/members', ready: true, managerOnly: true },
      { key: 'backups', tier: 'settings', glyph: '备', label: '备份', path: '/house/backups', ready: true, managerOnly: true },
    ],
  },
  {
    key: 'life',
    label: '生活',
    icon: '✨',
    path: '/life',
    segments: [
      { key: shelfModuleKey.enum.media, tier: 'shelf', glyph: '影', label: '观影', path: '/life/media', ready: true },
      { key: shelfModuleKey.enum.travel, tier: 'shelf', glyph: '行', label: '出行', path: '/life/travel', ready: true },
      { key: shelfModuleKey.enum.memories, tier: 'shelf', glyph: '忆', label: '回忆', path: '/life/memories', ready: true },
      { key: shelfModuleKey.enum.knowledge, tier: 'shelf', glyph: '知', label: '知识库', path: '/life/knowledge', ready: true },
      { key: shelfModuleKey.enum.activity, tier: 'shelf', glyph: '动', label: '家庭动态', path: '/life/activity', ready: true },
    ],
  },
];

/** 历史独立入口：只保留注册信息，不再永久置顶；用户置顶由 F4 接线。 */
export interface NavPinned extends NavSegment {
  icon: string;
  path: string;
}

export const PINNED: NavPinned[] = [
  { key: shelfModuleKey.enum.assistant, label: '问问小管家', tier: 'shelf', glyph: '问', icon: '💬', path: '/me/assistant', ready: true },
  { key: 'profile', label: '个人设置', tier: 'settings', glyph: '我', icon: '⚙️', path: '/me/profile', ready: true },
];

export const TODAY: NavSegment = {
  key: 'today', label: '今天', tier: 'core', glyph: '今', path: '/', ready: true,
};
const CORE_KEYS = ['today', 'order', 'kitchen', 'shopping', 'calendar', 'tasks', 'notifications'];

export function allSegments() {
  return [TODAY, ...SCENES.flatMap((scene) => scene.segments), ...PINNED];
}

function allowed(segment: NavSegment, member: NavMember) {
  return !segment.managerOnly || member?.role === 'owner' || member?.role === 'admin';
}

export function coreSegments() {
  const segments = allSegments();
  return CORE_KEYS.map((key) => segments.find((segment) => segment.key === key)!);
}

export function shelfSegments(member: NavMember) {
  return allSegments().filter((segment): segment is NavSegment & { key: ShelfModuleKey } =>
    segment.tier === 'shelf' && allowed(segment, member));
}

export function settingsSegments(member: NavMember) {
  return allSegments().filter((segment) => segment.tier === 'settings' && allowed(segment, member));
}

export function matchesPath(pathname: string, path: string) {
  return pathname === path || (path !== '/' && pathname.startsWith(path + '/'));
}

/** 购物路径留在 /house 下，但交互上属于「吃饭」；只展示三项 core。 */
export function mobileTabs(): NavScene[] {
  const core = coreSegments();
  const pick = (keys: string[]) => keys.map((key) => core.find((segment) => segment.key === key)!);
  return [
    sceneByKey('today'),
    { ...sceneByKey('eat'), segments: pick(['order', 'kitchen', 'shopping']) },
    { ...sceneByKey('schedule'), segments: pick(['calendar', 'tasks', 'notifications']) },
    { key: 'home', label: '家里', icon: '🧰', path: '/home', segments: [] },
  ];
}

export function mobileTabOf(pathname: string) {
  if (pathname === '/') return 'today';
  const tab = mobileTabs().find((one) =>
    one.segments.some((segment) => segment.path && matchesPath(pathname, segment.path)),
  );
  if (tab) return tab.key;
  // 个人页不是「家里」的下级，不借点亮另一个 tab 冒充当前位置。
  if (matchesPath(pathname, '/me/profile')) return undefined;
  return 'home';
}

export function sceneByKey(key: string) {
  const scene = SCENES.find((one) => one.key === key);
  if (!scene) throw new Error(`没有这个场景：${key}`);
  return scene;
}

/** 场景落地时该去哪个分段：优先第一个搬过来的，全没搬就去第一个。 */
export function landingPath(scene: NavScene) {
  if (!scene.segments.length) return scene.path;
  const ready = scene.segments.find((segment) => segment.ready && segment.path);
  return ready?.path ?? `${scene.path}/${scene.segments[0].key}`;
}

export function sceneOf(pathname: string) {
  if (pathname === '/') return SCENES[0];
  return (
    SCENES.find(
      (scene) => scene.path !== '/' && pathname.startsWith(scene.path),
    ) ?? SCENES[0]
  );
}

/**
 * 当前路径是不是真的落在某个场景里。`/me/*`（个人设置、问问小管家）不属于任何
 * 底部标签，这时候不该把「今天」点亮——那会让人以为自己还在首页。
 */
export function inScene(pathname: string) {
  if (pathname === '/') return true;
  return SCENES.some((scene) => scene.path !== '/' && pathname.startsWith(scene.path));
}

export function segmentOf(scene: NavScene, pathname: string) {
  return scene.segments.find(
    (segment) => segment.key === pathname.split('/')[2],
  );
}

/**
 * 旧客户端还跑在 8088 上。开发时新客户端在 5180，所以按同主机 + 8088 拼；
 * 以后两边都进 Caddy 时把 VITE_LEGACY_ORIGIN 设成空串就退化成同源。
 */
export function legacyUrl(path: string) {
  const configured = import.meta.env.VITE_LEGACY_ORIGIN as string | undefined;
  const origin =
    configured ?? `${window.location.protocol}//${window.location.hostname}:8088`;
  return `${origin}${path}`;
}

export function visibleSegments(scene: NavScene, manager: boolean) {
  return scene.segments.filter((segment) => manager || !segment.managerOnly);
}
