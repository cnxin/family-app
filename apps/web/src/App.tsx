import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { LoginPage } from './pages/login';
import { TodayPage } from './pages/today';
import { TasksPage } from './pages/tasks';
import { OrderPage } from './pages/order';
import { KitchenPage } from './pages/kitchen';
import { RecipesPage } from './pages/recipes';
import { ShoppingPage } from './pages/shopping';
import { InventoryPage } from './pages/inventory';
import { CalendarPage } from './pages/calendar';
import { RemindersPage } from './pages/reminders';
import { NotificationsPage } from './pages/notifications';
import { PollsPage } from './pages/polls';
import { PointsPage } from './pages/points';
import { MembersPage } from './pages/members';
import { GuestsPage } from './pages/guests';
import { AssetsPage } from './pages/assets';
import { FinancePage } from './pages/finance';
import { KnowledgePage } from './pages/knowledge';
import { MemoriesPage } from './pages/memories';
import { TravelPage } from './pages/travel';
import { BackupsPage } from './pages/backups';
import { ActivityPage } from './pages/activity';
import { MediaPage } from './pages/media';
import { MediaLibraryPage } from './pages/media-library';
import { MediaHistoryPage } from './pages/media-history';
import { MediaWatchlistPage } from './pages/media-watchlist';
import { MediaSettingsPage } from './pages/media-settings';
import { TravelPlanPage } from './pages/travel-plan';
import { AssetDetailPage } from './pages/asset-detail';
import { GuestInvitationPage } from './pages/guest-invitation';
import { ProfilePage } from './pages/profile';
import { AssistantPage } from './pages/assistant';
import { AgentMemoriesPage } from './pages/agent-memories';
import { Shell } from './components/shell';
import { LegacyBridge } from './components/legacy-bridge';
import { CommandPalette } from './components/command-palette';
import HomePage from './pages/home';
import { NavigationPlaceholder } from './pages/navigation-placeholder';

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
      <Routes>
        <Route path="/guest/:token" element={<GuestInvitationPage />} />
      </Routes>
    );
  }

  if (!ready) return null;
  if (!session) return <LoginPage />;

  return (
    <>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<TodayPage />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/settings" element={<NavigationPlaceholder settings />} />

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

          {/* 没搬过来的分段统一落到旧版入口页 */}
          <Route path="/eat/:segment" element={<LegacyBridge />} />
          <Route path="/schedule/:segment" element={<LegacyBridge />} />
          <Route path="/house/:segment" element={<LegacyBridge />} />
          <Route path="/house/travel/:id" element={<RedirectTravelPlan />} />

          <Route path="/life/:segment" element={<LegacyBridge />} />
          <Route path="/me/:segment" element={<LegacyBridge />} />

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
