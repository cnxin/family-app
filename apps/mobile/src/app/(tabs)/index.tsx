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

interface HomeModuleEntry {
  background: string;
  color: string;
  href: Href;
  icon: LucideIcon;
  label: string;
  status: string;
}

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

function ConsumerQuickCard({ entry }: { entry: HomeModuleEntry }) {
  const c = useTheme();
  const router = useRouter();
  return (
    <PressableScale
      accessibilityLabel={`${entry.label}，${entry.status}`}
      accessibilityRole="link"
      onPress={() => router.push(entry.href)}
      style={styles.consumerQuickCell}
      testID={`consumer-quick-${String(entry.href).replaceAll('/', '')}`}
    >
      <Card style={styles.consumerQuickCard}>
        <View style={[styles.consumerQuickIcon, { backgroundColor: entry.background }]}>
          <entry.icon color={entry.color} size={22} strokeWidth={2} />
        </View>
        <Text style={[t.headline, styles.consumerQuickTitle, { color: c.label }]}>
          {entry.label}
        </Text>
        <Text numberOfLines={1} style={[t.footnote, { color: c.secondaryLabel }]}>
          {entry.status}
        </Text>
      </Card>
    </PressableScale>
  );
}

function ConsumerAgendaRow({
  background,
  color,
  href,
  icon: Icon,
  label,
  value,
}: {
  background: string;
  color: string;
  href: Href;
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  const c = useTheme();
  const router = useRouter();
  return (
    <PressableScale
      accessibilityLabel={`${label}，${value}`}
      accessibilityRole="link"
      onPress={() => router.push(href)}
    >
      <Card style={styles.consumerAgendaRow}>
        <View style={[styles.consumerAgendaIcon, { backgroundColor: background }]}>
          <Icon color={color} size={18} strokeWidth={2} />
        </View>
        <View style={styles.consumerAgendaCopy}>
          <Text style={[t.subhead, styles.consumerAgendaTitle, { color: c.label }]}>
            {label}
          </Text>
          <Text numberOfLines={1} style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>
            {value}
          </Text>
        </View>
        <ArrowRight color={c.tertiaryLabel} size={16} />
      </Card>
    </PressableScale>
  );
}

function ConsumerServiceLink({ entry }: { entry: HomeModuleEntry }) {
  const c = useTheme();
  const router = useRouter();
  const Icon = entry.icon;
  return (
    <PressSurface
      accessibilityLabel={`${entry.label}，${entry.status}`}
      accessibilityRole="link"
      onPress={() => router.push(entry.href)}
      pressedColor={c.fillStrong}
      style={[styles.consumerServiceLink, { backgroundColor: c.fill }]}
    >
      <View style={[styles.consumerServiceIcon, { backgroundColor: entry.background }]}>
        <Icon color={entry.color} size={18} strokeWidth={2} />
      </View>
      <View style={styles.consumerServiceCopy}>
        <Text style={[t.subhead, styles.consumerServiceTitle, { color: c.label }]}>
          {entry.label}
        </Text>
        <Text numberOfLines={1} style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>
          {entry.status}
        </Text>
      </View>
    </PressSurface>
  );
}

function ConsumerHome({
  avatarEmoji,
  memberName,
  menuItems,
  moduleEntries,
  pendingTasks,
  remindersLoading,
  shoppingPending,
  tasksLoading,
  menusLoading,
  unreadCount,
  upcomingReminder,
}: {
  avatarEmoji: string;
  memberName: string;
  menuItems: number;
  moduleEntries: HomeModuleEntry[];
  pendingTasks: number;
  remindersLoading: boolean;
  shoppingPending: number;
  tasksLoading: boolean;
  menusLoading: boolean;
  unreadCount: number;
  upcomingReminder: ReturnType<typeof useReminders>['data'] extends infer T
    ? T extends readonly (infer R)[]
      ? R | undefined
      : never
    : never;
}) {
  const c = useTheme();
  const router = useRouter();
  const attentionCount = pendingTasks + shoppingPending + (upcomingReminder ? 1 : 0);
  const quickEntries = moduleEntries.slice(0, 4);
  const serviceEntries = moduleEntries.slice(4);
  const loading = menusLoading || tasksLoading || remindersLoading;

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: c.bg }]}
      edges={['top']}
      testID="consumer-home"
    >
      <ScrollView showsVerticalScrollIndicator={false}>
        <PageContainer maxWidth={720} style={styles.consumerContent}>
          <View style={styles.consumerHeader}>
            <View style={[styles.consumerAvatar, { backgroundColor: c.orangeSoft }]}>
              <Text style={styles.consumerAvatarText}>{avatarEmoji}</Text>
            </View>
            <View style={styles.consumerHeaderCopy}>
              <Text style={[t.headline, { color: c.label }]}>{greeting()}，{memberName}</Text>
              <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>
                {fullDate()}
              </Text>
            </View>
            <View>
              <IconButton
                accessibilityLabel={`打开消息${unreadCount ? `，${unreadCount}条未读` : ''}`}
                backgroundColor="transparent"
                color={unreadCount ? c.tint : c.secondaryLabel}
                icon={Bell}
                onPress={() => router.push('/notifications')}
                testID="consumer-notification-button"
              />
              {unreadCount ? (
                <View style={[styles.bellBadge, { backgroundColor: c.red }]}>
                  <Text style={styles.bellBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                </View>
              ) : null}
            </View>
          </View>

          <View style={[styles.consumerHero, { backgroundColor: c.tintSoft }]}>
            <Text style={[t.footnote, styles.consumerEyebrow, { color: c.tint }]}>今天的家</Text>
            <Text style={[t.title1, styles.consumerHeroTitle, { color: c.label }]}>
              {attentionCount
                ? `有 ${attentionCount} 件事等你一起看看`
                : '今天家里节奏很轻松'}
            </Text>
            <Text style={[t.subhead, styles.consumerHeroSubtitle, { color: c.secondaryLabel }]}>
              {menuItems ? `已经安排 ${menuItems} 道菜，` : '今天还没有安排菜单，'}
              {shoppingPending ? `还有 ${shoppingPending} 样东西待买。` : '采购清单也已经清空。'}
            </Text>
            <View style={[styles.consumerMetrics, { borderTopColor: c.separator }]}>
              <PressSurface
                accessibilityLabel={`查看今日菜单，${menuItems}道菜`}
                accessibilityRole="link"
                onPress={() => router.push('/canteen')}
                style={styles.consumerMetric}
              >
                <CookingPot color={c.orange} size={18} />
                <Text style={[t.headline, { color: c.label, marginTop: 7 }]}>{menuItems}</Text>
                <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>今日菜品</Text>
              </PressSurface>
              <PressSurface
                accessibilityLabel={`查看家庭任务，${pendingTasks}项待办`}
                accessibilityRole="link"
                onPress={() => router.push('/tasks')}
                style={styles.consumerMetric}
              >
                <ListTodo color={c.tint} size={18} />
                <Text style={[t.headline, { color: c.label, marginTop: 7 }]}>{pendingTasks}</Text>
                <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>今日待办</Text>
              </PressSurface>
              <PressSurface
                accessibilityLabel={`查看采购清单，${shoppingPending}项待买`}
                accessibilityRole="link"
                onPress={() => router.push('/shopping')}
                style={styles.consumerMetric}
              >
                <ShoppingCart color={c.green} size={18} />
                <Text style={[t.headline, { color: c.label, marginTop: 7 }]}>{shoppingPending}</Text>
                <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>待买东西</Text>
              </PressSurface>
            </View>
          </View>

          <View style={styles.consumerSectionHeader}>
            <Text style={[t.title2, styles.consumerSectionTitle, { color: c.label }]}>常用</Text>
          </View>
          <View style={styles.consumerQuickGrid}>
            {quickEntries.map((entry) => <ConsumerQuickCard entry={entry} key={entry.label} />)}
          </View>

          <View style={styles.consumerSectionHeader}>
            <Text style={[t.title2, styles.consumerSectionTitle, { color: c.label }]}>接下来</Text>
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push('/calendar')}
              style={styles.textLink}
            >
              <Text style={[t.footnote, { color: c.tint, fontWeight: '600' }]}>看家庭日历</Text>
              <ArrowRight color={c.tint} size={15} />
            </Pressable>
          </View>
          {loading ? (
            <Card><SkeletonRows /></Card>
          ) : (
            <View style={styles.consumerAgenda}>
              <ConsumerAgendaRow
                background={c.orangeSoft}
                color={c.orange}
                href="/canteen"
                icon={CookingPot}
                label="今天吃什么"
                value={menuItems ? `${menuItems} 道菜已经安排好了` : '还没安排，去和家人一起选'}
              />
              <ConsumerAgendaRow
                background={c.tintSoft}
                color={c.tint}
                href="/tasks"
                icon={ListTodo}
                label="一起完成"
                value={pendingTasks ? `${pendingTasks} 项家庭任务待完成` : '今天没有待办'}
              />
              <ConsumerAgendaRow
                background={c.blueSoft}
                color={c.blue}
                href="/reminders"
                icon={BellRing}
                label="别忘了"
                value={upcomingReminder
                  ? `${reminderTime(upcomingReminder.remindAt)} · ${upcomingReminder.source?.title ?? '家庭事项'}`
                  : '暂时没有新的提醒'}
              />
            </View>
          )}

          <View style={styles.consumerSectionHeader}>
            <Text style={[t.title2, styles.consumerSectionTitle, { color: c.label }]}>更多家里服务</Text>
          </View>
          <View style={styles.consumerServiceGrid}>
            {serviceEntries.map((entry) => <ConsumerServiceLink entry={entry} key={entry.label} />)}
          </View>
        </PageContainer>
      </ScrollView>
    </SafeAreaView>
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
  const moduleEntries: HomeModuleEntry[] = [
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

  if (member?.role === 'member') {
    return (
      <ConsumerHome
        avatarEmoji={member.avatarEmoji}
        memberName={member.name}
        menuItems={menuItems}
        menusLoading={menusLoading}
        moduleEntries={moduleEntries}
        pendingTasks={pendingTasks.length}
        remindersLoading={remindersLoading}
        shoppingPending={shoppingPending}
        tasksLoading={tasksLoading}
        unreadCount={unreadCount}
        upcomingReminder={upcomingReminder}
      />
    );
  }

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
  consumerContent: { paddingTop: 14, paddingBottom: 56 },
  consumerHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 54,
  },
  consumerAvatar: {
    alignItems: 'center',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  consumerAvatarText: { fontSize: 25 },
  consumerHeaderCopy: { flex: 1, minWidth: 0 },
  consumerHero: {
    borderRadius: radius.md,
    marginTop: 20,
    overflow: 'hidden',
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  consumerEyebrow: { fontWeight: '700' },
  consumerHeroTitle: { lineHeight: 34, marginTop: 7 },
  consumerHeroSubtitle: { lineHeight: 23, marginTop: 8 },
  consumerMetrics: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    marginTop: 18,
    paddingVertical: 10,
  },
  consumerMetric: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 78,
  },
  consumerSectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginBottom: 11,
    marginTop: 28,
    minHeight: 38,
  },
  consumerSectionTitle: { fontWeight: '600' },
  consumerQuickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  consumerQuickCell: { flexGrow: 1, minWidth: 0, width: '47%' },
  consumerQuickCard: { minHeight: 132, padding: 16 },
  consumerQuickIcon: {
    alignItems: 'center',
    borderRadius: 21,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  consumerQuickTitle: { fontWeight: '600', marginTop: 13 },
  consumerAgenda: { gap: 9 },
  consumerAgendaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11,
    minHeight: 70,
    paddingHorizontal: 14,
  },
  consumerAgendaIcon: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  consumerAgendaCopy: { flex: 1, minWidth: 0 },
  consumerAgendaTitle: { fontWeight: '600' },
  consumerServiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  consumerServiceLink: {
    alignItems: 'center',
    borderRadius: radius.md,
    flexDirection: 'row',
    flexGrow: 1,
    gap: 10,
    minHeight: 68,
    paddingHorizontal: 12,
    width: '47%',
  },
  consumerServiceIcon: {
    alignItems: 'center',
    borderRadius: 17,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  consumerServiceCopy: { flex: 1, minWidth: 0 },
  consumerServiceTitle: { fontWeight: '600' },
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
