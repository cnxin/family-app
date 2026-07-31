import {
  ArrowLeft,
  Bell,
  BellRing,
  CalendarDays,
  CookingPot,
  Film,
  House,
  History,
  LayoutDashboard,
  ListTodo,
  ShoppingCart,
  UserRound,
  UsersRound,
  Vote,
  type LucideIcon,
} from 'lucide-react-native';
import { usePathname, useRouter, type Href } from 'expo-router';
import React from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import { useSession } from '../lib/session';
import { memberSubtitle } from '../lib/member';
import { useNotifications } from '../lib/queries';
import { radius, type as t, useTheme } from '../lib/theme';

export const DESKTOP_BREAKPOINT = 1024;

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
  const desktop = useDesktopLayout();
  return (
    <View
      style={[
        styles.pageContainer,
        { maxWidth, paddingHorizontal: desktop ? 32 : 16 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

interface NavItem {
  label: string;
  href: Href;
  icon: LucideIcon;
  matches: (pathname: string) => boolean;
  children?: { label: string; href: Href; matches: (pathname: string) => boolean }[];
  requiresMemberManagement?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    label: '家庭首页',
    href: '/',
    icon: LayoutDashboard,
    matches: (pathname) => pathname === '/',
  },
  {
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
  { label: '家庭投票', href: '/polls', icon: Vote, matches: (pathname) => pathname === '/polls' },
  { label: '采购与库存', href: '/shopping', icon: ShoppingCart, matches: (pathname) => pathname === '/shopping' },
  { label: '家庭任务', href: '/tasks', icon: ListTodo, matches: (pathname) => pathname === '/tasks' },
  { label: '访客来访', href: '/guests', icon: UsersRound, matches: (pathname) => pathname === '/guests' },
  { label: '家庭日历', href: '/calendar', icon: CalendarDays, matches: (pathname) => pathname === '/calendar' },
  { label: '提醒中心', href: '/reminders', icon: BellRing, matches: (pathname) => pathname === '/reminders' },
  { label: '家庭活动', href: '/activity', icon: History, matches: (pathname) => pathname === '/activity' },
  {
    label: '成员管理',
    href: '/members',
    icon: UsersRound,
    matches: (pathname) => pathname === '/members',
    requiresMemberManagement: true,
  },
  { label: '我的', href: '/profile', icon: UserRound, matches: (pathname) => pathname === '/profile' },
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
  const { data: notifications } = useNotifications(false, desktop);
  const activeModule = NAV_ITEMS.find((item) => item.matches(pathname));
  const activeChild = activeModule?.children?.find((item) => item.matches(pathname));
  const activeItem = pathname === '/notifications'
    ? { label: '通知中心', icon: Bell }
    : activeChild
      ? { label: activeChild.label, icon: activeModule?.icon ?? House }
      : { label: activeModule?.label ?? '小管家', icon: activeModule?.icon ?? House };
  const ActiveIcon = activeItem.icon;
  const unreadCount = notifications?.length ?? 0;

  if (!desktop) return <>{children}</>;

  return (
    <View style={[styles.shell, { backgroundColor: c.bg }]}>
      <View
        style={[
          styles.sidebar,
          { backgroundColor: c.card, borderRightColor: c.separator },
        ]}
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
          {NAV_ITEMS.filter(
            (item) =>
              !item.requiresMemberManagement ||
              member?.role === 'owner' ||
              member?.role === 'admin',
          ).map((item) => {
            const active = activeModule === item;
            const Icon = item.icon;
            return (
              <View key={item.label}>
                <Pressable
                  accessibilityRole="link"
                  onPress={() => router.replace(item.href)}
                  style={({ pressed }) => [
                    styles.navItem,
                    {
                      backgroundColor: active
                        ? c.tintSoft
                        : pressed
                          ? c.fill
                          : 'transparent',
                    },
                  ]}
                >
                  <Icon color={active ? c.tint : c.secondaryLabel} size={20} />
                  <Text
                    style={[
                      t.subhead,
                      { color: active ? c.tint : c.label, fontWeight: active ? '700' : '500' },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
                {active && item.children ? (
                  <View style={styles.subnav}>
                    {item.children.map((child) => {
                      const childActive = child.matches(pathname);
                      return (
                        <Pressable
                          accessibilityRole="link"
                          key={child.label}
                          onPress={() => router.replace(child.href)}
                          style={({ pressed }) => [
                            styles.subnavItem,
                            { backgroundColor: pressed ? c.fill : 'transparent' },
                          ]}
                        >
                          <View
                            style={[
                              styles.subnavMarker,
                              { backgroundColor: childActive ? c.tint : c.separator },
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
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/profile')}
          style={({ pressed }) => [
            styles.member,
            {
              borderTopColor: c.separator,
              backgroundColor: pressed ? c.fill : 'transparent',
            },
          ]}
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
        </Pressable>
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <View
          style={[
            styles.topbar,
            { backgroundColor: c.card, borderBottomColor: c.separator },
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
            <Pressable
              accessibilityLabel={`打开通知中心${unreadCount ? `，${unreadCount}条未读` : ''}`}
              accessibilityRole="button"
              onPress={() => router.push('/notifications')}
              style={({ pressed }) => [
                styles.notificationButton,
                { backgroundColor: pressed ? c.fill : 'transparent' },
              ]}
            >
              <Bell color={unreadCount ? c.tint : c.secondaryLabel} size={19} />
              {unreadCount ? (
                <View style={[styles.notificationBadge, { backgroundColor: c.red }]}>
                  <Text style={styles.notificationBadgeText}>
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>
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
    <Pressable
      accessibilityLabel={`返回${label}`}
      accessibilityRole="button"
      onPress={() => router.replace(href)}
      style={({ pressed }) => [
        styles.moduleBackButton,
        { backgroundColor: pressed ? c.fillStrong : c.card, borderColor: c.separator },
      ]}
    >
      <ArrowLeft color={c.label} size={18} />
      <Text style={[t.footnote, { color: c.label, fontWeight: '700' }]}>{label}</Text>
    </Pressable>
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
  nav: { flex: 1, marginTop: 22 },
  navContent: { gap: 6, paddingBottom: 18 },
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
    height: 34,
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
  },
  topbarTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  topbarActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  notificationButton: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
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
  moduleBackButton: {
    minHeight: 36,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
