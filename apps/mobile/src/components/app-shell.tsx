import {
  ArrowLeft,
  Bell,
  BellRing,
  BookOpenText,
  CalendarDays,
  ChevronDown,
  CookingPot,
  DatabaseBackup,
  Film,
  Gift,
  House,
  History,
  Images,
  LayoutDashboard,
  ListTodo,
  Plane,
  ShoppingCart,
  Sparkles,
  UserRound,
  UsersRound,
  Vote,
  WalletCards,
  Wrench,
  type LucideIcon,
} from 'lucide-react-native';
import { usePathname, useRouter, type Href } from 'expo-router';
import React from 'react';
import {
  Platform,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import { useSession } from '../lib/session';
import { isHouseholdManager, memberSubtitle } from '../lib/member';
import { useNotifications } from '../lib/queries';
import { radius, type as t, useTheme } from '../lib/theme';
import { IconButton, PressSurface } from './ui';

export const DESKTOP_BREAKPOINT = 1024;
export const COMPACT_BREAKPOINT = 700;

export type LayoutMode = 'compact' | 'medium' | 'wide';

export function useLayoutMode(): LayoutMode {
  const { width } = useWindowDimensions();
  if (width < COMPACT_BREAKPOINT) return 'compact';
  if (width < DESKTOP_BREAKPOINT) return 'medium';
  return 'wide';
}

export function useDesktopLayout() {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= DESKTOP_BREAKPOINT;
}

export function PageContainer({
  children,
  maxWidth = 1320,
  style,
}: {
  children: React.ReactNode;
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const layout = useLayoutMode();
  const gutter = layout === 'compact' ? 16 : layout === 'medium' ? 24 : 32;
  return (
    <View
      style={[
        styles.pageContainer,
        { maxWidth, paddingHorizontal: gutter },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function PageHeader({
  action,
  eyebrow,
  subtitle,
  title,
}: {
  action?: React.ReactNode;
  eyebrow?: string;
  subtitle?: string;
  title: string;
}) {
  const c = useTheme();
  const layout = useLayoutMode();

  return (
    <View style={styles.pageHeader}>
      <View style={styles.pageHeaderCopy}>
        {eyebrow ? (
          <Text style={[t.footnote, styles.pageEyebrow, { color: c.tint }]}>{eyebrow}</Text>
        ) : null}
        <Text
          accessibilityRole="header"
          style={[layout === 'compact' ? t.title1 : t.largeTitle, { color: c.label }]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={[t.subhead, styles.pageSubtitle, { color: c.secondaryLabel }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action ? <View style={styles.pageHeaderAction}>{action}</View> : null}
    </View>
  );
}

type NavGroupId = 'daily' | 'household' | 'schedule' | 'system';

interface NavItem {
  group: NavGroupId;
  label: string;
  href: Href;
  icon: LucideIcon;
  matches: (pathname: string) => boolean;
  children?: { label: string; href: Href; matches: (pathname: string) => boolean }[];
  requiresMemberManagement?: boolean;
}

const NAV_GROUPS: { id: NavGroupId; label: string }[] = [
  { id: 'daily', label: '日常' },
  { id: 'household', label: '家庭管理' },
  { id: 'schedule', label: '日程与消息' },
  { id: 'system', label: '系统与账户' },
];

const NAV_ITEMS: NavItem[] = [
  {
    group: 'daily',
    label: '问问小管家',
    href: '/assistant',
    icon: Sparkles,
    matches: (pathname) => pathname === '/assistant',
  },
  {
    group: 'daily',
    label: '家庭首页',
    href: '/',
    icon: LayoutDashboard,
    matches: (pathname) => pathname === '/',
  },
  {
    group: 'daily',
    label: '家庭食堂',
    href: '/canteen',
    icon: CookingPot,
    matches: (pathname) =>
      pathname === '/canteen' ||
      pathname === '/order' ||
      pathname === '/recipes' ||
      pathname === '/kitchen',
    children: [
      { label: '食堂首页', href: '/canteen', matches: (pathname) => pathname === '/canteen' },
      { label: '点菜', href: '/order', matches: (pathname) => pathname === '/order' },
      { label: '家庭菜谱', href: '/recipes', matches: (pathname) => pathname === '/recipes' },
      { label: '菜单安排', href: '/kitchen', matches: (pathname) => pathname === '/kitchen' },
    ],
  },
  {
    group: 'daily',
    label: '家庭观影',
    href: '/media',
    icon: Film,
    matches: (pathname) => pathname === '/media' || pathname.startsWith('/media/'),
    children: [
      { label: '观影首页', href: '/media', matches: (pathname) => pathname === '/media' },
      {
        label: '家庭片单',
        href: '/media/watchlist',
        matches: (pathname) => pathname === '/media/watchlist',
      },
      {
        label: '我的媒体库',
        href: '/media/library',
        matches: (pathname) => pathname === '/media/library',
      },
      {
        label: '观影投票',
        href: '/media/polls',
        matches: (pathname) => pathname === '/media/polls',
      },
      {
        label: '观看记录',
        href: '/media/history',
        matches: (pathname) => pathname === '/media/history',
      },
    ],
  },
  { group: 'daily', label: '家庭投票', href: '/polls', icon: Vote, matches: (pathname) => pathname === '/polls' },
  { group: 'daily', label: '采购与库存', href: '/shopping', icon: ShoppingCart, matches: (pathname) => pathname === '/shopping' },
  { group: 'household', label: '家庭资产', href: '/home-assets', icon: Wrench, matches: (pathname) => pathname === '/home-assets' },
  { group: 'household', label: '家庭财务', href: '/finance', icon: WalletCards, matches: (pathname) => pathname === '/finance' },
  { group: 'household', label: '积分奖励', href: '/points', icon: Gift, matches: (pathname) => pathname === '/points' },
  { group: 'household', label: '家庭知识库', href: '/knowledge', icon: BookOpenText, matches: (pathname) => pathname === '/knowledge' },
  { group: 'household', label: '家庭回忆', href: '/memories', icon: Images, matches: (pathname) => pathname === '/memories' },
  { group: 'household', label: '家庭出行', href: '/travel', icon: Plane, matches: (pathname) => pathname === '/travel' },
  { group: 'household', label: '家庭任务', href: '/tasks', icon: ListTodo, matches: (pathname) => pathname === '/tasks' },
  { group: 'household', label: '访客来访', href: '/guests', icon: UsersRound, matches: (pathname) => pathname === '/guests' },
  { group: 'schedule', label: '家庭日历', href: '/calendar', icon: CalendarDays, matches: (pathname) => pathname === '/calendar' },
  { group: 'schedule', label: '提醒中心', href: '/reminders', icon: BellRing, matches: (pathname) => pathname === '/reminders' },
  { group: 'schedule', label: '家庭活动', href: '/activity', icon: History, matches: (pathname) => pathname === '/activity' },
  {
    group: 'system',
    label: '系统备份',
    href: '/system-backups',
    icon: DatabaseBackup,
    matches: (pathname) => pathname === '/system-backups',
    requiresMemberManagement: true,
  },
  {
    group: 'system',
    label: '成员管理',
    href: '/members',
    icon: UsersRound,
    matches: (pathname) => pathname === '/members',
    requiresMemberManagement: true,
  },
  { group: 'system', label: '我的', href: '/profile', icon: UserRound, matches: (pathname) => pathname === '/profile' },
];

function formatToday() {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const pathname = usePathname();
  const router = useRouter();
  const { member } = useSession();
  const adminDesktop = desktop && isHouseholdManager(member);
  const { data: notifications } = useNotifications(false, adminDesktop);
  const activeModule = NAV_ITEMS.find((item) => item.matches(pathname));
  const activeGroupId = activeModule?.group;
  const [expandedGroups, setExpandedGroups] = React.useState<Record<NavGroupId, boolean>>(
    () => ({
      daily: !activeGroupId || activeGroupId === 'daily',
      household: activeGroupId === 'household',
      schedule: activeGroupId === 'schedule',
      system: activeGroupId === 'system',
    }),
  );
  React.useEffect(() => {
    if (!activeGroupId) return;
    setExpandedGroups((current) =>
      current[activeGroupId] ? current : { ...current, [activeGroupId]: true },
    );
  }, [activeGroupId]);
  const activeChild = activeModule?.children?.find((item) => item.matches(pathname));
  const activeItem = pathname === '/notifications'
    ? { label: '通知中心', icon: Bell }
    : activeChild
      ? { label: activeChild.label, icon: activeModule?.icon ?? House }
      : { label: activeModule?.label ?? '小管家', icon: activeModule?.icon ?? House };
  const ActiveIcon = activeItem.icon;
  const unreadCount = notifications?.length ?? 0;
  const materialStyle = Platform.OS === 'web'
    ? ({ backdropFilter: 'blur(22px) saturate(155%)' } as ViewStyle)
    : undefined;

  if (!adminDesktop) return <>{children}</>;

  return (
    <View style={[styles.shell, { backgroundColor: c.bg }]}>
      <View
        style={[
          styles.sidebar,
          { backgroundColor: c.chromeStrong, borderRightColor: c.separator },
          materialStyle,
        ]}
        testID="admin-desktop-sidebar"
      >
        <View style={styles.brand}>
          <View style={[styles.brandMark, { backgroundColor: c.tint }]}>
            <House color="#FFFFFF" size={22} strokeWidth={2.2} />
          </View>
          <View>
            <Text style={[t.headline, { color: c.label }]}>小管家</Text>
            <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>家庭空间</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.navContent}
          showsVerticalScrollIndicator={false}
          style={styles.nav}
        >
          {NAV_GROUPS.map((group) => {
            const groupItems = NAV_ITEMS.filter(
              (item) =>
                item.group === group.id &&
                (!item.requiresMemberManagement ||
                  member?.role === 'owner' ||
                  member?.role === 'admin'),
            );
            if (!groupItems.length) return null;
            const activeGroup = activeGroupId === group.id;
            const expanded = activeGroup || expandedGroups[group.id];
            return (
              <View key={group.id} style={styles.navGroup}>
                <PressSurface
                  ariaExpanded={expanded}
                  accessibilityLabel={`${expanded ? '收起' : '展开'}${group.label}`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: activeGroup, expanded }}
                  disabled={activeGroup}
                  onPress={() =>
                    setExpandedGroups((current) => ({
                      ...current,
                      [group.id]: !current[group.id],
                    }))
                  }
                  pressedColor={c.fill}
                  style={[
                    styles.navGroupHeader,
                    activeGroup && { backgroundColor: c.fill },
                  ]}
                  testID={`desktop-nav-group-${group.id}`}
                >
                  <Text
                    style={[
                      t.caption,
                      {
                        color: activeGroup ? c.label : c.secondaryLabel,
                        fontWeight: '700',
                      },
                    ]}
                  >
                    {group.label}
                  </Text>
                  <ChevronDown
                    color={activeGroup ? c.label : c.tertiaryLabel}
                    size={16}
                    style={{ transform: [{ rotate: expanded ? '0deg' : '-90deg' }] }}
                  />
                </PressSurface>
                {expanded ? (
                  <View style={styles.navGroupItems}>
                    {groupItems.map((item) => {
                      const active = activeModule === item;
                      const Icon = item.icon;
                      return (
                        <View key={item.label}>
                          <PressSurface
                            accessibilityRole="link"
                            onPress={() => router.replace(item.href)}
                            pressedColor={c.fill}
                            style={[
                              styles.navItem,
                              { backgroundColor: active ? c.tintSoft : 'transparent' },
                            ]}
                          >
                            <Icon color={active ? c.tint : c.secondaryLabel} size={20} />
                            <Text
                              style={[
                                t.subhead,
                                {
                                  color: active ? c.tint : c.label,
                                  fontWeight: active ? '700' : '500',
                                },
                              ]}
                            >
                              {item.label}
                            </Text>
                          </PressSurface>
                          {active && item.children ? (
                            <View style={styles.subnav}>
                              {item.children.map((child) => {
                                const childActive = child.matches(pathname);
                                return (
                                  <PressSurface
                                    accessibilityRole="link"
                                    key={child.label}
                                    onPress={() => router.replace(child.href)}
                                    pressedColor={c.fill}
                                    style={styles.subnavItem}
                                  >
                                    <View
                                      style={[
                                        styles.subnavMarker,
                                        {
                                          backgroundColor: childActive
                                            ? c.tint
                                            : c.separator,
                                        },
                                      ]}
                                    />
                                    <Text
                                      style={[
                                        t.footnote,
                                        {
                                          color: childActive ? c.tint : c.secondaryLabel,
                                          fontWeight: childActive ? '700' : '500',
                                        },
                                      ]}
                                    >
                                      {child.label}
                                    </Text>
                                  </PressSurface>
                                );
                              })}
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>

        <PressSurface
          accessibilityRole="button"
          onPress={() => router.replace('/profile')}
          pressedColor={c.fill}
          style={[styles.member, { borderTopColor: c.separator }]}
        >
          <View style={[styles.avatar, { backgroundColor: c.orangeSoft }]}>
            <Text style={styles.avatarEmoji}>{member?.avatarEmoji ?? '👤'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]}>
              {member?.name}
            </Text>
            <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>
              {member ? memberSubtitle(member) : '家庭成员'}
            </Text>
          </View>
          <UserRound color={c.tertiaryLabel} size={18} />
        </PressSurface>
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <View
          style={[
            styles.topbar,
            { backgroundColor: c.chrome, borderBottomColor: c.separator },
            materialStyle,
          ]}
        >
          <View style={styles.topbarTitle}>
            <ActiveIcon color={c.tint} size={18} />
            <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]}>
              {activeItem.label}
            </Text>
          </View>
          <View style={styles.topbarActions}>
            <Text style={[t.footnote, { color: c.secondaryLabel }]}>{formatToday()}</Text>
            <View>
              <IconButton
                accessibilityLabel={`打开通知中心${unreadCount ? `，${unreadCount}条未读` : ''}`}
                backgroundColor="transparent"
                color={unreadCount ? c.tint : c.secondaryLabel}
                icon={Bell}
                onPress={() => router.push('/notifications')}
                style={styles.notificationButton}
                testID="desktop-notification-button"
              />
              {unreadCount ? (
                <View style={[styles.notificationBadge, { backgroundColor: c.red }]}>
                  <Text style={styles.notificationBadgeText}>
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
        <View style={{ flex: 1, minHeight: 0 }}>{children}</View>
      </View>
    </View>
  );
}

export function ModuleBackButton({
  href,
  label,
  showOnDesktop = false,
}: {
  href: Href;
  label: string;
  showOnDesktop?: boolean;
}) {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();

  if (desktop && !showOnDesktop) return null;

  return (
    <PressSurface
      accessibilityLabel={`返回${label}`}
      accessibilityRole="button"
      onPress={() => {
        if (href === '/' && router.canGoBack()) {
          router.back();
          return;
        }
        router.replace(href);
      }}
      pressedColor={c.fillStrong}
      style={[styles.moduleBackButton, { backgroundColor: c.card, borderColor: c.separator }]}
    >
      <ArrowLeft color={c.label} size={18} />
      <Text style={[t.footnote, { color: c.label, fontWeight: '700' }]}>{label}</Text>
    </PressSurface>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: 'row' },
  sidebar: {
    width: 232,
    borderRightWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  brand: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 8,
  },
  brandMark: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nav: { flex: 1, marginTop: 14 },
  navContent: { gap: 2, paddingBottom: 18 },
  navGroup: { gap: 1 },
  navGroupHeader: {
    height: 44,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navGroupItems: { gap: 2, paddingBottom: 4 },
  navItem: {
    height: 44,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
  },
  subnav: { paddingLeft: 21, paddingTop: 4, paddingBottom: 3, gap: 1 },
  subnavItem: {
    minHeight: 44,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  subnavMarker: { width: 5, height: 5, borderRadius: 3 },
  member: {
    minHeight: 76,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: -16,
    paddingHorizontal: 20,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: { fontSize: 21 },
  topbar: {
    height: 64,
    borderBottomWidth: 1,
    paddingHorizontal: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  topbarTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  topbarActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  notificationButton: {
    width: 44,
    height: 44,
  },
  notificationBadge: {
    position: 'absolute',
    top: 3,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationBadgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  pageContainer: { width: '100%', alignSelf: 'center' },
  pageHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 16,
  },
  pageHeaderCopy: { flex: 1, minWidth: 220 },
  pageHeaderAction: { alignSelf: 'center' },
  pageEyebrow: { fontWeight: '700', marginBottom: 6 },
  pageSubtitle: { marginTop: 4 },
  moduleBackButton: {
    minHeight: 44,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
