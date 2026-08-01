import {
  ArrowRight,
  Bell,
  BellRing,
  CalendarDays,
  CookingPot,
  Film,
  ListTodo,
  ShoppingCart,
  UsersRound,
  Vote,
  Wrench,
  type LucideIcon,
} from 'lucide-react-native';
import { useRouter, type Href } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageContainer, useDesktopLayout } from '../../components/app-shell';
import { Card } from '../../components/ui';
import { todayStr } from '../../lib/date';
import {
  useAssets,
  useMedia,
  useMenusOfDate,
  useNotifications,
  usePolls,
  useReminders,
  useShoppingList,
  useTasks,
  useVisits,
} from '../../lib/queries';
import { useSession } from '../../lib/session';
import { radius, type as t, useTheme } from '../../lib/theme';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 11) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function fullDate() {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());
}

function reminderTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function ModuleCard({
  background,
  color,
  href,
  icon: Icon,
  label,
  status,
  desktop,
}: {
  background: string;
  color: string;
  href: Href;
  icon: LucideIcon;
  label: string;
  status: string;
  desktop: boolean;
}) {
  const c = useTheme();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(href)}
      style={({ pressed }) => [
        styles.moduleCell,
        desktop && styles.moduleCellDesktop,
        { opacity: pressed ? 0.72 : 1 },
      ]}
    >
      <Card style={styles.moduleCard}>
        <View style={[styles.moduleIcon, { backgroundColor: background }]}>
          <Icon color={color} size={23} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={2} style={[t.headline, { color: c.label }]}>
            {label}
          </Text>
          <Text numberOfLines={1} style={[t.caption, { color: c.secondaryLabel, marginTop: 5 }]}>
            {status}
          </Text>
        </View>
        <ArrowRight color={c.tertiaryLabel} size={17} />
      </Card>
    </Pressable>
  );
}

function TodayRow({
  href,
  icon: Icon,
  label,
  value,
  color,
  background,
}: {
  href: Href;
  icon: LucideIcon;
  label: string;
  value: string;
  color: string;
  background: string;
}) {
  const c = useTheme();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(href)}
      style={({ pressed }) => [
        styles.todayRow,
        { borderBottomColor: c.separator, backgroundColor: pressed ? c.fill : 'transparent' },
      ]}
    >
      <View style={[styles.todayIcon, { backgroundColor: background }]}>
        <Icon color={color} size={18} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]}>{label}</Text>
        <Text numberOfLines={1} style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>
          {value}
        </Text>
      </View>
      <ArrowRight color={c.tertiaryLabel} size={16} />
    </Pressable>
  );
}

export default function HomeScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const { member } = useSession();
  const today = todayStr();
  const { data: menus, isLoading: menusLoading } = useMenusOfDate(today);
  const { data: shopping } = useShoppingList(today);
  const { data: tasks, isLoading: tasksLoading } = useTasks(today, today);
  const { data: notifications } = useNotifications();
  const { data: polls } = usePolls();
  const { data: media } = useMedia('all');
  const { data: reminders, isLoading: remindersLoading } = useReminders('scheduled');
  const { data: visits } = useVisits('scheduled');
  const { data: assets } = useAssets('active');

  const menuItems =
    menus?.reduce(
      (sum, menu) => sum + menu.items.filter((item) => item.status !== 'rejected').length,
      0,
    ) ?? 0;
  const shoppingPending = shopping?.filter((item) => !item.checked).length ?? 0;
  const pendingTasks = tasks?.filter((entry) => entry.status === 'pending') ?? [];
  const openPolls = polls?.filter((poll) => poll.status === 'open') ?? [];
  const unreadCount = notifications?.length ?? 0;
  const activeMedia =
    media?.filter((entry) => entry.status !== 'completed' && entry.status !== 'dropped').length ?? 0;
  const upcomingReminder = reminders?.[0];
  const upcomingVisits = visits?.filter((visit) => new Date(visit.startsAt) >= new Date()).length ?? 0;
  const dueMaintenance =
    assets?.reduce(
      (sum, asset) =>
        sum +
        asset.maintenancePlans.filter(
          (plan) => plan.isEnabled && plan.nextDueDate <= todayStr(30),
        ).length,
      0,
    ) ?? 0;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <PageContainer style={[styles.content, desktop && styles.contentDesktop]}>
          <View style={[styles.hero, desktop && styles.heroDesktop]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>家庭工作台</Text>
              <Text style={[desktop ? t.largeTitle : t.title1, { color: c.label, marginTop: 6 }]}>
                {greeting()}，{member?.name}
              </Text>
              <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 6 }]}>{fullDate()}</Text>
            </View>
            <Pressable
              accessibilityLabel={`打开通知中心${unreadCount ? `，${unreadCount}条未读` : ''}`}
              accessibilityRole="button"
              onPress={() => router.push('/notifications')}
              style={({ pressed }) => [
                styles.bellButton,
                { backgroundColor: pressed ? c.fillStrong : c.card, borderColor: c.separator },
              ]}
            >
              <Bell color={unreadCount ? c.tint : c.secondaryLabel} size={20} />
              {unreadCount ? (
                <View style={[styles.bellBadge, { backgroundColor: c.red }]}>
                  <Text style={styles.bellBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                </View>
              ) : null}
            </Pressable>
          </View>

          <View style={styles.sectionTitle}>
            <Text style={[t.title2, { color: c.label }]}>功能模块</Text>
          </View>
          <View style={styles.moduleGrid}>
            <ModuleCard
              background={c.orangeSoft}
              color={c.orange}
              desktop={desktop}
              href="/canteen"
              icon={CookingPot}
              label="家庭食堂"
              status={`今日 ${menuItems} 道菜`}
            />
            <ModuleCard
              background={c.accentSoft}
              color={c.accent}
              desktop={desktop}
              href="/media"
              icon={Film}
              label="家庭观影"
              status={`${activeMedia} 部待看`}
            />
            <ModuleCard
              background={c.blueSoft}
              color={c.blue}
              desktop={desktop}
              href="/polls"
              icon={Vote}
              label="家庭投票"
              status={`${openPolls.length} 个进行中`}
            />
            <ModuleCard
              background={c.greenSoft}
              color={c.green}
              desktop={desktop}
              href="/shopping"
              icon={ShoppingCart}
              label="采购与库存"
              status={`${shoppingPending} 项待购买`}
            />
            <ModuleCard
              background={c.tintSoft}
              color={c.tint}
              desktop={desktop}
              href="/tasks"
              icon={ListTodo}
              label="家庭任务"
              status={`${pendingTasks.length} 项待办`}
            />
            <ModuleCard
              background={c.blueSoft}
              color={c.blue}
              desktop={desktop}
              href="/guests"
              icon={UsersRound}
              label="访客来访"
              status={`${upcomingVisits} 次待安排`}
            />
            <ModuleCard
              background={c.orangeSoft}
              color={c.orange}
              desktop={desktop}
              href="/assets"
              icon={Wrench}
              label="家庭资产"
              status={dueMaintenance ? `${dueMaintenance} 项维护将到期` : `${assets?.length ?? 0} 件在用`}
            />
          </View>

          <View style={styles.sectionTitle}>
            <Text style={[t.title2, { color: c.label }]}>今天</Text>
            <Pressable accessibilityRole="link" onPress={() => router.push('/calendar')} style={styles.textLink}>
              <CalendarDays color={c.tint} size={16} />
              <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>家庭日历</Text>
            </Pressable>
          </View>
          <Card style={styles.todayCard}>
            {menusLoading || tasksLoading || remindersLoading ? (
              <ActivityIndicator color={c.tint} style={styles.loader} />
            ) : (
              <>
                <TodayRow
                  background={c.orangeSoft}
                  color={c.orange}
                  href="/canteen"
                  icon={CookingPot}
                  label="今日菜单"
                  value={menuItems ? `${menuItems} 道菜已安排` : '还没有安排菜品'}
                />
                <TodayRow
                  background={c.tintSoft}
                  color={c.tint}
                  href="/tasks"
                  icon={ListTodo}
                  label="今日任务"
                  value={pendingTasks.length ? `${pendingTasks.length} 项待完成` : '今天没有待办'}
                />
                <TodayRow
                  background={c.blueSoft}
                  color={c.blue}
                  href="/reminders"
                  icon={BellRing}
                  label="近期提醒"
                  value={
                    upcomingReminder
                      ? `${reminderTime(upcomingReminder.remindAt)} · ${upcomingReminder.source?.title ?? '家庭事项'}`
                      : '暂无待发送提醒'
                  }
                />
              </>
            )}
          </Card>
        </PageContainer>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingTop: 18, paddingBottom: 40 },
  contentDesktop: { paddingTop: 32 },
  hero: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  heroDesktop: { alignItems: 'center' },
  bellButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  sectionTitle: {
    minHeight: 38,
    marginTop: 30,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  moduleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  moduleCell: { width: '47%', minWidth: 0, flexGrow: 1 },
  moduleCellDesktop: { width: '18%' },
  moduleCard: {
    minHeight: 132,
    padding: 14,
    alignItems: 'flex-start',
    gap: 10,
  },
  moduleIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textLink: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 5 },
  todayCard: { overflow: 'hidden' },
  todayRow: {
    minHeight: 70,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  todayIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loader: { marginVertical: 36 },
});
