import { Navigate, Route, Routes } from 'react-router-dom';
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
import { Shell } from './components/shell';
import { LegacyBridge } from './components/legacy-bridge';
import { CommandPalette } from './components/command-palette';
import { SCENES, landingPath } from './lib/nav';

/** 旧路径（一层）保留跳转，免得家里人存的书签全废掉。 */
const REDIRECTS: [string, string][] = [
  ['/tasks', '/schedule/tasks'],
  ['/order', '/eat/order'],
  ['/kitchen', '/eat/kitchen'],
  ['/recipes', '/eat/recipes'],
  ['/supplies', '/eat/shopping'],
  ['/eat/supplies', '/eat/shopping'],
];

export function App() {
  const { session, ready } = useAuth();

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

          <Route path="/house" element={<Navigate to={landingPath(SCENES[3])} replace />} />
          <Route path="/me" element={<Navigate to={landingPath(SCENES[4])} replace />} />

          {/* 没搬过来的分段统一落到旧版入口页 */}
          <Route path="/eat/:segment" element={<LegacyBridge />} />
          <Route path="/schedule/:segment" element={<LegacyBridge />} />
          <Route path="/house/:segment" element={<LegacyBridge />} />
          <Route path="/me/:segment" element={<LegacyBridge />} />

          {REDIRECTS.map(([from, to]) => (
            <Route key={from} path={from} element={<Navigate to={to} replace />} />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <CommandPalette />
    </>
  );
}
