import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { LoginPage } from './pages/login';
import { TodayPage } from './pages/today';
import { Shell } from './components/shell';
import { CommandPalette } from './components/command-palette';
import { lazy, Suspense } from 'react';
import { lazyPage } from './lib/lazy-page';
import { PageFallback } from './components/page-fallback';

// 除登录页和「今天」外，页面都按路由懒加载（见 lib/lazy-page.tsx）；首屏只带壳子和首页。
const HomePage = lazy(() => import('./pages/home'));
const SetPasswordPage = lazyPage(() => import('./pages/set-password'), 'SetPasswordPage');
const JoinPage = lazyPage(() => import('./pages/join'), 'JoinPage');
const SetupPage = lazyPage(() => import('./pages/setup'), 'SetupPage');
const TasksPage = lazyPage(() => import('./pages/tasks'), 'TasksPage');
const OrderPage = lazyPage(() => import('./pages/order'), 'OrderPage');
const KitchenPage = lazyPage(() => import('./pages/kitchen'), 'KitchenPage');
const RecipesPage = lazyPage(() => import('./pages/recipes'), 'RecipesPage');
const ShoppingPage = lazyPage(() => import('./pages/shopping'), 'ShoppingPage');
const InventoryPage = lazyPage(() => import('./pages/inventory'), 'InventoryPage');
const CalendarPage = lazyPage(() => import('./pages/calendar'), 'CalendarPage');
const RemindersPage = lazyPage(() => import('./pages/reminders'), 'RemindersPage');
const NotificationsPage = lazyPage(() => import('./pages/notifications'), 'NotificationsPage');
const PollsPage = lazyPage(() => import('./pages/polls'), 'PollsPage');
const PointsPage = lazyPage(() => import('./pages/points'), 'PointsPage');
const MembersPage = lazyPage(() => import('./pages/members'), 'MembersPage');
const GuestsPage = lazyPage(() => import('./pages/guests'), 'GuestsPage');
const AssetsPage = lazyPage(() => import('./pages/assets'), 'AssetsPage');
const FinancePage = lazyPage(() => import('./pages/finance'), 'FinancePage');
const KnowledgePage = lazyPage(() => import('./pages/knowledge'), 'KnowledgePage');
const MemoriesPage = lazyPage(() => import('./pages/memories'), 'MemoriesPage');
const TravelPage = lazyPage(() => import('./pages/travel'), 'TravelPage');
const BackupsPage = lazyPage(() => import('./pages/backups'), 'BackupsPage');
const SmartHomePage = lazyPage(() => import('./pages/smart-home'), 'SmartHomePage');
const SmartHomeSettingsPage = lazyPage(() => import('./pages/smart-home-settings'), 'SmartHomeSettingsPage');
const HouseMapPage = lazyPage(() => import('./pages/house-map'), 'HouseMapPage');
const HouseMapImportPage = lazyPage(() => import('./pages/house-map-import'), 'HouseMapImportPage');
const ActivityPage = lazyPage(() => import('./pages/activity'), 'ActivityPage');
const MediaPage = lazyPage(() => import('./pages/media'), 'MediaPage');
const MediaLibraryPage = lazyPage(() => import('./pages/media-library'), 'MediaLibraryPage');
const MediaHistoryPage = lazyPage(() => import('./pages/media-history'), 'MediaHistoryPage');
const MediaWatchlistPage = lazyPage(() => import('./pages/media-watchlist'), 'MediaWatchlistPage');
const MediaSettingsPage = lazyPage(() => import('./pages/media-settings'), 'MediaSettingsPage');
const TravelPlanPage = lazyPage(() => import('./pages/travel-plan'), 'TravelPlanPage');
const AssetDetailPage = lazyPage(() => import('./pages/asset-detail'), 'AssetDetailPage');
const GuestInvitationPage = lazyPage(() => import('./pages/guest-invitation'), 'GuestInvitationPage');
const ProfilePage = lazyPage(() => import('./pages/profile'), 'ProfilePage');
const AssistantPage = lazyPage(() => import('./pages/assistant'), 'AssistantPage');
const AgentMemoriesPage = lazyPage(() => import('./pages/agent-memories'), 'AgentMemoriesPage');
const SettingsPage = lazyPage(() => import('./pages/settings'), 'SettingsPage');

/** 旧路径（一层）保留跳转，免得家里人存的书签全废掉；查询串原样带过去（通知里的 ?pollId= 靠它）。 */
const REDIRECTS: [string, string][] = [
  ['/tasks', '/schedule/tasks'],
  ['/order', '/eat/order'],
  ['/kitchen', '/eat/kitchen'],
  ['/recipes', '/eat/recipes'],
  ['/supplies', '/house/shopping'],
  ['/eat/supplies', '/house/shopping'],
  // 2026-09-20 重分类之前的位置，留着不然家里人存的链接全废
  ['/eat/shopping', '/house/shopping'],
  ['/eat/inventory', '/house/inventory'],
  ['/eat/media', '/life/media'],
  ['/eat/media/library', '/life/media/library'],
  ['/eat/media/history', '/life/media/history'],
  ['/eat/media/watchlist', '/life/media/watchlist'],
  ['/eat/media/settings', '/life/media/settings'],
  ['/house/knowledge', '/life/knowledge'],
  ['/house/memories', '/life/memories'],
  ['/house/travel', '/life/travel'],
  ['/me/activity', '/life/activity'],
  ['/polls', '/schedule/polls'],
  ['/points', '/house/points'],
  ['/members', '/house/members'],
  ['/guests', '/house/guests'],
  ['/home-assets', '/house/assets'],
  // I1 时位置管理页的路径；I2 与地图合并成 /house/map
  ['/house/locations', '/house/map'],
  ['/profile', '/me/profile'],
  ['/assistant', '/me/assistant'],
  ['/calendar', '/schedule/calendar'],
  ['/reminders', '/schedule/reminders'],
  ['/notifications', '/schedule/notifications'],
];

/** 带一个参数的老路径搬家：/house/travel/:id → /life/travel/:id */
function RedirectTravelPlan() {
  const { id } = useParams();
  const { search } = useLocation();
  return <Navigate to={`/life/travel/${id ?? ''}${search}`} replace />;
}

function RedirectKeepingSearch({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}

export function App() {
  const { session, ready } = useAuth();
  const { pathname } = useLocation();

  // 公开邀请页在登录闸门之前：访客没有家庭账号，既不该被弹到登录页，也不用等鉴权就绪。
  if (pathname.startsWith('/guest/')) {
    return (
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/guest/:token" element={<GuestInvitationPage />} />
        </Routes>
      </Suspense>
    );
  }

  // 邀请兑换、首次初始化同样在闸门之前：来的人还没有账号。
  if (pathname === '/join' || pathname === '/setup') {
    return (
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/join" element={<JoinPage />} />
          <Route path="/setup" element={<SetupPage />} />
        </Routes>
      </Suspense>
    );
  }

  if (!ready) return null;
  if (!session) return <LoginPage />;
  // 迁移来的老账号第一次登录（空密码）：先设密码，别的页都不让进（服务端同样只放行设密码和退出登录）
  if (session.account.requiresPasswordSetup) {
    return (
      <Suspense fallback={<PageFallback />}>
        <SetPasswordPage />
      </Suspense>
    );
  }

  return (
    <>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<TodayPage />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/settings" element={<SettingsPage />} />

          <Route path="/eat" element={<RedirectKeepingSearch to="/eat/order" />} />
          <Route path="/eat/order" element={<OrderPage />} />
          <Route path="/eat/kitchen" element={<KitchenPage />} />
          <Route path="/eat/recipes" element={<RecipesPage />} />
          
          <Route path="/schedule" element={<RedirectKeepingSearch to="/schedule/calendar" />} />
          <Route path="/schedule/calendar" element={<CalendarPage />} />
          <Route path="/schedule/tasks" element={<TasksPage />} />
          <Route path="/schedule/reminders" element={<RemindersPage />} />
          <Route path="/schedule/notifications" element={<NotificationsPage />} />
          <Route path="/schedule/polls" element={<PollsPage />} />

          <Route path="/house" element={<RedirectKeepingSearch to="/home" />} />
          <Route path="/house/inventory" element={<InventoryPage />} />
          <Route path="/house/shopping" element={<ShoppingPage />} />
          <Route path="/house/points" element={<PointsPage />} />
          <Route path="/house/members" element={<MembersPage />} />
          <Route path="/house/guests" element={<GuestsPage />} />
          <Route path="/house/assets" element={<AssetsPage />} />
          <Route path="/house/finance" element={<FinancePage />} />
          <Route path="/house/backups" element={<BackupsPage />} />
          <Route path="/house/smart-home" element={<SmartHomePage />} />
          <Route path="/house/smart-home/settings" element={<SmartHomeSettingsPage />} />
          <Route path="/house/map" element={<HouseMapPage />} />
          <Route path="/house/map/import" element={<HouseMapImportPage />} />
          <Route path="/house/assets/:id" element={<AssetDetailPage />} />
          <Route path="/life" element={<RedirectKeepingSearch to="/life/media" />} />
          <Route path="/life/media" element={<MediaPage />} />
          <Route path="/life/media/library" element={<MediaLibraryPage />} />
          <Route path="/life/media/history" element={<MediaHistoryPage />} />
          <Route path="/life/media/watchlist" element={<MediaWatchlistPage />} />
          <Route path="/life/media/settings" element={<MediaSettingsPage />} />
          <Route path="/life/travel" element={<TravelPage />} />
          <Route path="/life/travel/:id" element={<TravelPlanPage />} />
          <Route path="/life/memories" element={<MemoriesPage />} />
          <Route path="/life/knowledge" element={<KnowledgePage />} />
          <Route path="/life/activity" element={<ActivityPage />} />

          <Route path="/me" element={<RedirectKeepingSearch to="/home" />} />
          <Route path="/me/profile" element={<ProfilePage />} />
          <Route path="/me/assistant" element={<AssistantPage />} />
          <Route path="/me/assistant/memories" element={<AgentMemoriesPage />} />

          <Route path="/house/travel/:id" element={<RedirectTravelPlan />} />

          {REDIRECTS.map(([from, to]) => (
            <Route key={from} path={from} element={<RedirectKeepingSearch to={to} />} />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <CommandPalette />
    </>
  );
}
