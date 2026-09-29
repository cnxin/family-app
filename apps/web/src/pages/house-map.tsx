import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useHouseholdMap, useLocations } from '../lib/queries';
import { useMediaQuery } from '../lib/use-media-query';
import { MapPane } from '../components/map/map-pane';
import { MapTree } from '../components/map/map-tree';
import type { MapMode } from '../components/map/map-types';
import { QueryFrame } from '../components/query-state';
import { SoftLink } from '../components/soft-link';
import { Skeleton } from '../components/skeleton';
import { EmptyState, Page, Segmented, buttonClass } from '../components/ui';

/**
 * /house/map：家庭地图（item-location-plan §3 I2b）。位置管理页与地图合并为一页（拍板 §6 第 2 条）：
 * 桌面左树右图；手机上「地图 / 清单」二选一——家里人看地图找东西，树只在「清单」里。
 * 看模式全家可用；编辑入口只对管理员显示，手机上只能改名和拖柜子。
 * 深链：?focus=<位置 id> 对准并打开那个位置；?q=<物品名> 预填搜索并高亮（⌘K、库存 / 资产详情用）。
 */
export function HouseMapPage() {
  const { session } = useAuth();
  const manager = session?.member.role !== 'member';
  const desktop = useMediaQuery('(min-width: 1024px)');
  const map = useHouseholdMap();
  const locations = useLocations(false);
  const [params, setParams] = useSearchParams();
  const [initial] = useState(() => ({ focus: params.get('focus'), q: params.get('q') ?? '' }));
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<'map' | 'list' | null>(initial.focus || initial.q ? 'map' : null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; seq: number } | null>(
    initial.focus ? { id: initial.focus, seq: 1 } : null,
  );

  // 深链参数读一次就抹掉，刷新 / 返回不再重复对准
  useEffect(() => {
    if (!params.has('focus') && !params.has('q')) return;
    const next = new URLSearchParams(params);
    next.delete('focus');
    next.delete('q');
    setParams(next, { replace: true });
    // 只在进页面时抹一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasMap = Boolean(map.data);
  const activeTab = tab ?? (hasMap ? 'map' : 'list');
  const mode: MapMode = !manager || !editing || !hasMap ? 'view' : desktop ? 'edit-full' : 'edit-containers';
  const pickFromTree = (id: string | null) => {
    setSelectedId(id);
    if (id && desktop) setFocusRequest((current) => ({ id, seq: (current?.seq ?? 0) + 1 }));
  };

  const modeSwitch = (
    <Segmented
      label="地图模式"
      value={editing ? 'edit' : 'view'}
      onChange={(value) => {
        setEditing(value === 'edit');
        setSelectedId(null);
        setTab('map');
      }}
      options={[{ value: 'view', label: '看' }, { value: 'edit', label: '编辑' }]}
    />
  );

  const mapArea = (
    <QueryFrame query={map} skeleton={<Skeleton className="h-full min-h-[360px] w-full rounded-card" />}>
      {map.data ? (
        <MapPane
          key={map.data.id}
          map={map.data}
          locations={locations.data ?? []}
          mode={mode}
          desktop={desktop}
          selectedId={selectedId}
          onSelect={setSelectedId}
          initialQuery={initial.q}
          focusRequest={locations.data ? focusRequest : null}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center rounded-card border border-border bg-surface">
          <EmptyState
            emoji="🗺️"
            title="还没有家庭地图"
            hint={manager ? '把扫地机 App 里的地图截个图传上来，框出房间就行；先用左边的清单也可以' : '管理员还没画地图，先在「清单」里按房间找'}
          />
          {manager ? (
            <SoftLink to="/house/map/import" className={buttonClass('primary', 'mb-8')}>导入扫地机截图</SoftLink>
          ) : null}
        </div>
      )}
    </QueryFrame>
  );

  return (
    <Page
      title="地图"
      subtitle={desktop ? '东西上次放在哪：点房间看柜子，输名字在图上高亮' : undefined}
      actions={
        manager && desktop ? (
          <div className="flex flex-wrap items-center gap-2">
            {hasMap ? modeSwitch : null}
            {hasMap ? (
              <SoftLink to="/house/map/import" className={buttonClass('ghost', 'min-h-10 border border-border')}>重新导入</SoftLink>
            ) : null}
          </div>
        ) : null
      }
      toolbar={
        desktop ? null : (
          <div className="flex items-center justify-between gap-2">
            <Segmented
              label="地图或清单"
              value={activeTab}
              onChange={(value) => {
                setTab(value);
                setSelectedId(null);
              }}
              options={[{ value: 'map', label: '地图' }, { value: 'list', label: '清单' }]}
            />
            {manager && hasMap && activeTab === 'map' ? modeSwitch : null}
          </div>
        )
      }
    >
      {desktop ? (
        <div className="flex min-h-[560px] w-full flex-1 gap-4">
          <div className="flex w-[360px] flex-none flex-col">
            <MapTree manager={manager} selectedId={selectedId} onSelect={pickFromTree} withContents={!hasMap} narrow={hasMap} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">{mapArea}</div>
        </div>
      ) : activeTab === 'map' ? (
        <FillHeight className="flex min-h-[360px] w-full flex-col">{mapArea}</FillHeight>
      ) : (
        <MapTree manager={manager} selectedId={selectedId} onSelect={setSelectedId} withContents />
      )}
    </Page>
  );
}

/** 手机上地图占满到底部标签栏之上：按自己在屏幕上的位置量出剩余高度（转屏、键盘收起时重量）。 */
function FillHeight({ className, children }: { className: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const top = box.current?.getBoundingClientRect().top ?? 0;
      const tabs = document.querySelector('nav[aria-label="主导航"]')?.getBoundingClientRect().height ?? 56;
      setHeight(Math.round(window.innerHeight - top - tabs - 12 + window.scrollY));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return (
    <div ref={box} className={className} style={height ? { height } : undefined}>
      {children}
    </div>
  );
}
