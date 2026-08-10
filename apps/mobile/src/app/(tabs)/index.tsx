import {
  ArrowRight,
  Bell,
  BellRing,
  BookOpenText,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  CookingPot,
  Film,
  Gift,
  Images,
  ListTodo,
  Plane,
  Plus,
  ShoppingCart,
  Sparkles,
  UsersRound,
  Vote,
  WalletCards,
  Wrench,
  type LucideIcon,
} from 'lucide-react-native';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageContainer, useDesktopLayout } from '../../components/app-shell';
import { QuickAddDialog } from '../../components/quick-add-dialog';
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
  useActivities,
  useAgentStatus,
  useFinanceSummary,
  useKnowledgeArticles,
  useMemories,
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
import { photoUri } from '../../lib/api';
import { useSession } from '../../lib/session';
import { radius, type as t, useTheme } from '../../lib/theme';
import type {
  FamilyMemory,
  HouseholdActivity,
} from '../../lib/types';

interface HomeModuleEntry {
  background: string;
  color: string;
  href: Href;
  icon: LucideIcon;
  label: string;
  status: string;
}

interface ConsumerFocusItem {
  background: string;
  badge?: string;
  color: string;
  href: Href;
  icon: LucideIcon;
  id: string;
  summary: string;
  title: string;
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

function currencyForHome(value: number) {
  return `¥${value.toLocaleString('zh-CN', {
    maximumFractionDigits: 0,
  })}`;
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

function ConsumerFocusRow({ item, last }: { item: ConsumerFocusItem; last: boolean }) {
  const c = useTheme();
  const router = useRouter();
  const Icon = item.icon;
  return (
    <PressSurface
      accessibilityLabel={`${item.title}，${item.summary}`}
      accessibilityRole="link"
      onPress={() => router.push(item.href)}
      pressedColor={c.fill}
      style={[
        styles.consumerFocusRow,
        !last && { borderBottomColor: c.separator, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <View style={[styles.consumerFocusIcon, { backgroundColor: item.background }]}>
        <Icon color={item.color} size={18} />
      </View>
      <View style={styles.consumerFocusCopy}>
        <View style={styles.consumerFocusTitleRow}>
          <Text numberOfLines={1} style={[t.subhead, styles.consumerFocusTitle, { color: c.label }]}>
            {item.title}
          </Text>
          {item.badge ? (
            <View style={[styles.consumerFocusBadge, { backgroundColor: item.background }]}>
              <Text style={[t.caption, { color: item.color, fontWeight: '700' }]}>{item.badge}</Text>
            </View>
          ) : null}
        </View>
        <Text numberOfLines={2} style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>
          {item.summary}
        </Text>
      </View>
      <ArrowRight color={c.tertiaryLabel} size={16} />
    </PressSurface>
  );
}

function ConsumerActivityRow({ activity }: { activity: HouseholdActivity }) {
  const c = useTheme();
  const router = useRouter();
  const content = (
    <View style={styles.consumerActivityRow}>
      <View style={[styles.consumerActivityAvatar, { backgroundColor: c.fill }]}>
        <Text style={styles.consumerActivityEmoji}>{activity.actor.avatarEmoji}</Text>
      </View>
      <View style={styles.consumerFocusCopy}>
        <Text numberOfLines={2} style={[t.subhead, { color: c.label, fontWeight: '600' }]}>
          {activity.summary}
        </Text>
        <Text style={[t.caption, { color: c.tertiaryLabel, marginTop: 4 }]}>
          {activity.actor.name} · {new Intl.DateTimeFormat('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(activity.occurredAt))}
        </Text>
      </View>
      {activity.targetPath ? <ArrowRight color={c.tertiaryLabel} size={16} /> : null}
    </View>
  );

  return activity.targetPath ? (
    <PressSurface
      accessibilityLabel={`打开家庭进展：${activity.summary}`}
      accessibilityRole="link"
      onPress={() => router.push(activity.targetPath as Href)}
      pressedColor={c.fill}
    >
      {content}
    </PressSurface>
  ) : content;
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
      testID={`consumer-quick-${String(entry.href).replaceAll('/', '')}`}
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

function ConsumerOverviewItem({
  color,
  href,
  icon: Icon,
  label,
  value,
}: {
  color: string;
  href: Href;
  icon: LucideIcon;
  label: string;
  value: number;
}) {
  const c = useTheme();
  const router = useRouter();
  return (
    <PressableScale
      accessibilityLabel={`${label}，${value}项`}
      accessibilityRole="link"
      onPress={() => router.push(href)}
      style={styles.consumerOverviewCell}
    >
      <Card style={styles.consumerOverviewCard}>
        <Icon color={color} size={18} />
        <Text style={[t.title2, { color: c.label, marginTop: 10 }]}>{value}</Text>
        <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>{label}</Text>
      </Card>
    </PressableScale>
  );
}

function RecentMemory({ memory }: { memory: FamilyMemory }) {
  const c = useTheme();
  const router = useRouter();
  const cover = memory.photos[0];
  return (
    <PressableScale
      accessibilityLabel={`打开回忆${memory.title}`}
      accessibilityRole="link"
      onPress={() => router.push(`/memories?memoryId=${memory.id}` as Href)}
    >
      <Card style={styles.consumerMemoryCard}>
        {cover ? (
          <Image
            accessibilityLabel={cover.caption || memory.title}
            contentFit="cover"
            source={{ uri: photoUri(cover.contentUrl)! }}
            style={styles.consumerMemoryImage}
          />
        ) : (
          <View style={[styles.consumerMemoryPlaceholder, { backgroundColor: c.accentSoft }]}>
            <Images color={c.accent} size={23} strokeWidth={1.8} />
          </View>
        )}
        <View style={styles.consumerMemoryCopy}>
          <Text numberOfLines={1} style={[t.headline, { color: c.label }]}>{memory.title}</Text>
          <Text numberOfLines={1} style={[t.footnote, { color: c.secondaryLabel, marginTop: 4 }]}>
            {formatMemoryDate(memory.happenedOn)} · {memory.createdBy.name}
          </Text>
        </View>
        <ArrowRight color={c.tertiaryLabel} size={16} />
      </Card>
    </PressableScale>
  );
}

function formatMemoryDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' })
    .format(new Date(year, month - 1, day, 12));
}

function ConsumerHome({
  actionItems,
  activeTrips,
  activities,
  avatarEmoji,
  memberName,
  menuItems,
  memories,
  memoriesLoading,
  moduleEntries,
  pendingTasks,
  dueMaintenance,
  remindersLoading,
  shoppingPending,
  tasksLoading,
  menusLoading,
  unreadCount,
  upcomingVisits,
  upcomingReminder,
  weekPendingTasks,
  waitingItems,
}: {
  actionItems: ConsumerFocusItem[];
  activeTrips: number;
  activities: HouseholdActivity[];
  avatarEmoji: string;
  memberName: string;
  menuItems: number;
  memories: FamilyMemory[];
  memoriesLoading: boolean;
  moduleEntries: HomeModuleEntry[];
  pendingTasks: number;
  dueMaintenance: number;
  remindersLoading: boolean;
  shoppingPending: number;
  tasksLoading: boolean;
  menusLoading: boolean;
  unreadCount: number;
  upcomingVisits: number;
  upcomingReminder: ReturnType<typeof useReminders>['data'] extends infer T
    ? T extends readonly (infer R)[]
      ? R | undefined
      : never
    : never;
  weekPendingTasks: number;
  waitingItems: ConsumerFocusItem[];
}) {
  const c = useTheme();
  const router = useRouter();
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const attentionCount = actionItems.length;
  const loading = menusLoading || tasksLoading || remindersLoading;
  const primaryModuleEntries = moduleEntries.filter((entry) =>
    ['/assistant', '/media', '/polls', '/shopping'].includes(String(entry.href)),
  );
  const secondaryModuleEntries = moduleEntries.filter(
    (entry) => !primaryModuleEntries.includes(entry),
  );

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
            <IconButton
              accessibilityLabel="快捷新增家庭事项"
              backgroundColor={c.tint}
              color="#FFFFFF"
              haptic
              icon={Plus}
              onPress={() => setQuickAddOpen(true)}
              testID="consumer-quick-add-button"
            />
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
            <Text style={[t.footnote, styles.consumerEyebrow, { color: c.tint }]}>今日家庭工作台</Text>
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
            <Text style={[t.title2, styles.consumerSectionTitle, { color: c.label }]}>需要我处理</Text>
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push('/notifications')}
              style={styles.textLink}
            >
              <Text style={[t.footnote, { color: c.tint, fontWeight: '600' }]}>家庭收件箱</Text>
              <ArrowRight color={c.tint} size={15} />
            </Pressable>
          </View>
          <Card style={styles.consumerFocusCard}>
            {actionItems.length ? actionItems.slice(0, 3).map((item, index) => (
              <ConsumerFocusRow
                item={item}
                key={item.id}
                last={index === Math.min(actionItems.length, 3) - 1}
              />
            )) : (
              <View style={styles.consumerCalmState}>
                <View style={[styles.consumerFocusIcon, { backgroundColor: c.greenSoft }]}>
                  <CheckCircle2 color={c.green} size={19} />
                </View>
                <View style={styles.consumerFocusCopy}>
                  <Text style={[t.headline, { color: c.label }]}>现在没有需要你处理的事</Text>
                  <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>新的任务和投票会出现在这里</Text>
                </View>
              </View>
            )}
          </Card>

          <View style={styles.consumerSectionHeader}>
            <Text style={[t.title2, styles.consumerSectionTitle, { color: c.label }]}>常用功能</Text>
          </View>
          <View style={styles.consumerServiceGrid} testID="consumer-primary-services">
            {primaryModuleEntries.map((entry) => (
              <ConsumerServiceLink entry={entry} key={entry.label} />
            ))}
          </View>

          <PressableScale
            accessibilityLabel={`${detailsOpen ? '收起' : '展开'}更多家庭内容`}
            accessibilityState={{ expanded: detailsOpen }}
            ariaExpanded={detailsOpen}
            haptic={false}
            onPress={() => setDetailsOpen((current) => !current)}
            style={[
              styles.consumerDisclosure,
              { backgroundColor: c.fill, borderColor: c.separator },
            ]}
            testID="consumer-more-disclosure"
          >
            <View style={styles.consumerDisclosureCopy}>
              <Text style={[t.headline, { color: c.label }]}>更多家庭内容</Text>
              <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>
                本周概览、家庭动态与其他功能
              </Text>
            </View>
            <ChevronDown
              color={c.secondaryLabel}
              size={20}
              style={{ transform: [{ rotate: detailsOpen ? '180deg' : '0deg' }] }}
            />
          </PressableScale>

          {detailsOpen ? (
            <View testID="consumer-more-content">
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

          {waitingItems.length ? (
            <>
              <View style={styles.consumerSectionHeader}>
                <Text style={[t.title2, styles.consumerSectionTitle, { color: c.label }]}>等待家人</Text>
              </View>
              <Card style={styles.consumerFocusCard}>
                {waitingItems.map((item, index) => (
              <ConsumerFocusRow item={item} key={item.id} last={index === waitingItems.length - 1} />
                ))}
              </Card>
            </>
          ) : null}

          {activities.length ? (
            <>
              <View style={styles.consumerSectionHeader}>
                <Text style={[t.title2, styles.consumerSectionTitle, { color: c.label }]}>家里刚刚完成</Text>
                <Pressable
                  accessibilityRole="link"
                  onPress={() => router.push('/activity')}
                  style={styles.textLink}
                >
                  <Text style={[t.footnote, { color: c.tint, fontWeight: '600' }]}>全部进展</Text>
                  <ArrowRight color={c.tint} size={15} />
                </Pressable>
              </View>
              <Card style={styles.consumerActivityCard}>
                {activities.map((activity) => (
                  <ConsumerActivityRow activity={activity} key={activity.id} />
                ))}
              </Card>
            </>
          ) : null}

          <View style={styles.consumerSectionHeader}>
            <Text style={[t.title2, styles.consumerSectionTitle, { color: c.label }]}>本周概览</Text>
          </View>
          <View style={styles.consumerOverviewGrid} testID="consumer-week-overview">
            <ConsumerOverviewItem color={c.tint} href="/tasks" icon={ListTodo} label="本周待办" value={weekPendingTasks} />
            <ConsumerOverviewItem color={c.blue} href="/guests" icon={UsersRound} label="待来访" value={upcomingVisits} />
            <ConsumerOverviewItem color={c.orange} href="/home-assets" icon={Wrench} label="近期维护" value={dueMaintenance} />
            <ConsumerOverviewItem color={c.accent} href="/travel" icon={Plane} label="计划行程" value={activeTrips} />
          </View>

          <View style={styles.consumerSectionHeader}>
            <Text style={[t.title2, styles.consumerSectionTitle, { color: c.label }]}>最近回忆</Text>
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push('/memories')}
              style={styles.textLink}
            >
              <Text style={[t.footnote, { color: c.tint, fontWeight: '600' }]}>全部回忆</Text>
              <ArrowRight color={c.tint} size={15} />
            </Pressable>
          </View>
          {memoriesLoading ? (
            <Card><SkeletonRows /></Card>
          ) : memories.length ? (
            <View style={styles.consumerMemories} testID="consumer-recent-memories">
              {memories.slice(0, 2).map((memory) => <RecentMemory key={memory.id} memory={memory} />)}
            </View>
          ) : (
            <PressableScale
              accessibilityLabel="记录第一条家庭回忆"
              accessibilityRole="link"
              onPress={() => router.push('/memories')}
            >
              <Card style={styles.consumerMemoryEmpty}>
                <View style={[styles.consumerMemoryPlaceholder, { backgroundColor: c.accentSoft }]}>
                  <Images color={c.accent} size={23} />
                </View>
                <View style={styles.consumerMemoryCopy}>
                  <Text style={[t.headline, { color: c.label }]}>记录第一条家庭回忆</Text>
                  <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 4 }]}>把一顿饭、一次出行或平常的一天留下来</Text>
                </View>
                <ArrowRight color={c.tertiaryLabel} size={16} />
              </Card>
            </PressableScale>
          )}

          <View style={styles.consumerSectionHeader}>
            <Text style={[t.title2, styles.consumerSectionTitle, { color: c.label }]}>其他功能</Text>
          </View>
          <View style={styles.consumerServiceGrid}>
            {secondaryModuleEntries.map((entry) => (
              <ConsumerServiceLink entry={entry} key={entry.label} />
            ))}
          </View>
            </View>
          ) : null}
        </PageContainer>
      </ScrollView>
      <QuickAddDialog onClose={() => setQuickAddOpen(false)} visible={quickAddOpen} />
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
  const { data: activities } = useActivities();
  const { data: shopping } = useShoppingList(today);
  const { data: tasks, isLoading: tasksLoading } = useTasks(today, today);
  const { data: weekTasks } = useTasks(today, todayStr(6));
  const { data: notifications } = useNotifications();
  const { data: polls } = usePolls();
  const { data: media } = useMedia('all');
  const { data: reminders, isLoading: remindersLoading } = useReminders('scheduled');
  const { data: visits } = useVisits('scheduled');
  const { data: assets } = useAssets('active');
  const { data: pointsAccounts } = usePointsAccounts();
  const { data: knowledgeArticles } = useKnowledgeArticles('active');
  const { data: travelPlans } = useTravelPlans('active');
  const { data: memories, isLoading: memoriesLoading } = useMemories('active', 'all', '', 3);
  const { data: agentStatus } = useAgentStatus();
  const { data: financeSummary } = useFinanceSummary(today.slice(0, 7));

  const menuItems =
    menus?.reduce(
      (sum, menu) => sum + menu.items.filter((item) => item.status !== 'rejected').length,
      0,
    ) ?? 0;
  const shoppingPending = shopping?.filter((item) => !item.checked).length ?? 0;
  const pendingTasks = tasks?.filter((entry) => entry.status === 'pending') ?? [];
  const weekPendingTasks = weekTasks?.filter((entry) => entry.status === 'pending').length ?? 0;
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
  const actionItems: ConsumerFocusItem[] = [
    ...pendingTasks
      .filter((entry) => entry.canUpdate && (entry.assigneeId == null || entry.assigneeId === member?.id))
      .slice(0, 3)
      .map((entry): ConsumerFocusItem => ({
        background: c.tintSoft,
        badge: entry.assigneeId ? '交给我' : '待认领',
        color: c.tint,
        href: `/tasks?date=${entry.dueDate}&taskId=${entry.taskId}` as Href,
        icon: ListTodo,
        id: `task:${entry.id}`,
        summary: entry.task.note || '今天完成后记得在任务中确认',
        title: entry.task.title,
      })),
    ...openPolls
      .filter((poll) => poll.canVote && poll.selectedOptionIds.length === 0)
      .slice(0, 2)
      .map((poll): ConsumerFocusItem => ({
        background: c.accentSoft,
        badge: '待投票',
        color: c.accent,
        href: `/polls?pollId=${poll.id}` as Href,
        icon: Vote,
        id: `poll:${poll.id}`,
        summary: poll.description || `${poll.options.length} 个选项等你选择`,
        title: poll.title,
      })),
    ...(shoppingPending ? [{
      background: c.greenSoft,
      badge: `${shoppingPending} 项`,
      color: c.green,
      href: '/shopping' as Href,
      icon: ShoppingCart,
      id: 'shopping:today',
      summary: '采购完成后可以确认入库',
      title: '今天的购物清单',
    }] : []),
  ].slice(0, 5);
  const waitingItems: ConsumerFocusItem[] = [
    ...pendingTasks
      .filter((entry) => entry.assigneeId != null && entry.assigneeId !== member?.id)
      .slice(0, 2)
      .map((entry): ConsumerFocusItem => ({
        background: c.blueSoft,
        badge: entry.assignee?.name ?? '家人',
        color: c.blue,
        href: `/tasks?date=${entry.dueDate}&taskId=${entry.taskId}` as Href,
        icon: Clock3,
        id: `waiting-task:${entry.id}`,
        summary: `已交给${entry.assignee?.name ?? '家人'}处理`,
        title: entry.task.title,
      })),
    ...openPolls
      .filter((poll) => poll.selectedOptionIds.length > 0)
      .slice(0, 2)
      .map((poll): ConsumerFocusItem => ({
        background: c.orangeSoft,
        badge: `${poll.totalVoters} 人已投`,
        color: c.orange,
        href: `/polls?pollId=${poll.id}` as Href,
        icon: Vote,
        id: `waiting-poll:${poll.id}`,
        summary: '你已经投票，等待其他家人一起决定',
        title: poll.title,
      })),
  ].slice(0, 4);
  const moduleEntries: HomeModuleEntry[] = [
    {
      background: c.tintSoft,
      color: c.tint,
      href: '/assistant',
      icon: Sparkles,
      label: '问问小管家',
      status: agentStatus?.enabled
        ? agentStatus.selected.available
          ? '可以问问家里的安排'
          : '本地摘要可用'
        : '尚未启用',
    },
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
      background: c.blueSoft,
      color: c.blue,
      href: '/finance',
      icon: WalletCards,
      label: '家庭财务',
      status: financeSummary?.accounts.length
        ? `本月支出 ${currencyForHome(financeSummary.expense)}`
        : '建立家庭共享账本',
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
    {
      background: c.accentSoft,
      color: c.accent,
      href: '/memories',
      icon: Images,
      label: '家庭回忆',
      status: `${memories?.length ?? 0} 条珍藏`,
    },
  ];

  if (member?.role === 'member') {
    return (
      <ConsumerHome
        actionItems={actionItems}
        activeTrips={travelPlans?.length ?? 0}
        activities={(activities ?? []).slice(0, 4)}
        avatarEmoji={member.avatarEmoji}
        memberName={member.name}
        menuItems={menuItems}
        memories={memories ?? []}
        memoriesLoading={memoriesLoading}
        menusLoading={menusLoading}
        moduleEntries={moduleEntries}
        pendingTasks={pendingTasks.length}
        dueMaintenance={dueMaintenance}
        remindersLoading={remindersLoading}
        shoppingPending={shoppingPending}
        tasksLoading={tasksLoading}
        unreadCount={unreadCount}
        upcomingVisits={upcomingVisits}
        upcomingReminder={upcomingReminder}
        weekPendingTasks={weekPendingTasks}
        waitingItems={waitingItems}
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
  consumerContent: { paddingTop: 14, paddingBottom: 104 },
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
  consumerFocusCard: { overflow: 'hidden' },
  consumerFocusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11,
    minHeight: 74,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  consumerFocusIcon: {
    alignItems: 'center',
    borderRadius: 19,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  consumerFocusCopy: { flex: 1, minWidth: 0 },
  consumerFocusTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  consumerFocusTitle: { flex: 1, fontWeight: '700' },
  consumerFocusBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  consumerCalmState: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11,
    minHeight: 78,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  consumerActivityCard: { gap: 2, overflow: 'hidden', paddingVertical: 4 },
  consumerActivityRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11,
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  consumerActivityAvatar: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  consumerActivityEmoji: { fontSize: 18 },
  consumerOverviewGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  consumerOverviewCell: { flexGrow: 1, minWidth: 0, width: '47%' },
  consumerOverviewCard: { minHeight: 112, padding: 15 },
  consumerMemories: { gap: 9 },
  consumerMemoryCard: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 82, overflow: 'hidden', paddingRight: 14 },
  consumerMemoryEmpty: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 92, padding: 14 },
  consumerMemoryImage: { height: 82, width: 92 },
  consumerMemoryPlaceholder: { alignItems: 'center', borderRadius: radius.sm, height: 54, justifyContent: 'center', width: 54 },
  consumerMemoryCopy: { flex: 1, minWidth: 0 },
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
  consumerDisclosure: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    marginTop: 18,
    minHeight: 68,
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  consumerDisclosureCopy: { flex: 1, minWidth: 0 },
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
