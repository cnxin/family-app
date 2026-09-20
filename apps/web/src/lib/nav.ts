/**
 * 全站信息架构：五个「场景」对应家里人真的会说出口的五件事
 * （今天怎么样 / 吃什么 / 什么时候做什么 / 家里的东西和钱 / 家庭生活），
 * 业务域收在场景下面当分段。三层封顶：场景 → 分段 → 抽屉，
 * 不再出现旧客户端那种 22 个页面靠 href:null 藏起来的情况。
 *
 * 2026-09-20 重分类：原来「吃饭」底下塞了购物、库存、观影，前两个是家里的物资、
 * 后一个是娱乐，都不是「今天吃什么」。现在按家里人嘴里说的话重新分：
 *   吃饭 = 点菜 / 厨房 / 菜谱          （吃什么、怎么做）
 *   家里 = 库存 / 购物 / 资产 / 财务 … （家里有什么、花了多少）
 *   生活 = 观影 / 出行 / 回忆 / 知识库 （一家人一起干的事）
 * 「我的」不再占一个底部标签——个人设置和问问小管家是工具不是分类，
 * 见下面的 PINNED，手机放顶栏、桌面钉在侧栏上方。
 *
 * ready=false 的分段是还没搬到新客户端的，暂时给一个「在旧版打开」的出口，
 * 搬完一个就把 path 填上、ready 改 true，别的地方不用动。
 */

export interface NavSegment {
  key: string;
  label: string;
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
      { key: 'order', label: '点菜', path: '/eat/order', ready: true },
      { key: 'kitchen', label: '厨房', path: '/eat/kitchen', ready: true },
      { key: 'recipes', label: '菜谱', path: '/eat/recipes', ready: true },
    ],
  },
  {
    key: 'schedule',
    label: '日程',
    icon: '📅',
    path: '/schedule',
    segments: [
      { key: 'calendar', label: '日历', path: '/schedule/calendar', ready: true },
      { key: 'tasks', label: '任务', path: '/schedule/tasks', ready: true },
      { key: 'reminders', label: '提醒', path: '/schedule/reminders', ready: true },
      { key: 'polls', label: '投票', path: '/schedule/polls', ready: true },
      { key: 'notifications', label: '消息', path: '/schedule/notifications', ready: true },
    ],
  },
  {
    key: 'house',
    label: '家里',
    icon: '🧰',
    path: '/house',
    // 天天要看的（库存、购物）排前面，管理性质的（成员、备份）沉到后面
    segments: [
      { key: 'inventory', label: '库存', path: '/house/inventory', ready: true },
      { key: 'shopping', label: '购物', path: '/house/shopping', ready: true },
      { key: 'assets', label: '资产', path: '/house/assets', ready: true },
      { key: 'finance', label: '财务', path: '/house/finance', ready: true, managerOnly: true },
      { key: 'points', label: '积分', path: '/house/points', ready: true },
      { key: 'guests', label: '访客', path: '/house/guests', ready: true },
      { key: 'members', label: '成员', path: '/house/members', ready: true, managerOnly: true },
      { key: 'backups', label: '备份', path: '/house/backups', ready: true, managerOnly: true },
    ],
  },
  {
    key: 'life',
    label: '生活',
    icon: '✨',
    path: '/life',
    segments: [
      { key: 'media', label: '观影', path: '/life/media', ready: true },
      { key: 'travel', label: '出行', path: '/life/travel', ready: true },
      { key: 'memories', label: '回忆', path: '/life/memories', ready: true },
      { key: 'knowledge', label: '知识库', path: '/life/knowledge', ready: true },
      { key: 'activity', label: '家庭动态', path: '/life/activity', ready: true },
    ],
  },
];

/**
 * 不占底部标签、但要随手够得着的两个入口。
 * 「问问小管家」是工具不是分类，塞进任何一个场景都别扭，而且塞进去就等于降一级；
 * 「个人设置」是设置，按惯例挂在头像后面。手机放顶栏，桌面钉在侧栏搜索框下面。
 */
export interface NavPinned {
  key: string;
  label: string;
  icon: string;
  path: string;
}

export const PINNED: NavPinned[] = [
  { key: 'assistant', label: '问问小管家', icon: '💬', path: '/me/assistant' },
  { key: 'profile', label: '个人设置', icon: '⚙️', path: '/me/profile' },
];

/** 手机底部标签的顺序：左二 · 中间那个大的 · 右二。中间放最常开的「今天」。 */
export const MOBILE_TAB_KEYS = ['eat', 'schedule', 'today', 'house', 'life'] as const;
export const CENTER_TAB_KEY = 'today';

export function sceneByKey(key: string) {
  const scene = SCENES.find((one) => one.key === key);
  if (!scene) throw new Error(`没有这个场景：${key}`);
  return scene;
}

export function mobileTabs() {
  return MOBILE_TAB_KEYS.map((key) => sceneByKey(key));
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
