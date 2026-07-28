import {
  ChefHat,
  CookingPot,
  House,
  LayoutDashboard,
  ShoppingCart,
  UserRound,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react-native';
import { usePathname, useRouter } from 'expo-router';
import React from 'react';
import {
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import { useSession } from '../lib/session';
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
  href: '/' | '/order' | '/kitchen' | '/shopping' | '/profile';
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { label: '家庭首页', href: '/', icon: LayoutDashboard },
  { label: '点菜', href: '/order', icon: UtensilsCrossed },
  { label: '菜单安排', href: '/kitchen', icon: CookingPot },
  { label: '采购与库存', href: '/shopping', icon: ShoppingCart },
  { label: '我的', href: '/profile', icon: UserRound },
];

function currentRoute(pathname: string) {
  if (pathname === '/') return '/';
  return `/${pathname.split('/').filter(Boolean)[0] ?? ''}`;
}

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
  const activeRoute = currentRoute(pathname);
  const activeItem = NAV_ITEMS.find((item) => item.href === activeRoute) ?? NAV_ITEMS[0];

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

        <View style={styles.nav}>
          {NAV_ITEMS.map((item) => {
            const active = item.href === activeRoute;
            const Icon = item.icon;
            return (
              <Pressable
                key={item.href}
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
            );
          })}
        </View>

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
              {member?.role === 'chef' ? '经常掌勺' : '家庭成员'}
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
            <ChefHat color={c.tint} size={18} />
            <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]}>
              {activeItem.label}
            </Text>
          </View>
          <Text style={[t.footnote, { color: c.secondaryLabel }]}>{formatToday()}</Text>
        </View>
        <View style={{ flex: 1, minHeight: 0 }}>{children}</View>
      </View>
    </View>
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
  nav: { flex: 1, paddingTop: 28, gap: 6 },
  navItem: {
    height: 44,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
  },
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
  pageContainer: { width: '100%', alignSelf: 'center' },
});
