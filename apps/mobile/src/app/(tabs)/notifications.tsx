import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Bell,
  BellRing,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Clapperboard,
  Clock3,
  CookingPot,
  Gift,
  ListTodo,
  Pencil,
  Plus,
  Inbox,
  Info,
  Radio,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  UsersRound,
  Vote,
  Webhook,
  X,
  XCircle,
} from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageContainer, useDesktopLayout } from '../../components/app-shell';
import {
  Card,
  ConfirmDialog,
  EmptyState,
  PrimaryButton,
  PressableScale,
  SectionHeader,
  Segmented,
} from '../../components/ui';
import {
  useCreateNotificationChannel,
  useDeleteNotificationChannel,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationChannels,
  useNotificationDeliveries,
  useNotifications,
  usePolls,
  useReminders,
  useRetryNotificationDelivery,
  useTasks,
  useTestNotificationChannel,
  useUpdateNotificationChannel,
  useUpdateNotificationPreference,
} from '../../lib/queries';
import { todayStr } from '../../lib/date';
import { useSession } from '../../lib/session';
import { radius, type as t, useTheme } from '../../lib/theme';
import type {
  AppNotification,
  NotificationChannel,
  NotificationChannelKind,
  NotificationDelivery,
  NotificationDeliveryStatus,
  NotificationModule,
} from '../../lib/types';

type NotificationFilter = 'unread' | 'all';
type NotificationView = 'inbox' | 'settings' | 'deliveries';
type DeliveryFilter = 'all' | 'active' | 'sent' | 'failed';
type ConsumerInboxView = 'actions' | 'updates';

const MODULE_LABELS: Record<NotificationModule, string> = {
  menu: '菜单',
  task: '任务',
  poll: '投票',
  calendar: '日历',
  reminder: '提醒',
  media: '观影',
  guest: '访客',
  points: '积分',
  agent: '小管家',
  system: '系统',
};
const MODULES = Object.keys(MODULE_LABELS) as NotificationModule[];
const ACTIVE_DELIVERY_STATUSES: NotificationDeliveryStatus[] = [
  'pending',
  'processing',
  'retry_scheduled',
];

function notificationTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function fullTime(value: string | null) {
  if (!value) return '尚未执行';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请稍后再试';
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
  if (module === 'points') return <Gift {...props} color={c.orange} />;
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
              : notification.module === 'points'
                ? c.orangeSoft
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
        style={({ pressed }) => [
          styles.notificationOpen,
          pressed && { opacity: 0.72 },
        ]}
      >
        <View style={[styles.notificationIcon, { backgroundColor: iconBackground }]}>
          <NotificationIcon module={notification.module} />
        </View>
        <View style={styles.notificationBody}>
          <View style={styles.notificationTitleRow}>
            <Text
              numberOfLines={2}
              style={[
                t.subhead,
                {
                  color: c.label,
                  flex: 1,
                  fontWeight: unread ? '700' : '600',
                },
              ]}
            >
              {notification.title}
            </Text>
            {unread ? <View style={[styles.unreadDot, { backgroundColor: c.tint }]} /> : null}
          </View>
          {notification.body ? (
            <Text
              numberOfLines={2}
              style={[t.footnote, { color: c.secondaryLabel, marginTop: 4 }]}
            >
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

interface InboxActionItem {
  background: string;
  color: string;
  href: string;
  icon: React.ComponentType<{ color?: string; size?: number }>;
  id: string;
  meta: string;
  title: string;
}

function InboxActionRow({ item }: { item: InboxActionItem }) {
  const c = useTheme();
  const router = useRouter();
  const Icon = item.icon;
  return (
    <PressableScale
      accessibilityLabel={`处理${item.title}`}
      accessibilityRole="link"
      onPress={() => router.push(item.href as never)}
      style={styles.consumerInboxAction}
    >
      <View style={[styles.consumerInboxIcon, { backgroundColor: item.background }]}>
        <Icon color={item.color} size={18} />
      </View>
      <View style={styles.consumerInboxCopy}>
        <Text numberOfLines={2} style={[t.subhead, { color: c.label, fontWeight: '700' }]}>
          {item.title}
        </Text>
        <Text numberOfLines={1} style={[t.footnote, { color: c.secondaryLabel, marginTop: 4 }]}>
          {item.meta}
        </Text>
      </View>
      <ArrowRight color={c.tertiaryLabel} size={17} />
    </PressableScale>
  );
}

function ConsumerInbox({
  notifications,
  notificationsError,
  notificationsLoading,
  markAll,
  markAllPending,
  markRead,
  openNotification,
}: {
  notifications: AppNotification[];
  notificationsError: boolean;
  notificationsLoading: boolean;
  markAll: () => void;
  markAllPending: boolean;
  markRead: (id: string) => void;
  openNotification: (notification: AppNotification) => void;
}) {
  const c = useTheme();
  const router = useRouter();
  const { member } = useSession();
  const today = todayStr();
  const { data: tasks, isLoading: tasksLoading, error: tasksError } = useTasks(today, today);
  const { data: polls, isLoading: pollsLoading, error: pollsError } = usePolls();
  const { data: reminders, isLoading: remindersLoading } = useReminders('scheduled');
  const [view, setView] = useState<ConsumerInboxView>('actions');
  const unreadCount = notifications.filter((item) => !item.readAt).length;
  const actions: InboxActionItem[] = [
    ...(tasks ?? [])
      .filter(
        (entry) =>
          entry.status === 'pending' &&
          entry.canUpdate &&
          (entry.assigneeId == null || entry.assigneeId === member?.id),
      )
      .map((entry) => ({
        background: c.tintSoft,
        color: c.tint,
        href: `/tasks?date=${entry.dueDate}&taskId=${entry.taskId}`,
        icon: ListTodo,
        id: `task:${entry.id}`,
        meta: entry.assigneeId ? '今天交给我的任务' : '今天可以认领的任务',
        title: entry.task.title,
      })),
    ...(polls ?? [])
      .filter((poll) => poll.status === 'open' && poll.canVote && poll.selectedOptionIds.length === 0)
      .map((poll) => ({
        background: c.accentSoft,
        color: c.accent,
        href: `/polls?pollId=${poll.id}`,
        icon: Vote,
        id: `poll:${poll.id}`,
        meta: `${poll.options.length} 个选项 · 等你投票`,
        title: poll.title,
      })),
  ];
  const loadingActions = tasksLoading || pollsLoading;
  const actionError = Boolean(tasksError || pollsError);
  const upcomingReminders = (reminders ?? [])
    .filter((reminder) => reminder.recipients.some((recipient) => recipient.member.id === member?.id))
    .slice(0, 3);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']} testID="consumer-family-inbox">
      <PageContainer maxWidth={720} style={styles.consumerInboxPage}>
        <View style={styles.consumerInboxHeader}>
          <View style={[styles.consumerInboxHeaderIcon, { backgroundColor: c.tintSoft }]}>
            <Inbox color={c.tint} size={23} />
          </View>
          <View style={styles.consumerInboxCopy}>
            <Text style={[t.title1, { color: c.label }]}>家庭收件箱</Text>
            <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 4 }]}>
              {actions.length ? `${actions.length} 件事需要处理` : '待办已经处理完'} · {unreadCount} 条未读
            </Text>
          </View>
          {view === 'updates' && unreadCount ? (
            <PressableScale
              accessibilityLabel="全部标为已读"
              disabled={markAllPending}
              onPress={markAll}
              style={[styles.consumerMarkAll, { backgroundColor: c.fill }]}
            >
              <CheckCheck color={c.tint} size={17} />
            </PressableScale>
          ) : null}
        </View>

        <View style={styles.consumerInboxTabs}>
          <Segmented<ConsumerInboxView>
            onChange={setView}
            options={[
              { label: `需要处理 ${actions.length}`, value: 'actions' },
              { label: `仅供了解 ${unreadCount}`, value: 'updates' },
            ]}
            value={view}
          />
        </View>

        <ScrollView contentContainerStyle={styles.consumerInboxScroll} showsVerticalScrollIndicator={false}>
          {view === 'actions' ? (
            <Card style={styles.consumerInboxList}>
              {loadingActions ? <ActivityIndicator color={c.tint} style={styles.loader} /> : null}
              {actionError ? (
                <EmptyState icon={Inbox} title="待办加载失败" hint="请稍后重新打开收件箱" />
              ) : null}
              {!loadingActions && !actionError && actions.map((item) => (
                <InboxActionRow item={item} key={item.id} />
              ))}
              {!loadingActions && !actionError && !actions.length ? (
                <EmptyState
                  icon={CheckCircle2}
                  iconBackground={c.greenSoft}
                  iconColor={c.green}
                  title="现在没有需要处理的事"
                  hint="新的家庭任务和投票会自动出现在这里"
                />
              ) : null}
            </Card>
          ) : (
            <View style={styles.consumerInboxSections}>
              {upcomingReminders.length || remindersLoading ? (
                <View>
                  <View style={styles.consumerInboxSectionTitle}>
                    <BellRing color={c.blue} size={17} />
                    <Text style={[t.headline, { color: c.label }]}>接下来提醒</Text>
                  </View>
                  <Card style={styles.consumerInboxList}>
                    {remindersLoading ? <ActivityIndicator color={c.tint} style={styles.loader} /> : null}
                    {upcomingReminders.map((reminder) => (
                      <PressableScale
                        accessibilityLabel={`打开提醒${reminder.source?.title ?? ''}`}
                        accessibilityRole="link"
                        key={reminder.id}
                        onPress={() => {
                          const target = reminder.source?.targetPath ?? `/reminders?reminderId=${reminder.id}`;
                          router.push(target as never);
                        }}
                        style={styles.consumerInboxAction}
                      >
                        <View style={[styles.consumerInboxIcon, { backgroundColor: c.blueSoft }]}>
                          <BellRing color={c.blue} size={18} />
                        </View>
                        <View style={styles.consumerInboxCopy}>
                          <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]}>
                            {reminder.source?.title ?? '家庭提醒'}
                          </Text>
                          <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 4 }]}>
                            {notificationTime(reminder.remindAt)}
                          </Text>
                        </View>
                        <Info color={c.tertiaryLabel} size={17} />
                      </PressableScale>
                    ))}
                  </Card>
                </View>
              ) : null}
              <View>
                <View style={styles.consumerInboxSectionTitle}>
                  <Info color={c.orange} size={17} />
                  <Text style={[t.headline, { color: c.label }]}>家庭动态</Text>
                </View>
                <Card style={[styles.notificationList, styles.consumerNotificationList]}>
                  {notificationsLoading ? <ActivityIndicator color={c.tint} style={styles.loader} /> : null}
                  {notificationsError ? (
                    <EmptyState icon={Bell} title="消息加载失败" hint="请检查 API 服务" />
                  ) : null}
                  {!notificationsLoading && !notificationsError && notifications.map((notification) => (
                    <NotificationRow
                      key={notification.id}
                      notification={notification}
                      onOpen={() => openNotification(notification)}
                      onRead={() => markRead(notification.id)}
                    />
                  ))}
                  {!notificationsLoading && !notificationsError && !notifications.length ? (
                    <EmptyState icon={Bell} title="还没有家庭动态" hint="菜单、任务和日程变化会显示在这里" />
                  ) : null}
                </Card>
              </View>
            </View>
          )}
        </ScrollView>
      </PageContainer>
    </SafeAreaView>
  );
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
}) {
  const c = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[t.footnote, { color: c.secondaryLabel }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.tertiaryLabel}
        secureTextEntry={secureTextEntry}
        style={[t.body, styles.input, { backgroundColor: c.fill, color: c.label }]}
        value={value}
      />
    </View>
  );
}

function ActionButton({
  label,
  icon,
  onPress,
  disabled,
  destructive,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: pressed ? c.fillStrong : c.fill,
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      {icon}
      <Text
        style={[
          t.footnote,
          { color: destructive ? c.red : c.label, fontWeight: '600' },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ChannelEditor({
  channel,
  onClose,
}: {
  channel: NotificationChannel | null;
  onClose: () => void;
}) {
  const c = useTheme();
  const create = useCreateNotificationChannel();
  const update = useUpdateNotificationChannel();
  const [name, setName] = useState(channel?.name ?? '');
  const [kind, setKind] = useState<NotificationChannelKind>(channel?.kind ?? 'webhook');
  const [endpoint, setEndpoint] = useState('');
  const [credential, setCredential] = useState('');
  const [clearCredential, setClearCredential] = useState(false);
  const pending = create.isPending || update.isPending;

  const submit = () => {
    if (!name.trim() || (!channel && !endpoint.trim())) return;
    const options = {
      onSuccess: () => {
        Alert.alert(channel ? '渠道已更新' : '渠道已创建');
        onClose();
      },
      onError: (error: unknown) => Alert.alert('保存失败', errorMessage(error)),
    };
    if (channel) {
      update.mutate(
        {
          id: channel.id,
          name: name.trim(),
          kind,
          ...(endpoint.trim() ? { endpoint: endpoint.trim() } : {}),
          ...(credential.trim() ? { credential: credential.trim() } : {}),
          ...(clearCredential ? { clearCredential: true } : {}),
        },
        options,
      );
    } else {
      create.mutate(
        {
          name: name.trim(),
          kind,
          endpoint: endpoint.trim(),
          ...(credential.trim() ? { credential: credential.trim() } : {}),
        },
        options,
      );
    }
  };

  return (
    <Card style={styles.editorCard}>
      <View style={styles.editorHeader}>
        <Text style={[t.headline, { color: c.label }]}>
          {channel ? '编辑外部渠道' : '新增外部渠道'}
        </Text>
        <Pressable
          accessibilityLabel="关闭渠道编辑"
          accessibilityRole="button"
          onPress={onClose}
          style={[styles.iconButton, { backgroundColor: c.fill }]}
        >
          <X color={c.secondaryLabel} size={18} />
        </Pressable>
      </View>
      <FormField label="渠道名称" value={name} onChangeText={setName} placeholder="例如：家庭 ntfy" />
      <View style={{ gap: 7 }}>
        <Text style={[t.footnote, { color: c.secondaryLabel }]}>渠道类型</Text>
        <Segmented<NotificationChannelKind>
          options={[
            { label: 'Webhook', value: 'webhook' },
            { label: 'ntfy', value: 'ntfy' },
          ]}
          value={kind}
          onChange={setKind}
        />
      </View>
      <FormField
        label={channel ? '替换地址' : '接收地址'}
        value={endpoint}
        onChangeText={setEndpoint}
        placeholder={channel ? `留空保持 ${channel.endpointHint}` : 'https://example.com/family-hook'}
      />
      <FormField
        label={channel ? '替换 Bearer 凭据' : 'Bearer 凭据（可选）'}
        value={credential}
        onChangeText={(value) => {
          setCredential(value);
          if (value) setClearCredential(false);
        }}
        placeholder={channel?.credentialHint ? `留空保持 ${channel.credentialHint}` : '可留空'}
        secureTextEntry
      />
      {channel?.credentialConfigured ? (
        <View style={styles.preferenceSwitchRow}>
          <View style={{ flex: 1 }}>
            <Text style={[t.subhead, { color: c.label }]}>清除现有凭据</Text>
            <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>保存后不可恢复</Text>
          </View>
          <Switch
            accessibilityLabel="清除现有渠道凭据"
            onValueChange={(value) => {
              setClearCredential(value);
              if (value) setCredential('');
            }}
            trackColor={{ false: c.fillStrong, true: c.redSoft }}
            thumbColor={clearCredential ? c.red : c.tertiaryLabel}
            value={clearCredential}
          />
        </View>
      ) : null}
      <PrimaryButton
        disabled={!name.trim() || (!channel && !endpoint.trim())}
        icon={<Send color="#FFFFFF" size={17} />}
        loading={pending}
        onPress={submit}
        title={channel ? '保存渠道' : '创建渠道'}
      />
    </Card>
  );
}

function ChannelCard({
  channel,
  canManage,
  onDelete,
  onEdit,
}: {
  channel: NotificationChannel;
  canManage: boolean;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const c = useTheme();
  const update = useUpdateNotificationChannel();
  const test = useTestNotificationChannel();
  const updatePreference = useUpdateNotificationPreference();
  const preference = channel.preference;

  const savePreference = (isEnabled: boolean, modules = preference.modules) => {
    updatePreference.mutate(
      { channelId: channel.id, isEnabled, modules },
      { onError: (error) => Alert.alert('偏好更新失败', errorMessage(error)) },
    );
  };

  const toggleModule = (module: NotificationModule) => {
    const modules = preference.modules.includes(module)
      ? preference.modules.filter((item) => item !== module)
      : [...preference.modules, module];
    if (!modules.length) {
      Alert.alert('至少保留一类通知');
      return;
    }
    savePreference(preference.isEnabled, modules);
  };

  return (
    <Card style={styles.channelCard}>
      <View style={styles.channelHeader}>
        <View
          style={[
            styles.channelIcon,
            { backgroundColor: channel.kind === 'ntfy' ? c.greenSoft : c.tintSoft },
          ]}
        >
          {channel.kind === 'ntfy' ? (
            <Radio color={c.green} size={20} />
          ) : (
            <Webhook color={c.tint} size={20} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.channelTitleRow}>
            <Text numberOfLines={1} style={[t.headline, { color: c.label, flex: 1 }]}>
              {channel.name}
            </Text>
            <View
              style={[
                styles.statusPill,
                { backgroundColor: channel.isEnabled ? c.greenSoft : c.fill },
              ]}
            >
              <Text
                style={[
                  t.caption,
                  { color: channel.isEnabled ? c.green : c.secondaryLabel, fontWeight: '700' },
                ]}
              >
                {channel.isEnabled ? '已启用' : '已停用'}
              </Text>
            </View>
          </View>
          <Text numberOfLines={1} style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>
            {channel.kind === 'ntfy' ? 'ntfy' : 'Webhook'} · {channel.endpointHint}
            {channel.credentialHint ? ` · ${channel.credentialHint}` : ''}
          </Text>
          {channel.lastTestedAt ? (
            <Text
              style={[
                t.caption,
                {
                  color: channel.lastTestStatus === 'success' ? c.green : c.red,
                  marginTop: 3,
                },
              ]}
            >
              {channel.lastTestStatus === 'success' ? '最近测试成功' : channel.lastTestError ?? '最近测试失败'}
              {' · '}{fullTime(channel.lastTestedAt)}
            </Text>
          ) : null}
        </View>
      </View>

      {canManage ? (
        <View style={styles.channelActions}>
          <ActionButton
            disabled={test.isPending || !channel.isEnabled}
            icon={<Send color={c.tint} size={15} />}
            label="测试"
            onPress={() =>
              test.mutate(channel.id, {
                onSuccess: () => Alert.alert('测试成功', '外部渠道已经收到测试消息'),
                onError: (error) => Alert.alert('测试失败', errorMessage(error)),
              })
            }
          />
          <ActionButton icon={<Pencil color={c.label} size={15} />} label="编辑" onPress={onEdit} />
          <ActionButton
            disabled={update.isPending}
            icon={<RefreshCw color={c.label} size={15} />}
            label={channel.isEnabled ? '停用' : '启用'}
            onPress={() =>
              update.mutate(
                { id: channel.id, isEnabled: !channel.isEnabled },
                { onError: (error) => Alert.alert('更新失败', errorMessage(error)) },
              )
            }
          />
          <ActionButton
            destructive
            icon={<Trash2 color={c.red} size={15} />}
            label="删除"
            onPress={onDelete}
          />
        </View>
      ) : null}

      <View style={[styles.preferenceBlock, { borderTopColor: c.separator }]}>
        <View style={styles.preferenceSwitchRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[t.subhead, { color: c.label, fontWeight: '600' }]}>接收我的通知</Text>
            <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>
              {channel.isEnabled ? '只影响当前家庭成员' : '渠道停用期间不会投递'}
            </Text>
          </View>
          <Switch
            accessibilityLabel={`通过${channel.name}接收我的通知`}
            disabled={!channel.isEnabled || updatePreference.isPending}
            onValueChange={(value) => savePreference(value)}
            trackColor={{ false: c.fillStrong, true: c.tintSoft }}
            thumbColor={preference.isEnabled ? c.tint : c.tertiaryLabel}
            value={preference.isEnabled}
          />
        </View>
        <View style={styles.moduleGrid}>
          {MODULES.map((module) => {
            const selected = preference.modules.includes(module);
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                disabled={updatePreference.isPending}
                key={module}
                onPress={() => toggleModule(module)}
                style={[
                  styles.moduleChip,
                  {
                    backgroundColor: selected ? c.tintSoft : c.fill,
                    borderColor: selected ? c.tint : c.separator,
                  },
                ]}
              >
                {selected ? <Check color={c.tint} size={13} /> : null}
                <Text style={[t.caption, { color: selected ? c.tint : c.secondaryLabel }]}>
                  {MODULE_LABELS[module]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Card>
  );
}

function DeliveryStatusMark({ status }: { status: NotificationDeliveryStatus }) {
  const c = useTheme();
  if (status === 'sent') return <CheckCircle2 color={c.green} size={20} />;
  if (status === 'failed') return <XCircle color={c.red} size={20} />;
  if (status === 'processing') return <Send color={c.tint} size={20} />;
  return <Clock3 color={c.orange} size={20} />;
}

function deliveryStatusLabel(status: NotificationDeliveryStatus) {
  if (status === 'sent') return '投递成功';
  if (status === 'failed') return '投递失败';
  if (status === 'processing') return '正在投递';
  if (status === 'retry_scheduled') return '等待重试';
  return '等待投递';
}

function DeliveryCard({ delivery }: { delivery: NotificationDelivery }) {
  const c = useTheme();
  const retry = useRetryNotificationDelivery();
  return (
    <Card style={styles.deliveryCard}>
      <View style={styles.deliveryHeader}>
        <View
          style={[
            styles.deliveryStatusIcon,
            {
              backgroundColor:
                delivery.status === 'sent'
                  ? c.greenSoft
                  : delivery.status === 'failed'
                    ? c.redSoft
                    : c.orangeSoft,
            },
          ]}
        >
          <DeliveryStatusMark status={delivery.status} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={2} style={[t.headline, { color: c.label }]}>
            {delivery.notification.title}
          </Text>
          <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>
            {delivery.channelName} · {delivery.recipient.name} · {notificationTime(delivery.createdAt)}
          </Text>
        </View>
        <Text
          style={[
            t.caption,
            {
              color:
                delivery.status === 'sent'
                  ? c.green
                  : delivery.status === 'failed'
                    ? c.red
                    : c.orange,
              fontWeight: '700',
            },
          ]}
        >
          {deliveryStatusLabel(delivery.status)}
        </Text>
      </View>
      <View style={[styles.deliveryMeta, { backgroundColor: c.fill }]}>
        <Text style={[t.caption, { color: c.secondaryLabel }]}>尝试 {delivery.attemptCount} 次</Text>
        <Text style={[t.caption, { color: c.secondaryLabel }]}>{delivery.endpointHint}</Text>
        {delivery.nextAttemptAt ? (
          <Text style={[t.caption, { color: c.orange }]}>下次 {fullTime(delivery.nextAttemptAt)}</Text>
        ) : null}
        {delivery.lastError ? (
          <Text style={[t.caption, { color: c.red }]}>{delivery.lastError}</Text>
        ) : null}
      </View>
      {delivery.attempts.length ? (
        <View style={styles.attemptList}>
          {delivery.attempts.slice(0, 3).map((attempt) => (
            <View key={attempt.id} style={styles.attemptRow}>
              {attempt.status === 'sent' ? (
                <Check color={c.green} size={14} />
              ) : (
                <X color={c.red} size={14} />
              )}
              <Text style={[t.caption, { color: c.secondaryLabel, flex: 1 }]}>
                第 {attempt.attemptNumber} 次 · {fullTime(attempt.finishedAt)}
              </Text>
              <Text style={[t.caption, { color: attempt.status === 'sent' ? c.green : c.red }]}>
                {attempt.httpStatus ? `HTTP ${attempt.httpStatus}` : attempt.errorCode ?? '成功'}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {delivery.canRetry ? (
        <PrimaryButton
          icon={<RotateCcw color="#FFFFFF" size={17} />}
          loading={retry.isPending}
          onPress={() =>
            retry.mutate(delivery.id, {
              onSuccess: () => Alert.alert('已安排重试'),
              onError: (error) => Alert.alert('重试失败', errorMessage(error)),
            })
          }
          style={styles.retryButton}
          title="重新投递"
        />
      ) : null}
    </Card>
  );
}

export default function NotificationsScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const params = useLocalSearchParams<{ view?: string | string[] }>();
  const requestedView = Array.isArray(params.view) ? params.view[0] : params.view;
  const initialView: NotificationView =
    requestedView === 'settings' || requestedView === 'deliveries'
      ? requestedView
      : 'inbox';
  const [view, setView] = useState<NotificationView>(initialView);
  const [filter, setFilter] = useState<NotificationFilter>('unread');
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>('all');
  const [editingChannel, setEditingChannel] = useState<NotificationChannel | null | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<NotificationChannel | null>(null);
  const { member } = useSession();
  const canManage = member?.role === 'owner' || member?.role === 'admin';
  const notificationsQuery = useNotifications(true);
  const channelsQuery = useNotificationChannels(view === 'settings');
  const deliveriesQuery = useNotificationDeliveries('all', view === 'deliveries');
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const removeChannel = useDeleteNotificationChannel();
  const notifications = notificationsQuery.data;
  const unreadCount = notifications?.filter((item) => !item.readAt).length ?? 0;

  useEffect(() => {
    if (requestedView === 'settings' || requestedView === 'deliveries') {
      setView(requestedView);
    }
  }, [requestedView]);

  const visibleNotifications = useMemo(
    () =>
      filter === 'unread'
        ? notifications?.filter((item) => !item.readAt) ?? []
        : notifications ?? [],
    [filter, notifications],
  );
  const visibleDeliveries = useMemo(() => {
    const rows = deliveriesQuery.data ?? [];
    if (deliveryFilter === 'active') {
      return rows.filter((item) => ACTIVE_DELIVERY_STATUSES.includes(item.status));
    }
    if (deliveryFilter === 'sent' || deliveryFilter === 'failed') {
      return rows.filter((item) => item.status === deliveryFilter);
    }
    return rows;
  }, [deliveriesQuery.data, deliveryFilter]);

  const changeView = (next: NotificationView) => {
    setView(next);
    router.setParams({ view: next === 'inbox' ? undefined : next });
  };

  const openNotification = async (notification: AppNotification) => {
    try {
      if (!notification.readAt) await markRead.mutateAsync(notification.id);
      router.push(notification.targetPath as never);
    } catch (openError) {
      Alert.alert('打开失败', errorMessage(openError));
    }
  };

  if (member?.role === 'member') {
    return (
      <ConsumerInbox
        markAll={() => markAll.mutate()}
        markAllPending={markAll.isPending}
        markRead={(id) => markRead.mutate(id)}
        notifications={notifications ?? []}
        notificationsError={Boolean(notificationsQuery.error)}
        notificationsLoading={notificationsQuery.isLoading}
        openNotification={(notification) => void openNotification(notification)}
      />
    );
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <PageContainer maxWidth={980} style={[styles.page, desktop && styles.pageDesktop]}>
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[t.largeTitle, { color: c.label }]}>通知中心</Text>
            <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 4 }]}>
              {view === 'inbox'
                ? unreadCount
                  ? `${unreadCount} 条未读`
                  : '没有未读通知'
                : view === 'settings'
                  ? '外部渠道与我的接收偏好'
                  : '外部投递状态与重试记录'}
            </Text>
          </View>
          {view === 'inbox' && unreadCount ? (
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

        <View style={[styles.viewTabs, desktop && styles.viewTabsDesktop]}>
          <Segmented<NotificationView>
            onChange={changeView}
            options={[
              { label: '站内消息', value: 'inbox' },
              { label: '外部渠道', value: 'settings' },
              { label: '投递记录', value: 'deliveries' },
            ]}
            value={view}
          />
        </View>

        {view === 'inbox' ? (
          <>
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
                {notificationsQuery.isLoading ? <ActivityIndicator color={c.tint} style={styles.loader} /> : null}
                {notificationsQuery.error ? (
                  <EmptyState emoji="🔔" title="通知加载失败" hint="请检查 API 服务" />
                ) : null}
                {!notificationsQuery.isLoading && !notificationsQuery.error && visibleNotifications.length
                  ? visibleNotifications.map((notification) => (
                      <NotificationRow
                        key={notification.id}
                        notification={notification}
                        onOpen={() => void openNotification(notification)}
                        onRead={() => markRead.mutate(notification.id)}
                      />
                    ))
                  : null}
                {!notificationsQuery.isLoading && !notificationsQuery.error && !visibleNotifications.length ? (
                  <EmptyState
                    emoji="🔕"
                    title={filter === 'unread' ? '通知都处理完了' : '还没有通知'}
                    hint="任务、投票、菜单和影视变化会显示在这里"
                  />
                ) : null}
              </Card>
            </ScrollView>
          </>
        ) : null}

        {view === 'settings' ? (
          <ScrollView contentContainerStyle={styles.settingsContent} showsVerticalScrollIndicator={false}>
            {canManage ? (
              <View style={styles.settingsTitleRow}>
                <SectionHeader title="家庭外部渠道" />
                {editingChannel === undefined ? (
                  <PressableScale
                    accessibilityLabel="新增外部通知渠道"
                    onPress={() => setEditingChannel(null)}
                    style={[styles.addButton, { backgroundColor: c.tintSoft }]}
                  >
                    <Plus color={c.tint} size={16} />
                    <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>新增渠道</Text>
                  </PressableScale>
                ) : null}
              </View>
            ) : (
              <SectionHeader title="我的外部渠道" />
            )}
            {editingChannel !== undefined ? (
              <ChannelEditor channel={editingChannel} onClose={() => setEditingChannel(undefined)} />
            ) : null}
            {channelsQuery.isLoading ? <ActivityIndicator color={c.tint} style={styles.settingsLoader} /> : null}
            {channelsQuery.error ? (
              <EmptyState emoji="📡" title="渠道加载失败" hint="请稍后重试" />
            ) : null}
            {channelsQuery.data?.map((channel) => (
              <ChannelCard
                canManage={Boolean(canManage)}
                channel={channel}
                key={channel.id}
                onDelete={() => setDeleteTarget(channel)}
                onEdit={() => setEditingChannel(channel)}
              />
            ))}
            {!channelsQuery.isLoading && !channelsQuery.error && !channelsQuery.data?.length ? (
              <EmptyState
                emoji="📡"
                title="还没有外部通知渠道"
                hint={canManage ? '新增 Webhook 或 ntfy 渠道后，成员可自行选择接收范围' : '请由家庭管理员先配置渠道'}
              />
            ) : null}
          </ScrollView>
        ) : null}

        {view === 'deliveries' ? (
          <>
            <View style={[styles.deliveryFilters, desktop && styles.deliveryFiltersDesktop]}>
              <Segmented<DeliveryFilter>
                onChange={setDeliveryFilter}
                options={[
                  { label: '全部', value: 'all' },
                  { label: '进行中', value: 'active' },
                  { label: '成功', value: 'sent' },
                  { label: '失败', value: 'failed' },
                ]}
                value={deliveryFilter}
              />
            </View>
            <ScrollView contentContainerStyle={styles.deliveryContent} showsVerticalScrollIndicator={false}>
              {deliveriesQuery.isLoading ? <ActivityIndicator color={c.tint} style={styles.settingsLoader} /> : null}
              {deliveriesQuery.error ? (
                <EmptyState emoji="📨" title="投递记录加载失败" hint="请稍后重试" />
              ) : null}
              {visibleDeliveries.map((delivery) => (
                <DeliveryCard delivery={delivery} key={delivery.id} />
              ))}
              {!deliveriesQuery.isLoading && !deliveriesQuery.error && !visibleDeliveries.length ? (
                <EmptyState emoji="📭" title="没有对应投递" hint="启用外部渠道后，新通知会在这里显示状态" />
              ) : null}
            </ScrollView>
          </>
        ) : null}
      </PageContainer>

      <ConfirmDialog
        confirmLabel="删除渠道"
        loading={removeChannel.isPending}
        message={`删除「${deleteTarget?.name ?? ''}」后，成员偏好会清除，历史投递仍会保留渠道快照。`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          removeChannel.mutate(deleteTarget.id, {
            onSuccess: () => {
              setDeleteTarget(null);
              Alert.alert('渠道已删除');
            },
            onError: (error) => Alert.alert('删除失败', errorMessage(error)),
          });
        }}
        title="删除外部通知渠道"
        visible={Boolean(deleteTarget)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  consumerInboxPage: { flex: 1, paddingTop: 12 },
  consumerInboxHeader: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 58 },
  consumerInboxHeaderIcon: {
    alignItems: 'center',
    borderRadius: 23,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  consumerInboxCopy: { flex: 1, minWidth: 0 },
  consumerMarkAll: { alignItems: 'center', borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  consumerInboxTabs: { marginTop: 18 },
  consumerInboxScroll: { paddingBottom: 104, paddingTop: 16 },
  consumerInboxList: { overflow: 'hidden' },
  consumerNotificationList: { minHeight: 0 },
  consumerInboxAction: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11,
    minHeight: 72,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  consumerInboxIcon: {
    alignItems: 'center',
    borderRadius: 19,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  consumerInboxSections: { gap: 24 },
  consumerInboxSectionTitle: { alignItems: 'center', flexDirection: 'row', gap: 7, marginBottom: 9, paddingHorizontal: 3 },
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
  viewTabs: { width: '100%', marginTop: 20 },
  viewTabsDesktop: { width: 480 },
  filterWrap: { width: 220, marginTop: 16 },
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
  settingsContent: { paddingTop: 10, paddingBottom: 42, gap: 12 },
  settingsTitleRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  addButton: {
    minHeight: 38,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  editorCard: { padding: 16, gap: 14 },
  editorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    minHeight: 46,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  settingsLoader: { marginVertical: 72 },
  channelCard: { padding: 16 },
  channelHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  channelIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusPill: { borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  channelActions: {
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionButton: {
    minHeight: 36,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  preferenceBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 16,
    paddingTop: 14,
  },
  preferenceSwitchRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  moduleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 },
  moduleChip: {
    minHeight: 34,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  deliveryFilters: { width: '100%', marginTop: 16 },
  deliveryFiltersDesktop: { width: 480 },
  deliveryContent: { paddingTop: 18, paddingBottom: 42, gap: 12 },
  deliveryCard: { padding: 15 },
  deliveryHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  deliveryStatusIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deliveryMeta: { borderRadius: radius.sm, padding: 10, gap: 4, marginTop: 12 },
  attemptList: { gap: 7, marginTop: 12 },
  attemptRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  retryButton: { marginTop: 14, height: 44 },
});
