import {
  ArrowRight,
  Bell,
  BellRing,
  BookOpenText,
  CheckCircle2,
  Clock3,
  CookingPot,
  Film,
  ListTodo,
  ShoppingCart,
  UtensilsCrossed,
  Vote,
  type LucideIcon,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
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
import { mealLabel, todayStr } from '../../lib/date';
import {
  useDishes,
  useMenusOfDate,
  useNotifications,
  usePolls,
  useReminders,
  useShoppingList,
  useTasks,
} from '../../lib/queries';
import { useSession } from '../../lib/session';
import { CATEGORY_EMOJI, Palette, radius, type as t, useTheme } from '../../lib/theme';
import type { MealType, Menu } from '../../lib/types';

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

function MetricCard({
  icon: Icon,
  iconColor,
  iconBackground,
  value,
  label,
}: {
  icon: LucideIcon;
  iconColor: string;
  iconBackground: string;
  value: number;
  label: string;
}) {
  const c = useTheme();
  return (
    <Card style={styles.metricCard}>
      <View style={[styles.metricIcon, { backgroundColor: iconBackground }]}>
        <Icon size={19} color={iconColor} />
      </View>
      <Text style={[styles.metricValue, { color: c.label }]}>{value}</Text>
      <Text style={[t.footnote, { color: c.secondaryLabel }]} numberOfLines={1}>
        {label}
      </Text>
    </Card>
  );
}

function MealSection({
  mealType,
  menu,
  palette,
}: {
  mealType: MealType;
  menu?: Menu;
  palette: Palette;
}) {
  const label = mealLabel(mealType);
  const activeItems = menu?.items.filter((item) => item.status !== 'rejected') ?? [];

  return (
    <View style={styles.mealSection}>
      <View style={styles.mealHeading}>
        <Text style={[t.subhead, { color: palette.label, fontWeight: '700' }]}>{label}</Text>
        <Text style={[t.caption, { color: palette.secondaryLabel }]}>
          {activeItems.length ? `${activeItems.length} 道` : '待安排'}
        </Text>
      </View>
      {activeItems.length ? (
        activeItems.slice(0, 4).map((item) => (
          <View key={item.id} style={styles.mealItem}>
            <Text style={styles.mealEmoji}>
              {CATEGORY_EMOJI[item.dish.category] ?? '🍽️'}
            </Text>
            <Text style={[t.subhead, { color: palette.label, flex: 1 }]} numberOfLines={1}>
              {item.dish.name}
            </Text>
            <Text style={[t.caption, { color: palette.secondaryLabel }]}>
              {item.status === 'done' ? '已上桌' : item.status === 'cooking' ? '制作中' : '已点'}
            </Text>
          </View>
        ))
      ) : (
        <View style={[styles.emptyMeal, { backgroundColor: palette.fill }]}>
          <Clock3 color={palette.tertiaryLabel} size={17} />
          <Text style={[t.footnote, { color: palette.secondaryLabel }]}>还没有点菜</Text>
        </View>
      )}
    </View>
  );
}

export default function HomeScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const { member } = useSession();
  const date = todayStr();
  const { data: menus, isLoading: menusLoading } = useMenusOfDate(date);
  const { data: shopping, isLoading: shoppingLoading } = useShoppingList(date);
  const { data: dishes } = useDishes();
  const { data: tasks, isLoading: tasksLoading } = useTasks(date, date);
  const { data: notifications } = useNotifications();
  const { data: polls, isLoading: pollsLoading } = usePolls();
  const { data: reminders, isLoading: remindersLoading } = useReminders('scheduled');

  const menuItems =
    menus?.reduce(
      (total, menu) => total + menu.items.filter((item) => item.status !== 'rejected').length,
      0,
    ) ?? 0;
  const shoppingTotal = shopping?.length ?? 0;
  const shoppingDone = shopping?.filter((item) => item.checked).length ?? 0;
  const shoppingPending = shoppingTotal - shoppingDone;
  const progress = shoppingTotal ? shoppingDone / shoppingTotal : 0;
  const breakfast = menus?.find((menu) => menu.mealType === 'breakfast');
  const lunch = menus?.find((menu) => menu.mealType === 'lunch');
  const dinner = menus?.find((menu) => menu.mealType === 'dinner');
  const pendingTasks = tasks?.filter((entry) => entry.status === 'pending') ?? [];
  const unreadCount = notifications?.length ?? 0;
  const openPolls = polls?.filter((poll) => poll.status === 'open') ?? [];
  const upcomingReminders = reminders ?? [];

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <PageContainer style={[styles.content, desktop && styles.contentDesktop]}>
          <View style={[styles.hero, desktop && styles.heroDesktop]}>
            <View style={{ flex: 1 }}>
              <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>家庭今日概览</Text>
              <Text style={[t.largeTitle, { color: c.label, marginTop: 6 }]}>
                {greeting()}，{member?.name}
              </Text>
              <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 6 }]}>{fullDate()}</Text>
            </View>
            <View style={styles.heroActions}>
              <Pressable
                accessibilityLabel={`打开通知中心${unreadCount ? `，${unreadCount}条未读` : ''}`}
                accessibilityRole="button"
                onPress={() => router.push('/notifications')}
                style={({ pressed }) => [
                  styles.bellButton,
                  {
                    backgroundColor: pressed ? c.fillStrong : c.card,
                    borderColor: c.separator,
                  },
                ]}
              >
                <Bell color={unreadCount ? c.tint : c.secondaryLabel} size={19} />
                {unreadCount ? (
                  <View style={[styles.bellBadge, { backgroundColor: c.red }]}>
                    <Text style={styles.bellBadgeText}>
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
              <Pressable
                onPress={() => router.push('/order')}
                style={({ pressed }) => [
                  styles.orderButton,
                  { backgroundColor: pressed ? c.cardPressed : c.tint },
                ]}
              >
                <UtensilsCrossed color="#FFFFFF" size={18} />
                <Text style={[t.subhead, { color: '#FFFFFF', fontWeight: '700' }]}>开始点菜</Text>
                <ArrowRight color="#FFFFFF" size={17} />
              </Pressable>
            </View>
          </View>

          <View style={styles.metrics}>
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push('/kitchen')}
              style={[styles.metricLink, desktop && styles.metricLinkDesktop]}
            >
              <MetricCard
                icon={CookingPot}
                iconColor={c.tint}
                iconBackground={c.tintSoft}
                value={menuItems}
                label="今日菜品"
              />
            </Pressable>
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push('/tasks')}
              style={[styles.metricLink, desktop && styles.metricLinkDesktop]}
            >
              <MetricCard
                icon={ListTodo}
                iconColor={c.blue}
                iconBackground={c.blueSoft}
                value={pendingTasks.length}
                label="今日待办"
              />
            </Pressable>
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push('/shopping')}
              style={[styles.metricLink, desktop && styles.metricLinkDesktop]}
            >
              <MetricCard
                icon={ShoppingCart}
                iconColor={c.orange}
                iconBackground={c.orangeSoft}
                value={shoppingPending}
                label="待购物"
              />
            </Pressable>
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push('/recipes')}
              style={[styles.metricLink, desktop && styles.metricLinkDesktop]}
            >
              <MetricCard
                icon={BookOpenText}
                iconColor={c.accent}
                iconBackground={c.accentSoft}
                value={dishes?.length ?? 0}
                label="家庭菜谱"
              />
            </Pressable>
          </View>

          <Pressable
            accessibilityRole="link"
            onPress={() => router.push('/media')}
            style={({ pressed }) => [
              styles.mediaShortcut,
              {
                backgroundColor: pressed ? c.cardPressed : c.card,
                borderColor: c.separator,
              },
            ]}
          >
            <View style={[styles.mediaShortcutIcon, { backgroundColor: c.accentSoft }]}>
              <Film color={c.accent} size={22} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.headline, { color: c.label }]}>家庭观影</Text>
              <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 2 }]}>片单、排期与观看进度</Text>
            </View>
            <ArrowRight color={c.tertiaryLabel} size={18} />
          </Pressable>

          <View style={styles.tasksSection}>
            <View style={styles.sectionTitleRow}>
              <View>
                <Text style={[t.title2, { color: c.label }]}>今天的任务</Text>
                <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>家务、维护和家庭准备</Text>
              </View>
              <Pressable
                accessibilityRole="link"
                onPress={() => router.push('/tasks')}
                style={styles.textLink}
              >
                <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]}>查看任务</Text>
                <ArrowRight color={c.tint} size={16} />
              </Pressable>
            </View>
            <Card style={styles.tasksCard}>
              {tasksLoading ? (
                <ActivityIndicator color={c.tint} style={styles.taskLoader} />
              ) : pendingTasks.length ? (
                pendingTasks.slice(0, 4).map((entry) => (
                  <Pressable
                    accessibilityRole="link"
                    key={entry.id}
                    onPress={() =>
                      router.push({
                        pathname: '/tasks',
                        params: { date: entry.dueDate, taskId: entry.taskId },
                      })
                    }
                    style={({ pressed }) => [
                      styles.taskSummaryRow,
                      { borderBottomColor: c.separator },
                      pressed && { backgroundColor: c.fill },
                    ]}
                  >
                    <CheckCircle2 color={c.tint} size={19} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        numberOfLines={1}
                        style={[t.subhead, { color: c.label, fontWeight: '600' }]}
                      >
                        {entry.task.title}
                      </Text>
                      <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>
                        {entry.assignee?.name ?? '全家可做'}
                      </Text>
                    </View>
                    <ArrowRight color={c.tertiaryLabel} size={16} />
                  </Pressable>
                ))
              ) : (
                <View style={styles.emptyTasks}>
                  <CheckCircle2 color={c.tint} size={24} />
                  <Text style={[t.subhead, { color: c.secondaryLabel }]}>今天没有待办任务</Text>
                </View>
              )}
            </Card>
          </View>

          <View style={styles.remindersSection}>
            <View style={styles.sectionTitleRow}>
              <View>
                <Text style={[t.title2, { color: c.label }]}>近期提醒</Text>
                <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>菜单、任务、日程与家庭决定</Text>
              </View>
              <Pressable
                accessibilityRole="link"
                onPress={() => router.push('/reminders')}
                style={styles.textLink}
              >
                <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]}>提醒中心</Text>
                <ArrowRight color={c.tint} size={16} />
              </Pressable>
            </View>
            <Card style={styles.remindersCard}>
              {remindersLoading ? (
                <ActivityIndicator color={c.tint} style={styles.taskLoader} />
              ) : upcomingReminders.length ? (
                upcomingReminders.slice(0, 3).map((reminder) => (
                  <Pressable
                    accessibilityRole="link"
                    key={reminder.id}
                    onPress={() =>
                      router.push({
                        pathname: '/reminders',
                        params: { reminderId: reminder.id },
                      })
                    }
                    style={({ pressed }) => [
                      styles.reminderSummaryRow,
                      { borderBottomColor: c.separator },
                      pressed && { backgroundColor: c.fill },
                    ]}
                  >
                    <View style={[styles.reminderSummaryIcon, { backgroundColor: c.tintSoft }]}>
                      <BellRing color={c.tint} size={18} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={[t.subhead, { color: c.label, fontWeight: '600' }]}>
                        {reminder.source?.title ?? '原事项已不可用'}
                      </Text>
                      <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>
                        {reminderTime(reminder.remindAt)} · {reminder.recipients.map((recipient) => recipient.member.name).join('、')}
                      </Text>
                    </View>
                    <ArrowRight color={c.tertiaryLabel} size={16} />
                  </Pressable>
                ))
              ) : (
                <Pressable
                  accessibilityRole="link"
                  onPress={() => router.push('/reminders')}
                  style={styles.emptyTasks}
                >
                  <BellRing color={c.tint} size={24} />
                  <Text style={[t.subhead, { color: c.secondaryLabel }]}>还没有待发送提醒</Text>
                </Pressable>
              )}
            </Card>
          </View>

          <View style={styles.pollsSection}>
            <View style={styles.sectionTitleRow}>
              <View>
                <Text style={[t.title2, { color: c.label }]}>家庭投票</Text>
                <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>一起决定家庭安排</Text>
              </View>
              <Pressable
                accessibilityRole="link"
                onPress={() => router.push('/polls')}
                style={styles.textLink}
              >
                <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]}>查看投票</Text>
                <ArrowRight color={c.tint} size={16} />
              </Pressable>
            </View>
            <Card style={styles.pollsCard}>
              {pollsLoading ? (
                <ActivityIndicator color={c.tint} style={styles.taskLoader} />
              ) : openPolls.length ? (
                openPolls.slice(0, 3).map((poll) => (
                  <Pressable
                    accessibilityRole="link"
                    key={poll.id}
                    onPress={() =>
                      router.push({ pathname: '/polls', params: { pollId: poll.id } })
                    }
                    style={({ pressed }) => [
                      styles.pollSummaryRow,
                      { borderBottomColor: c.separator },
                      pressed && { backgroundColor: c.fill },
                    ]}
                  >
                    <View style={[styles.pollSummaryIcon, { backgroundColor: c.accentSoft }]}>
                      <Vote color={c.accent} size={18} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        numberOfLines={1}
                        style={[t.subhead, { color: c.label, fontWeight: '600' }]}
                      >
                        {poll.title}
                      </Text>
                      <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>
                        {poll.totalVoters} 人参与 · {poll.voteMode === 'single' ? '单选' : '多选'}
                      </Text>
                    </View>
                    <ArrowRight color={c.tertiaryLabel} size={16} />
                  </Pressable>
                ))
              ) : (
                <View style={styles.emptyTasks}>
                  <Vote color={c.accent} size={24} />
                  <Text style={[t.subhead, { color: c.secondaryLabel }]}>暂无进行中的投票</Text>
                </View>
              )}
            </Card>
          </View>

          <View style={[styles.mainGrid, desktop && styles.mainGridDesktop]}>
            <View style={styles.menuColumn}>
              <View style={styles.sectionTitleRow}>
                <View>
                  <Text style={[t.title2, { color: c.label }]}>今天吃什么</Text>
                  <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>早餐、午餐和晚餐安排</Text>
                </View>
                <Pressable onPress={() => router.push('/kitchen')} style={styles.textLink}>
                  <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]}>查看菜单</Text>
                  <ArrowRight color={c.tint} size={16} />
                </Pressable>
              </View>
              <Card style={styles.menuCard}>
                {menusLoading ? (
                  <ActivityIndicator color={c.tint} style={styles.loader} />
                ) : (
                  <View style={[styles.meals, desktop && styles.mealsDesktop]}>
                    <MealSection mealType="breakfast" menu={breakfast} palette={c} />
                    <View
                      style={[
                        desktop ? styles.mealDividerDesktop : styles.mealDivider,
                        { backgroundColor: c.separator },
                      ]}
                    />
                    <MealSection mealType="lunch" menu={lunch} palette={c} />
                    <View
                      style={[
                        desktop ? styles.mealDividerDesktop : styles.mealDivider,
                        { backgroundColor: c.separator },
                      ]}
                    />
                    <MealSection mealType="dinner" menu={dinner} palette={c} />
                  </View>
                )}
              </Card>
            </View>

            <View style={styles.shoppingColumn}>
              <View style={styles.sectionTitleRow}>
                <View>
                  <Text style={[t.title2, { color: c.label }]}>购物进度</Text>
                  <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>今天的采购清单</Text>
                </View>
                <Pressable onPress={() => router.push('/shopping')} style={styles.textLink}>
                  <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]}>去购物</Text>
                  <ArrowRight color={c.tint} size={16} />
                </Pressable>
              </View>
              <Card style={styles.shoppingCard}>
                {shoppingLoading ? (
                  <ActivityIndicator color={c.tint} style={styles.loader} />
                ) : (
                  <>
                    <View style={styles.shoppingSummary}>
                      <View style={[styles.shoppingIcon, { backgroundColor: c.orangeSoft }]}>
                        <ShoppingCart color={c.orange} size={24} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[t.title1, { color: c.label }]}>
                          {shoppingDone}/{shoppingTotal}
                        </Text>
                        <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 2 }]}>已完成</Text>
                      </View>
                    </View>
                    <View style={[styles.progressTrack, { backgroundColor: c.fill }]}>
                      <View
                        style={[
                          styles.progressValue,
                          { backgroundColor: c.orange, width: `${Math.round(progress * 100)}%` },
                        ]}
                      />
                    </View>
                    <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 16 }]}>
                      {shoppingTotal
                        ? shoppingPending
                          ? `还有 ${shoppingPending} 项需要购买`
                          : '今天的采购已经完成'
                        : '今天还没有购物项目'}
                    </Text>
                  </>
                )}
              </Card>
            </View>
          </View>
        </PageContainer>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingTop: 18, paddingBottom: 40 },
  contentDesktop: { paddingTop: 32 },
  hero: { gap: 18 },
  heroDesktop: { flexDirection: 'row', alignItems: 'center' },
  heroActions: { flexDirection: 'row', alignItems: 'center', gap: 9 },
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
  orderButton: {
    height: 44,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 24 },
  metricCard: { flex: 1, minWidth: 0, minHeight: 110, padding: 14 },
  metricLink: { flexGrow: 1, flexBasis: '46%', minWidth: 0 },
  metricLinkDesktop: { flexBasis: '22%' },
  metricIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricValue: { fontSize: 25, fontWeight: '700', marginTop: 12 },
  mediaShortcut: {
    minHeight: 72,
    marginTop: 18,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  mediaShortcutIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainGrid: { gap: 24, marginTop: 32 },
  mainGridDesktop: { flexDirection: 'row', alignItems: 'stretch' },
  menuColumn: { flex: 1.65, minWidth: 0 },
  shoppingColumn: { flex: 1, minWidth: 0 },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  tasksSection: { marginTop: 30 },
  pollsSection: { marginTop: 30 },
  tasksCard: { overflow: 'hidden', minHeight: 76 },
  remindersCard: { overflow: 'hidden', minHeight: 76 },
  pollsCard: { overflow: 'hidden', minHeight: 76 },
  remindersSection: { marginTop: 28 },
  reminderSummaryRow: {
    minHeight: 66,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  reminderSummaryIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskLoader: { marginVertical: 24 },
  taskSummaryRow: {
    minHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  emptyTasks: {
    minHeight: 78,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  pollSummaryRow: {
    minHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pollSummaryIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textLink: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  menuCard: { minHeight: 230, padding: 18 },
  meals: { gap: 14 },
  mealsDesktop: { flexDirection: 'row', gap: 18 },
  mealSection: { flex: 1, minWidth: 0 },
  mealHeading: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  mealItem: { height: 38, flexDirection: 'row', alignItems: 'center', gap: 8 },
  mealEmoji: { fontSize: 20 },
  emptyMeal: {
    minHeight: 96,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  mealDivider: { height: 1 },
  mealDividerDesktop: { width: 1 },
  shoppingCard: { minHeight: 230, padding: 20 },
  shoppingSummary: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  shoppingIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: { height: 7, borderRadius: 4, overflow: 'hidden', marginTop: 28 },
  progressValue: { height: '100%', borderRadius: 4 },
  loader: { marginVertical: 72 },
});
