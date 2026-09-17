import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { LoginPage } from './pages/login';
import { TodayPage } from './pages/today';
import { TasksPage } from './pages/tasks';
import { OrderPage } from './pages/order';
import { KitchenPage } from './pages/kitchen';
import { Button } from './components/ui';

const tabs = [
  { to: '/', label: '今天' },
  { to: '/tasks', label: '任务' },
  { to: '/order', label: '点菜' },
  { to: '/kitchen', label: '厨房' },
];

export function App() {
  const { session, ready, signOut } = useAuth();

  if (!ready) return null;
  if (!session) return <LoginPage />;

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-[680px] items-center gap-1 px-4">
          <span className="mr-2 text-sm font-semibold">小管家</span>
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to === '/'}
              className={({ isActive }) =>
                'rounded-lg px-3 py-1.5 text-sm transition-colors duration-150 ' +
                (isActive ? 'bg-accent-soft font-medium text-accent' : 'text-ink-soft hover:bg-muted')
              }
            >
              {tab.label}
            </NavLink>
          ))}
          <Button variant="ghost" onClick={signOut} className="ml-auto h-8 px-3 text-[13px]">
            退出
          </Button>
        </div>
      </header>
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/order" element={<OrderPage />} />
          <Route path="/kitchen" element={<KitchenPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
