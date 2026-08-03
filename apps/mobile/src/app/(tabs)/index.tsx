import {
  ArrowRight,
  Bell,
  BellRing,
  BookOpenText,
  CalendarDays,
  CookingPot,
  Film,
  Gift,
  ListTodo,
  Plane,
  ShoppingCart,
  UsersRound,
  Vote,
  Wrench,
  type LucideIcon,
} from 'lucide-react-native';
import { useRouter, type Href } from 'expo-router';
import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageContainer, useDesktopLayout } from '../../components/app-shell';
import {
  Card,
  IconButton,
  PressableScale,
  PressSurface,
  SkeletonRows,
} from '../../components/ui';
import { todayStr } from '../../lib/date';
import {
  useAssets,
  useKnowledgeArticles,
  useMedia,
  useMenusOfDate,
  useNotifications,
  usePolls,
  usePointsAccounts,
  useReminders,
  useShoppingList,
  useTasks,
  useTravelPlans,
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
}: {
  background: string;
  color: string;
  href: Href;
  icon: LucideIcon;
  label: string;
  status: string;
}) {
  const c = useTheme();
  const router = useRouter();
  return (
    <PressableScale
      accessibilityRole="link"
      onPress={() => router.push(href)}
      style={styles.moduleCell}
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
    </PressableScale>
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
    <PressSurface
      accessibilityRole="link"
      onPress={() => router.push(href)}
      pressedColor={c.fill}
      style={[styles.todayRow, { borderBottomColor: c.separator }]}
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
    </PressSurface>
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
  const { data: pointsAccounts } = usePointsAccounts();
  const { data: knowledgeArticles } = useKnowledgeArticles('active');
  const { data: travelPlans } = useTravelPlans('active');

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
  const ownPoints = pointsAccounts?.find((account) => account.memberId === member?.id)?.balance ?? 0;
  const moduleEntries: {
    background: string;
    color: string;
    href: Href;
    icon: LucideIcon;
    label: string;
    status: string;
  }[] = [
    {
      background: c.orangeSoft,
      color: c.orange,
      href: '/canteen',
      icon: CookingPot,
      label: '家庭食堂',
      status: `今日 ${menuItems} 道菜`,
    },
    {
      background: c.accentSoft,
      color: c.accent,
      href: '/media',
      icon: Film,
      label: '家庭观影',
      status: `${activeMedia} 部待看`,
    },
    {
      background: c.blueSoft,
      color: c.blue,
      href: '/polls',
      icon: Vote,
      label: '家庭投票',
      status: `${openPolls.length} 个进行中`,
    },
    {
      background: c.greenSoft,
      color: c.green,
      href: '/shopping',
      icon: ShoppingCart,
      label: '采购与库存',
      status: `${shoppingPending} 项待购买`,
    },
    {
      background: c.tintSoft,
      color: c.tint,
      href: '/tasks',
      icon: ListTodo,
      label: '家庭任务',
      status: `${pendingTasks.length} 项待办`,
    },
    {
      background: c.blueSoft,
      color: c.blue,
      href: '/guests',
      icon: UsersRound,
      label: '访客来访',
      status: `${upcomingVisits} 次待安排`,
    },
    {
      background: c.orangeSoft,
      color: c.orange,
      href: '/home-assets',
      icon: Wrench,
      label: '家庭资产',
      status: dueMaintenance
        ? `${dueMaintenance} 项维护将到期`
        : `${assets?.length ?? 0} 件在用`,
    },
    {
      background: c.accentSoft,
      color: c.accent,
      href: '/points',
      icon: Gift,
      label: '积分奖励',
      status: `我的积分 ${ownPoints}`,
    },
    {
      background: c.tintSoft,
      color: c.tint,
      href: '/knowledge',
      icon: BookOpenText,
      label: '家庭知识库',
      status: `${knowledgeArticles?.length ?? 0} 篇文章`,
    },
    {
      background: c.blueSoft,
      color: c.blue,
      href: '/travel',
      icon: Plane,
      label: '家庭出行',
      status: `${travelPlans?.length ?? 0} 个计划中行程`,
    },
  ];

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
            {!desktop ? (
              <View>
                <IconButton
                  accessibilityLabel={`打开通知中心${unreadCount ? `，${unreadCount}条未读` : ''}`}
                  backgroundColor={c.card}
                  color={unreadCount ? c.tint : c.secondaryLabel}
                  icon={Bell}
                  onPress={() => router.push('/notifications')}
                  style={[styles.bellButton, { borderColor: c.separator }]}
                  testID="home-notification-button"
                />
                {unreadCount ? (
                  <View style={[styles.bellBadge, { backgroundColor: c.red }]}>
                    <Text style={styles.bellBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          <View style={styles.sectionTitle}>
            <Text style={[t.title2, { color: c.label }]}>今天需要关注</Text>
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push('/calendar')}
              style={styles.textLink}
            >
              <CalendarDays color={c.tint} size={16} />
              <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>家庭日历</Text>
            </Pressable>
          </View>
          <Card style={[styles.todayCard, desktop && styles.todayCardDesktop]}>
            {menusLoading || tasksLoading || remindersLoading ? (
              <SkeletonRows />
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

          {!desktop ? (
            <>
              <View style={styles.sectionTitle}>
                <Text style={[t.title2, { color: c.label }]}>功能模块</Text>
              </View>
              <View style={styles.moduleGrid}>
                {moduleEntries.map((entry) => (
                  <ModuleCard key={entry.label} {...entry} />
                ))}
              </View>
            </>
          ) : null}
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
    borderWidth: 1,
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
  moduleCard: {
    minHeight: 82,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  moduleIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5 },
  todayCard: { overflow: 'hidden' },
  todayCardDesktop: { maxWidth: 760 },
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
});
