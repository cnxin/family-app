import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { LoginPage } from './pages/login';
import { TodayPage } from './pages/today';
import { TasksPage } from './pages/tasks';
import { OrderPage } from './pages/order';
import { KitchenPage } from './pages/kitchen';
import { RecipesPage } from './pages/recipes';
import { SuppliesPage } from './pages/supplies';
import { Button } from './components/ui';
import { applyTheme, readTheme } from './lib/theme';

const tabs = [
  { to: '/', label: '今天', icon: '🏠' },
  { to: '/tasks', label: '任务', icon: '✅' },
  { to: '/order', label: '点菜', icon: '🍽' },
  { to: '/kitchen', label: '厨房', icon: '🍳' },
  { to: '/supplies', label: '采购', icon: '🧺' },
  { to: '/recipes', label: '菜谱', icon: '📖' },
];

const linkClass = (isActive: boolean) =>
  'shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors duration-150 ' +
  (isActive ? 'bg-accent-soft font-medium text-accent' : 'text-ink-soft hover:bg-muted');

export function App() {
  const { session, ready, signOut } = useAuth();
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => applyTheme(theme), [theme]);

  if (!ready) return null;
  if (!session) return <LoginPage />;

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-[760px] items-center gap-1 px-4">
          <span className="shrink-0 text-sm font-semibold">小管家</span>
          {/* 窄屏交给下面的底部标签栏，顶栏只留标题和两个开关 */}
          <nav className="mx-2 hidden min-w-0 flex-1 items-center gap-1 sm:flex">
            {tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.to === '/'}
                className={({ isActive }) => linkClass(isActive)}
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
          <Button
            variant="ghost"
            aria-label={theme === 'dark' ? '切换到浅色' : '切换到深色'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="ml-auto h-8 shrink-0 px-2 text-[15px]"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </Button>
          <Button variant="ghost" onClick={signOut} className="h-8 shrink-0 px-3 text-[13px]">
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
          <Route path="/supplies" element={<SuppliesPage />} />
          <Route path="/recipes" element={<RecipesPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* 手机上六个标签横着放不下，改成底部标签栏：拇指够得到，也不用横向滚 */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden"
        aria-label="主导航"
      >
        <div className="flex items-stretch">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to === '/'}
              className={({ isActive }) =>
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition-colors duration-150 ' +
                (isActive ? 'font-medium text-accent' : 'text-ink-soft')
              }
            >
              <span className="text-[17px] leading-none">{tab.icon}</span>
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
