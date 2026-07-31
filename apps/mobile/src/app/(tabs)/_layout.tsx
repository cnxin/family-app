import { Redirect, Tabs } from 'expo-router';
import {
  Bell,
  CalendarDays,
  LayoutDashboard,
  UserRound,
  type LucideIcon,
} from 'lucide-react-native';
import React from 'react';
import { ColorValue } from 'react-native';
import { AppShell, useDesktopLayout } from '../../components/app-shell';
import { useNotifications } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { useTheme } from '../../lib/theme';

function TabIcon({
  icon: Icon,
  color,
}: {
  icon: LucideIcon;
  color: ColorValue;
}) {
  return <Icon color={color} size={22} strokeWidth={2.1} />;
}

export default function TabLayout() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const { member, ready } = useSession();
  const { data: notifications } = useNotifications(false, ready && Boolean(member) && !desktop);

  if (!ready) return null;
  if (!member) return <Redirect href="/login" />;

  const tabs = (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.tint,
        tabBarInactiveTintColor: c.secondaryLabel,
        tabBarStyle: desktop
          ? { display: 'none' }
          : {
              backgroundColor: c.card,
              borderTopColor: c.separator,
              height: 68,
              paddingTop: 7,
              paddingBottom: 8,
            },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '首页',
          tabBarIcon: ({ color }) => (
            <TabIcon icon={LayoutDashboard} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="order"
        options={{
          title: '点菜',
          href: null,
        }}
      />
      <Tabs.Screen
        name="kitchen"
        options={{
          title: '菜单',
          href: null,
        }}
      />
      <Tabs.Screen
        name="recipes"
        options={{
          title: '菜谱',
          href: null,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: '日历',
          tabBarIcon: ({ color }) => (
            <TabIcon icon={CalendarDays} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: '任务',
          href: null,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: '通知',
          tabBarBadge: notifications?.length
            ? notifications.length > 99
              ? '99+'
              : notifications.length
            : undefined,
          tabBarBadgeStyle: { backgroundColor: c.red, color: '#FFFFFF', fontSize: 10 },
          tabBarIcon: ({ color }) => <TabIcon icon={Bell} color={color} />,
        }}
      />
      <Tabs.Screen
        name="polls"
        options={{
          title: '投票',
          href: null,
        }}
      />
      <Tabs.Screen
        name="reminders"
        options={{
          title: '提醒',
          href: null,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: '活动',
          href: null,
        }}
      />
      <Tabs.Screen
        name="members"
        options={{
          title: '成员',
          href: null,
        }}
      />
      <Tabs.Screen
        name="guests"
        options={{
          title: '访客',
          href: null,
        }}
      />
      <Tabs.Screen
        name="media"
        options={{
          title: '观影',
          href: null,
        }}
      />
      <Tabs.Screen
        name="shopping"
        options={{
          title: '采购',
          href: null,
        }}
      />
      <Tabs.Screen
        name="canteen"
        options={{
          title: '食堂',
          href: null,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '我的',
          tabBarIcon: ({ color }) => (
            <TabIcon icon={UserRound} color={color} />
          ),
        }}
      />
    </Tabs>
  );

  return <AppShell>{tabs}</AppShell>;
}
