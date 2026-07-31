import { useRouter } from 'expo-router';
import {
  Bell,
  BellRing,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronRight,
  Clapperboard,
  CookingPot,
  ListTodo,
  UsersRound,
  Vote,
} from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageContainer, useDesktopLayout } from '../../components/app-shell';
import { Card, EmptyState, Segmented } from '../../components/ui';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from '../../lib/queries';
import { radius, type as t, useTheme } from '../../lib/theme';
import type { AppNotification, NotificationModule } from '../../lib/types';

type NotificationFilter = 'unread' | 'all';

const MODULE_LABELS: Record<NotificationModule, string> = {
  menu: '菜单',
  task: '任务',
  poll: '投票',
  calendar: '日历',
  reminder: '提醒',
  media: '观影',
  guest: '访客',
  system: '系统',
};

function notificationTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function NotificationIcon({ module }: { module: NotificationModule }) {
  const c = useTheme();
  const props = { size: 18, color: c.tint };
  if (module === 'menu') return <CookingPot {...props} color={c.orange} />;
  if (module === 'task') return <ListTodo {...props} color={c.blue} />;
  if (module === 'poll') return <Vote {...props} color={c.accent} />;
  if (module === 'calendar') return <CalendarDays {...props} />;
  if (module === 'reminder') return <BellRing {...props} />;
  if (module === 'media') return <Clapperboard {...props} color={c.green} />;
  if (module === 'guest') return <UsersRound {...props} color={c.blue} />;
  return <Bell {...props} />;
}

function NotificationRow({
  notification,
  onOpen,
  onRead,
}: {
  notification: AppNotification;
  onOpen: () => void;
  onRead: () => void;
}) {
  const c = useTheme();
  const unread = !notification.readAt;
  const iconBackground =
    notification.module === 'menu'
      ? c.orangeSoft
      : notification.module === 'task'
        ? c.blueSoft
        : notification.module === 'poll'
          ? c.accentSoft
          : notification.module === 'media'
            ? c.greenSoft
            : notification.module === 'guest'
              ? c.blueSoft
        : c.tintSoft;
  return (
    <View
      style={[
        styles.notificationRow,
        { borderBottomColor: c.separator },
        unread && { backgroundColor: c.tintSoft },
      ]}
    >
      <Pressable
        accessibilityLabel={`打开${notification.title}`}
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => [styles.notificationOpen, pressed && { opacity: 0.72 }]}
      >
        <View style={[styles.notificationIcon, { backgroundColor: iconBackground }]}>
          <NotificationIcon module={notification.module} />
        </View>
        <View style={styles.notificationBody}>
          <View style={styles.notificationTitleRow}>
            <Text
              numberOfLines={2}
              style={[t.subhead, { color: c.label, flex: 1, fontWeight: unread ? '700' : '600' }]}
            >
              {notification.title}
            </Text>
            {unread ? <View style={[styles.unreadDot, { backgroundColor: c.tint }]} /> : null}
          </View>
          {notification.body ? (
            <Text numberOfLines={2} style={[t.footnote, { color: c.secondaryLabel, marginTop: 4 }]}>
              {notification.body}
            </Text>
          ) : null}
          <Text style={[t.caption, { color: c.tertiaryLabel, marginTop: 6 }]}>
            {MODULE_LABELS[notification.module]} · {notificationTime(notification.createdAt)}
          </Text>
        </View>
        {!unread ? <ChevronRight color={c.tertiaryLabel} size={18} /> : null}
      </Pressable>
      {unread ? (
        <Pressable
          accessibilityLabel={`标记${notification.title}为已读`}
          accessibilityRole="button"
          onPress={(event) => {
            event.stopPropagation();
            onRead();
          }}
          style={({ pressed }) => [
            styles.readButton,
            { backgroundColor: pressed ? c.fillStrong : c.fill },
          ]}
        >
          <Check color={c.tint} size={16} />
        </Pressable>
      ) : null}
    </View>
  );
}

export default function NotificationsScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const [filter, setFilter] = useState<NotificationFilter>('unread');
  const { data: notifications, isLoading, error } = useNotifications(true);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const unreadCount = notifications?.filter((item) => !item.readAt).length ?? 0;
  const visible = useMemo(
    () =>
      filter === 'unread'
        ? notifications?.filter((item) => !item.readAt) ?? []
        : notifications ?? [],
    [filter, notifications],
  );

  const openNotification = async (notification: AppNotification) => {
    try {
      if (!notification.readAt) await markRead.mutateAsync(notification.id);
      router.push(notification.targetPath as never);
    } catch (openError) {
      Alert.alert(
        '打开失败',
        openError instanceof Error ? openError.message : '请稍后再试',
      );
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <PageContainer maxWidth={920} style={[styles.page, desktop && styles.pageDesktop]}>
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[t.largeTitle, { color: c.label }]}>通知中心</Text>
            <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 4 }]}>
              {unreadCount ? `${unreadCount} 条未读` : '没有未读通知'}
            </Text>
          </View>
          {unreadCount ? (
            <Pressable
              accessibilityRole="button"
              disabled={markAll.isPending}
              onPress={() => markAll.mutate()}
              style={({ pressed }) => [
                styles.markAllButton,
                { backgroundColor: pressed ? c.fillStrong : c.fill },
              ]}
            >
              <CheckCheck color={c.tint} size={17} />
              <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>全部已读</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.filterWrap}>
          <Segmented<NotificationFilter>
            onChange={setFilter}
            options={[
              { label: '未读', value: 'unread' },
              { label: '全部', value: 'all' },
            ]}
            value={filter}
          />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Card style={styles.notificationList}>
            {isLoading ? <ActivityIndicator color={c.tint} style={styles.loader} /> : null}
            {error ? (
              <EmptyState emoji="🔔" title="通知加载失败" hint="请检查 API 服务" />
            ) : null}
            {!isLoading && !error && visible.length
              ? visible.map((notification) => (
                  <NotificationRow
                    key={notification.id}
                    notification={notification}
                    onOpen={() => void openNotification(notification)}
                    onRead={() => markRead.mutate(notification.id)}
                  />
                ))
              : null}
            {!isLoading && !error && !visible.length ? (
              <EmptyState
                emoji="🔕"
                title={filter === 'unread' ? '通知都处理完了' : '还没有通知'}
                hint="任务、投票、菜单和影视变化会显示在这里"
              />
            ) : null}
          </Card>
        </ScrollView>
      </PageContainer>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { flex: 1, paddingTop: 18 },
  pageDesktop: { paddingTop: 30 },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  markAllButton: {
    minHeight: 40,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  filterWrap: { width: 220, marginTop: 20 },
  scrollContent: { paddingTop: 18, paddingBottom: 40 },
  notificationList: { overflow: 'hidden', minHeight: 280 },
  loader: { marginTop: 80 },
  notificationRow: {
    minHeight: 88,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 14,
    gap: 6,
  },
  notificationOpen: {
    flex: 1,
    minWidth: 0,
    minHeight: 88,
    paddingLeft: 14,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  notificationIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationBody: { flex: 1, minWidth: 0 },
  notificationTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  unreadDot: { width: 7, height: 7, borderRadius: 4 },
  readButton: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
