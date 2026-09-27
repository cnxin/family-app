import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { openPalette } from '../components/command-palette';
import { Button, Page, Panel } from '../components/ui';

/** F1 只接通入口；启动台和家庭设置分别由 F2 / F7 实现，不在这里提前铺功能。 */
export function NavigationPlaceholder({ settings = false }: { settings?: boolean }) {
  const { session } = useAuth();
  const manager = session?.member.role === 'owner' || session?.member.role === 'admin';
  if (settings && !manager) return <Navigate to="/home" replace />;
  return (
    <Page title={settings ? '家庭设置' : '家里'} subtitle="入口正在整理，现有功能仍可通过搜索打开">
      <Panel className="flex flex-col items-start gap-3 p-5">
        <h2 className="text-base font-semibold">{settings ? '集中设置入口即将接入' : '所有功能，搜索就能找到'}</h2>
        <p className="max-w-lg text-sm leading-relaxed text-ink-soft">
          {settings ? '成员、备份等设置保留在原页面。' : '菜谱、资产、观影等功能保留在原页面，启动台将在下一步接入。'}
        </p>
        <Button variant="outline" onClick={openPalette}>搜索功能</Button>
      </Panel>
    </Page>
  );
}
