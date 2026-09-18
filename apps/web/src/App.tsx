import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
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
import { TravelPlanPage } from './pages/travel-plan';
import { AssetDetailPage } from './pages/asset-detail';
import { GuestInvitationPage } from './pages/guest-invitation';
import { ProfilePage } from './pages/profile';
import { AssistantPage } from './pages/assistant';
import { AgentMemoriesPage } from './pages/agent-memories';
import { Shell } from './components/shell';
import { LegacyBridge } from './components/legacy-bridge';
import { CommandPalette } from './components/command-palette';
import { SCENES, landingPath } from './lib/nav';

/** 旧路径（一层）保留跳转，免得家里人存的书签全废掉；查询串原样带过去（通知里的 ?pollId= 靠它）。 */
const REDIRECTS: [string, string][] = [
  ['/tasks', '/schedule/tasks'],
  ['/order', '/eat/order'],
  ['/kitchen', '/eat/kitchen'],
  ['/recipes', '/eat/recipes'],
  ['/supplies', '/eat/shopping'],
  ['/eat/supplies', '/eat/shopping'],
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

          <Route path="/eat" element={<Navigate to={landingPath(SCENES[1])} replace />} />
          <Route path="/eat/order" element={<OrderPage />} />
          <Route path="/eat/kitchen" element={<KitchenPage />} />
          <Route path="/eat/recipes" element={<RecipesPage />} />
          <Route path="/eat/shopping" element={<ShoppingPage />} />
          <Route path="/eat/inventory" element={<InventoryPage />} />

          <Route path="/schedule" element={<Navigate to={landingPath(SCENES[2])} replace />} />
          <Route path="/schedule/calendar" element={<CalendarPage />} />
          <Route path="/schedule/tasks" element={<TasksPage />} />
          <Route path="/schedule/reminders" element={<RemindersPage />} />
          <Route path="/schedule/notifications" element={<NotificationsPage />} />
          <Route path="/schedule/polls" element={<PollsPage />} />

          <Route path="/house" element={<Navigate to={landingPath(SCENES[3])} replace />} />
          <Route path="/house/points" element={<PointsPage />} />
          <Route path="/house/members" element={<MembersPage />} />
          <Route path="/house/guests" element={<GuestsPage />} />
          <Route path="/house/assets" element={<AssetsPage />} />
          <Route path="/house/finance" element={<FinancePage />} />
          <Route path="/house/knowledge" element={<KnowledgePage />} />
          <Route path="/house/memories" element={<MemoriesPage />} />
          <Route path="/house/travel" element={<TravelPage />} />
          <Route path="/house/travel/:id" element={<TravelPlanPage />} />
          <Route path="/house/assets/:id" element={<AssetDetailPage />} />
          <Route path="/me" element={<Navigate to={landingPath(SCENES[4])} replace />} />
          <Route path="/me/profile" element={<ProfilePage />} />
          <Route path="/me/assistant" element={<AssistantPage />} />
          <Route path="/me/assistant/memories" element={<AgentMemoriesPage />} />

          {/* 没搬过来的分段统一落到旧版入口页 */}
          <Route path="/eat/:segment" element={<LegacyBridge />} />
          <Route path="/schedule/:segment" element={<LegacyBridge />} />
          <Route path="/house/:segment" element={<LegacyBridge />} />
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
