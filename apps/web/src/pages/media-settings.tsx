import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { MediaConnectorSettingsPanel } from '../components/media-connector-settings';
import { MediaPlaybackUsersPanel } from '../components/media-playback-users';
import { MediaSourceSettingsPanel } from '../components/media-source-settings';
import { EmptyState, Page, Panel, Segmented } from '../components/ui';

type Section = 'services' | 'sources' | 'users';

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'services', label: '媒体服务' },
  { value: 'sources', label: '搜索数据源' },
  { value: 'users', label: '用户映射' },
];

const SUBTITLE: Record<Section, string> = {
  services: '连上 Plex / Emby / MoviePilot，凭据只写不读',
  sources: '搜片的时候去哪儿查元数据',
  users: '把媒体服务器上的账号对到家里人身上',
};

export function MediaSettingsPage() {
  const { session } = useAuth();
  const canManage = session?.member.role !== 'member';
  // 三块之间切换记在地址里：旧版就是 ?section=，通知和书签都指得过来。
  const [params, setParams] = useSearchParams();
  const raw = params.get('section');
  const section: Section = raw === 'sources' || raw === 'users' ? raw : 'services';

  if (!canManage) {
    return (
      <Page title="观影设置" subtitle="媒体服务 · 搜索数据源 · 用户映射">
        <Panel className="p-3">
          <EmptyState
            emoji="🔐"
            title="这一页只有家庭管理员能改"
            hint="里面是全家共用的服务地址和凭据"
          />
        </Panel>
      </Page>
    );
  }

  return (
    <Page
      title="观影设置"
      subtitle={SUBTITLE[section]}
      toolbar={
        <Segmented<Section>
          value={section}
          options={SECTIONS}
          onChange={(value) => {
            setParams(value === 'services' ? {} : { section: value }, { replace: true });
          }}
        />
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {section === 'services' ? <MediaConnectorSettingsPanel /> : null}
        {section === 'sources' ? <MediaSourceSettingsPanel /> : null}
        {section === 'users' ? <MediaPlaybackUsersPanel /> : null}
      </div>
    </Page>
  );
}
