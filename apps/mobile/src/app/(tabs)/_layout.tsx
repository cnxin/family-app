import { Redirect, Tabs } from 'expo-router';
import {
  Bell,
  CalendarDays,
  CookingPot,
  House,
  LayoutDashboard,
  UserRound,
  type LucideIcon,
} from 'lucide-react-native';
import React from 'react';
import { ColorValue, Platform, View, type ViewStyle } from 'react-native';
import { AppShell, useDesktopLayout } from '../../components/app-shell';
import { isHouseholdManager } from '../../lib/member';
import { useNotifications } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { useTheme } from '../../lib/theme';

function TabIcon({
  icon: Icon,
  color,
  backgroundColor,
  focused,
}: {
  icon: LucideIcon;
  color: ColorValue;
  backgroundColor?: string;
  focused?: boolean;
}) {
  return (
    <View
      style={backgroundColor && focused ? {
        alignItems: 'center',
        backgroundColor,
        borderRadius: 14,
        height: 28,
        justifyContent: 'center',
        width: 38,
      } : undefined}
    >
      <Icon color={color} size={22} strokeWidth={focused ? 2.3 : 2} />
    </View>
  );
}

export default function TabLayout() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const { member, ready } = useSession();
  const consumer = member?.role === 'member';
  const adminDesktop = desktop && isHouseholdManager(member);
  const { data: notifications } = useNotifications(
    false,
    ready && Boolean(member) && !adminDesktop,
  );
  const tabBarMaterial = Platform.OS === 'web'
    ? ({ backdropFilter: 'blur(22px) saturate(155%)' } as ViewStyle)
    : undefined;

  if (!ready) return null;
  if (!member) return <Redirect href="/login" />;

  const tabs = (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.tint,
        tabBarInactiveTintColor: c.secondaryLabel,
        tabBarStyle: adminDesktop
          ? { display: 'none' }
          : consumer
            ? {
              backgroundColor: c.chromeStrong,
              borderTopWidth: 0,
              height: 74,
              paddingTop: 6,
              paddingBottom: 9,
              ...tabBarMaterial,
              ...(Platform.OS === 'web'
                ? { boxShadow: '0 -6px 22px rgba(23, 50, 36, 0.07)' }
                : {
                  elevation: 10,
                  shadowColor: '#173224',
                  shadowOffset: { width: 0, height: -4 },
                  shadowOpacity: 0.07,
                  shadowRadius: 12,
                }),
            }
            : {
              backgroundColor: c.chrome,
              borderTopColor: c.separator,
              height: 68,
              paddingTop: 7,
              paddingBottom: 8,
              ...tabBarMaterial,
            },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: consumer ? '今天' : '首页',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              backgroundColor={consumer ? c.tintSoft : undefined}
              color={color}
              focused={focused}
              icon={consumer ? House : LayoutDashboard}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="assistant"
        options={{
          title: '问问小管家',
          href: null,
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
        name="canteen"
        options={{
          title: consumer ? '吃饭' : '食堂',
          href: consumer ? '/canteen' : null,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              backgroundColor={consumer ? c.orangeSoft : undefined}
              color={color}
              focused={focused}
              icon={CookingPot}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: consumer ? '安排' : '日历',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              backgroundColor={consumer ? c.tintSoft : undefined}
              color={color}
              focused={focused}
              icon={CalendarDays}
            />
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
          title: consumer ? '消息' : '通知',
          tabBarBadge: notifications?.length
            ? notifications.length > 99
              ? '99+'
              : notifications.length
            : undefined,
          tabBarBadgeStyle: { backgroundColor: c.red, color: '#FFFFFF', fontSize: 10 },
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              backgroundColor={consumer ? c.tintSoft : undefined}
              color={color}
              focused={focused}
              icon={Bell}
            />
          ),
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
        name="assets"
        options={{
          title: '资产',
          href: null,
        }}
      />
      <Tabs.Screen
        name="home-assets"
        options={{
          title: '资产',
          href: null,
        }}
      />
      <Tabs.Screen
        name="points"
        options={{
          title: '积分',
          href: null,
        }}
      />
      <Tabs.Screen
        name="knowledge"
        options={{
          title: '知识库',
          href: null,
        }}
      />
      <Tabs.Screen
        name="memories"
        options={{
          title: '家庭回忆',
          href: null,
        }}
      />
      <Tabs.Screen
        name="travel"
        options={{
          title: '出行',
          href: null,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '我的',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              backgroundColor={consumer ? c.tintSoft : undefined}
              color={color}
              focused={focused}
              icon={UserRound}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="system-backups"
        options={{
          title: '备份',
          href: null,
        }}
      />
    </Tabs>
  );

  return <AppShell>{tabs}</AppShell>;
}
