/**
 * 全站信息架构：五个「场景」对应家里人真的会说出口的五件事
 * （今天怎么样 / 吃什么 / 什么时候做什么 / 家里的事 / 我自己的），
 * 24 个业务域收在场景下面当分段。三层封顶：场景 → 分段 → 抽屉，
 * 不再出现旧客户端那种 22 个页面靠 href:null 藏起来的情况。
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
      { key: 'shopping', label: '购物', path: '/eat/shopping', ready: true },
      { key: 'inventory', label: '库存', path: '/eat/inventory', ready: true },
      { key: 'media', label: '观影', legacy: '/media' },
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
    label: '家务',
    icon: '🧰',
    path: '/house',
    segments: [
      { key: 'assets', label: '资产', path: '/house/assets', ready: true },
      { key: 'finance', label: '财务', path: '/house/finance', ready: true, managerOnly: true },
      { key: 'points', label: '积分', path: '/house/points', ready: true },
      { key: 'knowledge', label: '知识库', path: '/house/knowledge', ready: true },
      { key: 'memories', label: '回忆', path: '/house/memories', ready: true },
      { key: 'travel', label: '出行', legacy: '/travel' },
      { key: 'guests', label: '访客', path: '/house/guests', ready: true },
      { key: 'members', label: '成员', path: '/house/members', ready: true, managerOnly: true },
      { key: 'backups', label: '备份', legacy: '/system-backups', managerOnly: true },
    ],
  },
  {
    key: 'me',
    label: '我的',
    icon: '👤',
    path: '/me',
    segments: [
      { key: 'profile', label: '个人', path: '/me/profile', ready: true },
      { key: 'assistant', label: '问问小管家', path: '/me/assistant', ready: true },
      { key: 'activity', label: '家庭动态', legacy: '/activity' },
    ],
  },
];

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
