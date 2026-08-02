import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  BellPlus,
  BellRing,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  CookingPot,
  ListTodo,
  Pencil,
  Plane,
  Plus,
  Trash2,
  Vote,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageContainer, useDesktopLayout } from '../../components/app-shell';
import { DateSelector } from '../../components/date-selector';
import {
  Card,
  ConfirmDialog,
  EmptyState,
  PrimaryButton,
  Segmented,
} from '../../components/ui';
import { dateStr, formatPlanDate, parseDate, todayStr } from '../../lib/date';
import {
  useCancelReminder,
  useMembers,
  useReminderSources,
  useReminders,
  useUpsertReminder,
} from '../../lib/queries';
import { useSession } from '../../lib/session';
import { radius, type as t, useTheme } from '../../lib/theme';
import type {
  HouseholdReminder,
  Member,
  ReminderSource,
  ReminderSourceModule,
  ReminderStatus,
} from '../../lib/types';

type ReminderFilter = ReminderStatus | 'all';
type SourceFilter = ReminderSourceModule | 'all';

const SOURCE_META: Record<
  ReminderSourceModule,
  { label: string; icon: LucideIcon }
> = {
  menu: { label: '菜单', icon: CookingPot },
  task: { label: '任务', icon: ListTodo },
  calendar: { label: '日程', icon: CalendarDays },
  poll: { label: '投票', icon: Vote },
  maintenance: { label: '维护', icon: Wrench },
  travel: { label: '出行', icon: Plane },
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function sourceKey(source: Pick<ReminderSource, 'module' | 'sourceId' | 'occurrenceDate'>) {
  return `${source.module}:${source.sourceId}:${source.occurrenceDate ?? ''}`;
}

function sourceParamKey(
  module?: string,
  sourceId?: string,
  occurrenceDate?: string,
) {
  return module && sourceId ? `${module}:${sourceId}:${occurrenceDate ?? ''}` : null;
}

function dateTimeParts(value: string) {
  const date = new Date(value);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return { date: dateStr(date), time: `${hours}:${minutes}` };
}

function defaultReminderTime(source: ReminderSource | null) {
  let date = source?.date ? parseDate(source.date) : parseDate(todayStr(1));
  if (source?.startsAt) {
    date = new Date(new Date(source.startsAt).getTime() - 60 * 60 * 1000);
  } else if (source?.module === 'menu') {
    const hour = source.title.includes('早餐')
      ? 7
      : source.title.includes('午餐')
        ? 11
        : 17;
    date.setHours(hour, 0, 0, 0);
  } else if (source?.module === 'task') {
    date.setHours(8, 0, 0, 0);
  } else {
    date.setHours(9, 0, 0, 0);
  }
  if (date.getTime() <= Date.now()) {
    date = new Date(Date.now() + 60 * 60 * 1000);
    date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  }
  return dateTimeParts(date.toISOString());
}

function toReminderDate(date: string, time: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const value = new Date(`${date}T${time}:00`);
  return Number.isFinite(value.getTime()) ? value : null;
}

function formatReminderTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function formatSourceSchedule(source: ReminderSource) {
  if (source.startsAt) {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(source.startsAt));
  }
  if (source.date) return formatPlanDate(source.date);
  return '未设置截止时间';
}

function ReminderForm({
  initialSourceKey,
  members,
  onClose,
  onSaved,
  reminder,
  sources,
  visible,
}: {
  initialSourceKey: string | null;
  members: Member[];
  onClose: () => void;
  onSaved: () => void;
  reminder: HouseholdReminder | null;
  sources: ReminderSource[];
  visible: boolean;
}) {
  const c = useTheme();
  const { member } = useSession();
  const save = useUpsertReminder();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [remindOn, setRemindOn] = useState(todayStr(1));
  const [remindTime, setRemindTime] = useState('09:00');
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const reminderSourceKey = reminder?.source
      ? sourceKey(reminder.source)
      : reminder
        ? `${reminder.sourceModule}:${reminder.sourceId}:${reminder.occurrenceDate ?? ''}`
        : null;
    const key = reminderSourceKey ?? initialSourceKey ?? (sources[0] ? sourceKey(sources[0]) : null);
    const selected = sources.find((source) => sourceKey(source) === key) ?? reminder?.source ?? null;
    const parts = reminder
      ? dateTimeParts(reminder.remindAt)
      : defaultReminderTime(selected);
    setSelectedKey(key);
    setSourceFilter(selected?.module ?? 'all');
    setRemindOn(parts.date);
    setRemindTime(parts.time);
    setRecipientIds(
      reminder?.recipients.map((recipient) => recipient.member.id) ??
        (member ? [member.id] : []),
    );
    setMessage(null);
  }, [initialSourceKey, member, reminder, sources, visible]);

  const selectedSource =
    sources.find((source) => sourceKey(source) === selectedKey) ?? reminder?.source ?? null;
  const filteredSources = sources.filter(
    (source) => sourceFilter === 'all' || source.module === sourceFilter,
  );
  const displayedSources =
    selectedSource &&
    (sourceFilter === 'all' || selectedSource.module === sourceFilter) &&
    !filteredSources.slice(0, 30).some((source) => sourceKey(source) === selectedKey)
      ? [
          selectedSource,
          ...filteredSources
            .filter((source) => sourceKey(source) !== selectedKey)
            .slice(0, 29),
        ]
      : filteredSources.slice(0, 30);

  const selectSource = (source: ReminderSource) => {
    setSelectedKey(sourceKey(source));
    const parts = defaultReminderTime(source);
    setRemindOn(parts.date);
    setRemindTime(parts.time);
    setMessage(null);
  };

  const toggleRecipient = (memberId: string) => {
    setRecipientIds((current) =>
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId],
    );
  };

  const submit = async () => {
    if (!selectedSource) {
      setMessage('请选择要提醒的家庭事项');
      return;
    }
    if (!recipientIds.length) {
      setMessage('至少选择一位接收人');
      return;
    }
    const remindAt = toReminderDate(remindOn, remindTime);
    if (!remindAt) {
      setMessage('时间请使用 HH:mm 格式');
      return;
    }
    if (remindAt.getTime() <= Date.now()) {
      setMessage('提醒时间必须晚于当前时间');
      return;
    }
    setMessage(null);
    try {
      await save.mutateAsync({
        id: reminder?.id,
        sourceModule: reminder ? undefined : selectedSource.module,
        sourceId: reminder ? undefined : selectedSource.sourceId,
        occurrenceDate: reminder ? undefined : selectedSource.occurrenceDate,
        remindAt: remindAt.toISOString(),
        recipientIds,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，请稍后再试');
    }
  };

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalOverlay}>
        <Pressable
          accessibilityLabel="关闭提醒编辑"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[styles.formSheet, { backgroundColor: c.card, borderColor: c.separator }]}
        >
          <View style={styles.formHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.title2, { color: c.label }]}>
                {reminder ? '编辑提醒' : '新建提醒'}
              </Text>
              <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>到点后发送站内通知</Text>
            </View>
            <Pressable
              accessibilityLabel="关闭"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.iconButton,
                { backgroundColor: pressed ? c.fill : 'transparent' },
              ]}
            >
              <X color={c.secondaryLabel} size={20} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.formContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.field}>
              <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>关联事项</Text>
              {reminder ? (
                <SourceSummary source={selectedSource} />
              ) : (
                <>
                  <ScrollView
                    contentContainerStyle={styles.sourceFilters}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                  >
                    {([
                      ['all', '全部'],
                      ['menu', '菜单'],
                      ['task', '任务'],
                      ['calendar', '日程'],
                      ['poll', '投票'],
                    ] as [SourceFilter, string][]).map(([value, label]) => {
                      const active = sourceFilter === value;
                      return (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          key={value}
                          onPress={() => setSourceFilter(value)}
                          style={[
                            styles.filterChip,
                            {
                              backgroundColor: active ? c.tintSoft : c.fill,
                              borderColor: active ? c.tint : 'transparent',
                            },
                          ]}
                        >
                          <Text style={[t.footnote, { color: active ? c.tint : c.secondaryLabel, fontWeight: '700' }]}>
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  <View style={[styles.sourceList, { borderColor: c.separator }]}>
                    <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
                      {displayedSources.length ? (
                        displayedSources.map((source) => {
                          const active = selectedKey === sourceKey(source);
                          const MetaIcon = SOURCE_META[source.module].icon;
                          return (
                            <Pressable
                              aria-pressed={active}
                              accessibilityLabel={`选择${source.title}`}
                              accessibilityRole="button"
                              accessibilityState={{ selected: active }}
                              key={sourceKey(source)}
                              onPress={() => selectSource(source)}
                              style={[
                                styles.sourceOption,
                                { borderBottomColor: c.separator },
                                active && { backgroundColor: c.tintSoft },
                              ]}
                            >
                              <MetaIcon color={active ? c.tint : c.secondaryLabel} size={18} />
                              <View style={{ flex: 1, minWidth: 0 }}>
                                <Text numberOfLines={1} style={[t.subhead, { color: c.label, fontWeight: '600' }]}>
                                  {source.title}
                                </Text>
                                <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>
                                  {SOURCE_META[source.module].label} · {formatSourceSchedule(source)}
                                </Text>
                              </View>
                              {active ? <Check color={c.tint} size={18} /> : null}
                            </Pressable>
                          );
                        })
                      ) : (
                        <Text style={[t.subhead, styles.noSourceText, { color: c.secondaryLabel }]}>近期没有可设置提醒的事项</Text>
                      )}
                    </ScrollView>
                  </View>
                </>
              )}
            </View>

            <View style={styles.field}>
              <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>提醒日期</Text>
              <DateSelector onChange={setRemindOn} value={remindOn} />
            </View>

            <View style={styles.field}>
              <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>提醒时间</Text>
              <View style={[styles.timeInputRow, { backgroundColor: c.fill }]}>
                <Clock3 color={c.secondaryLabel} size={18} />
                <TextInput
                  accessibilityLabel="提醒时间"
                  inputMode="text"
                  maxLength={5}
                  onChangeText={setRemindTime}
                  placeholder="09:00"
                  placeholderTextColor={c.tertiaryLabel}
                  style={[t.body, styles.timeInput, { color: c.label }]}
                  value={remindTime}
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>接收人</Text>
              <View style={styles.memberOptions}>
                {members.map((candidate) => {
                  const active = recipientIds.includes(candidate.id);
                  return (
                    <Pressable
                      aria-checked={active}
                      accessibilityLabel={`提醒${candidate.name}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: active }}
                      key={candidate.id}
                      onPress={() => toggleRecipient(candidate.id)}
                      style={[
                        styles.memberOption,
                        {
                          backgroundColor: active ? c.tintSoft : c.fill,
                          borderColor: active ? c.tint : 'transparent',
                        },
                      ]}
                    >
                      <Text style={styles.memberEmoji}>{candidate.avatarEmoji}</Text>
                      <Text style={[t.subhead, { color: active ? c.tint : c.label, fontWeight: '600' }]}>
                        {candidate.name}
                      </Text>
                      {active ? <Check color={c.tint} size={15} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {message ? (
              <View style={[styles.message, { backgroundColor: c.redSoft }]}>
                <Text style={[t.footnote, { color: c.red }]}>{message}</Text>
              </View>
            ) : null}

            <PrimaryButton
              icon={<BellPlus color="#FFFFFF" size={18} />}
              loading={save.isPending}
              onPress={submit}
              title={reminder ? '保存提醒' : '设置提醒'}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function SourceSummary({ source }: { source: ReminderSource | null }) {
  const c = useTheme();
  if (!source) {
    return (
      <View style={[styles.sourceSummary, { backgroundColor: c.fill }]}>
        <Text style={[t.subhead, { color: c.secondaryLabel }]}>原事项已不可用</Text>
      </View>
    );
  }
  const Icon = SOURCE_META[source.module].icon;
  return (
    <View style={[styles.sourceSummary, { backgroundColor: c.fill }]}>
      <Icon color={c.tint} size={19} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[t.subhead, { color: c.label, fontWeight: '700' }]}>{source.title}</Text>
        <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>
          {SOURCE_META[source.module].label} · {formatSourceSchedule(source)}
        </Text>
      </View>
    </View>
  );
}

function ReminderCard({
  focused,
  onCancel,
  onEdit,
  onOpen,
  reminder,
}: {
  focused: boolean;
  onCancel: () => void;
  onEdit: () => void;
  onOpen: () => void;
  reminder: HouseholdReminder;
}) {
  const c = useTheme();
  const meta = SOURCE_META[reminder.sourceModule];
  const Icon = meta.icon;
  const statusLabel =
    reminder.status === 'scheduled'
      ? '待提醒'
      : reminder.status === 'sent'
        ? '已发送'
        : '已取消';
  const statusColor =
    reminder.status === 'scheduled'
      ? c.tint
      : reminder.status === 'sent'
        ? c.blue
        : c.secondaryLabel;

  return (
    <Card style={[styles.reminderCard, focused && { borderColor: c.tint, borderWidth: 2 }]}>
      <View style={styles.cardTop}>
        <View style={[styles.sourceIcon, { backgroundColor: c.tintSoft }]}>
          <Icon color={c.tint} size={20} />
        </View>
        <Pressable
          accessibilityRole="link"
          disabled={!reminder.source}
          onPress={onOpen}
          style={styles.cardTitleWrap}
        >
          <Text numberOfLines={2} style={[t.headline, { color: c.label }]}>
            {reminder.source?.title ?? '原事项已不可用'}
          </Text>
          <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>
            {meta.label} · {reminder.source ? formatSourceSchedule(reminder.source) : '来源已删除'}
          </Text>
        </Pressable>
        <View style={[styles.statusBadge, { backgroundColor: `${statusColor}18` }]}>
          <Text style={[t.caption, { color: statusColor, fontWeight: '700' }]}>{statusLabel}</Text>
        </View>
        {reminder.status === 'scheduled' && reminder.canManage ? (
          <View style={styles.cardActions}>
            <Pressable
              accessibilityLabel={`编辑提醒${reminder.source?.title ?? ''}`}
              accessibilityRole="button"
              onPress={onEdit}
              style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? c.fillStrong : c.fill }]}
            >
              <Pencil color={c.tint} size={15} />
            </Pressable>
            <Pressable
              accessibilityLabel={`取消提醒${reminder.source?.title ?? ''}`}
              accessibilityRole="button"
              onPress={onCancel}
              style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? c.redSoft : c.fill }]}
            >
              <Trash2 color={c.red} size={15} />
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={[styles.cardDetails, { borderTopColor: c.separator }]}>
        <View style={styles.detailItem}>
          <BellRing color={statusColor} size={17} />
          <View>
            <Text style={[t.caption, { color: c.secondaryLabel }]}>提醒时间</Text>
            <Text style={[t.subhead, { color: c.label, fontWeight: '700', marginTop: 2 }]}>
              {formatReminderTime(reminder.remindAt)}
            </Text>
          </View>
        </View>
        <View style={styles.recipientSummary}>
          <View style={styles.avatarStack}>
            {reminder.recipients.slice(0, 4).map((recipient, index) => (
              <View
                key={recipient.id}
                style={[
                  styles.recipientAvatar,
                  { backgroundColor: c.orangeSoft, borderColor: c.card, marginLeft: index ? -7 : 0 },
                ]}
              >
                <Text style={styles.recipientEmoji}>{recipient.member.avatarEmoji}</Text>
              </View>
            ))}
          </View>
          <Text style={[t.caption, { color: c.secondaryLabel }]}>
            {reminder.recipients.map((recipient) => recipient.member.name).join('、')}
          </Text>
        </View>
        {reminder.source ? (
          <Pressable accessibilityLabel={`打开${reminder.source.title}`} onPress={onOpen} style={styles.openButton}>
            <ChevronRight color={c.tertiaryLabel} size={18} />
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

export default function RemindersScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const params = useLocalSearchParams<{
    sourceModule?: string;
    sourceId?: string;
    occurrenceDate?: string;
    reminderId?: string;
  }>();
  const parameterSourceModule = firstParam(params.sourceModule);
  const parameterSourceId = firstParam(params.sourceId);
  const parameterOccurrenceDate = firstParam(params.occurrenceDate);
  const focusedReminderId = firstParam(params.reminderId);
  const initialSourceKey = sourceParamKey(
    parameterSourceModule,
    parameterSourceId,
    parameterOccurrenceDate,
  );
  const openedParam = useRef<string | null>(null);
  const [filter, setFilter] = useState<ReminderFilter>('scheduled');
  const [formOpen, setFormOpen] = useState(false);
  const [editingReminder, setEditingReminder] = useState<HouseholdReminder | null>(null);
  const [pendingCancel, setPendingCancel] = useState<HouseholdReminder | null>(null);
  const { data: reminders, isLoading, error } = useReminders('all');
  const { data: members } = useMembers();
  const { data: sources, isLoading: sourcesLoading } = useReminderSources(
    todayStr(),
    todayStr(370),
  );
  const cancel = useCancelReminder();

  useEffect(() => {
    if (!initialSourceKey || sourcesLoading || openedParam.current === initialSourceKey) return;
    if (!sources?.some((source) => sourceKey(source) === initialSourceKey)) return;
    openedParam.current = initialSourceKey;
    setEditingReminder(null);
    setFormOpen(true);
  }, [initialSourceKey, sources, sourcesLoading]);

  useEffect(() => {
    if (!initialSourceKey) openedParam.current = null;
  }, [initialSourceKey]);

  const closeForm = () => {
    setFormOpen(false);
    setEditingReminder(null);
    if (initialSourceKey) router.replace('/reminders');
  };

  const visibleReminders = useMemo(
    () =>
      reminders?.filter((reminder) => filter === 'all' || reminder.status === filter) ?? [],
    [filter, reminders],
  );
  const scheduledCount = reminders?.filter((reminder) => reminder.status === 'scheduled').length ?? 0;
  const sentCount = reminders?.filter((reminder) => reminder.status === 'sent').length ?? 0;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <PageContainer maxWidth={980} style={[styles.page, desktop && styles.pageDesktop]}>
        <View style={styles.pageHeader}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[t.largeTitle, { color: c.label }]}>提醒中心</Text>
            <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 4 }]}>
              {scheduledCount} 项待提醒 · {sentCount} 项已发送
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={sourcesLoading}
            onPress={() => {
              setEditingReminder(null);
              setFormOpen(true);
            }}
            style={({ pressed }) => [
              styles.addButton,
              { backgroundColor: pressed ? c.green : c.tint, opacity: sourcesLoading ? 0.55 : 1 },
            ]}
          >
            <Plus color="#FFFFFF" size={18} />
            <Text style={[t.subhead, { color: '#FFFFFF', fontWeight: '700' }]}>新建提醒</Text>
          </Pressable>
        </View>

        <View style={styles.filterWrap}>
          <Segmented<ReminderFilter>
            onChange={setFilter}
            options={[
              { label: '待提醒', value: 'scheduled' },
              { label: '已发送', value: 'sent' },
              { label: '已取消', value: 'cancelled' },
              { label: '全部', value: 'all' },
            ]}
            value={filter}
          />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {isLoading ? <ActivityIndicator color={c.tint} style={styles.loader} /> : null}
          {error ? (
            <Card>
              <EmptyState emoji="🔔" title="提醒加载失败" hint="请检查 API 服务" />
            </Card>
          ) : null}
          {!isLoading && !error && visibleReminders.length
            ? visibleReminders.map((reminder) => (
                <ReminderCard
                  focused={reminder.id === focusedReminderId}
                  key={reminder.id}
                  onCancel={() => setPendingCancel(reminder)}
                  onEdit={() => {
                    setEditingReminder(reminder);
                    setFormOpen(true);
                  }}
                  onOpen={() => {
                    if (reminder.source) router.push(reminder.source.targetPath as never);
                  }}
                  reminder={reminder}
                />
              ))
            : null}
          {!isLoading && !error && !visibleReminders.length ? (
            <Card>
              <EmptyState
                emoji="🔔"
                title={filter === 'scheduled' ? '没有待发送提醒' : '没有匹配的提醒'}
                hint="可以为菜单、任务、日程、维护和出行设置提醒"
              />
            </Card>
          ) : null}
        </ScrollView>
      </PageContainer>

      <ReminderForm
        initialSourceKey={editingReminder ? null : initialSourceKey}
        members={members ?? []}
        onClose={closeForm}
        onSaved={closeForm}
        reminder={editingReminder}
        sources={sources ?? []}
        visible={formOpen}
      />

      <ConfirmDialog
        confirmLabel="取消提醒"
        loading={cancel.isPending}
        message={`取消后不会向${pendingCancel?.recipients.map((recipient) => recipient.member.name).join('、') ?? ''}发送「${pendingCancel?.source?.title ?? '这项安排'}」的提醒。`}
        onCancel={() => {
          if (!cancel.isPending) setPendingCancel(null);
        }}
        onConfirm={() => {
          if (!pendingCancel) return;
          cancel.mutate(pendingCancel.id, {
            onSuccess: () => {
              setPendingCancel(null);
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            },
            onError: (cancelError) => {
              setPendingCancel(null);
              Alert.alert(
                '取消失败',
                cancelError instanceof Error ? cancelError.message : '请稍后再试',
              );
            },
          });
        }}
        title="取消这个提醒？"
        visible={Boolean(pendingCancel)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { flex: 1, paddingTop: 20 },
  pageDesktop: { paddingTop: 32 },
  pageHeader: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  addButton: {
    minHeight: 44,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  filterWrap: { marginTop: 20, maxWidth: 460 },
  scrollContent: { gap: 12, paddingTop: 20, paddingBottom: 100 },
  loader: { paddingVertical: 44 },
  reminderCard: { overflow: 'hidden' },
  cardTop: { minHeight: 76, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  sourceIcon: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  cardTitleWrap: { flex: 1, minWidth: 0 },
  statusBadge: { minHeight: 26, borderRadius: radius.sm, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center' },
  cardActions: { flexDirection: 'row', gap: 6 },
  iconButton: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  cardDetails: { minHeight: 68, borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 18 },
  detailItem: { flexDirection: 'row', alignItems: 'center', gap: 9, minWidth: 170 },
  recipientSummary: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatarStack: { flexDirection: 'row', paddingLeft: 7 },
  recipientAvatar: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  recipientEmoji: { fontSize: 14 },
  openButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(17, 25, 20, 0.38)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  formSheet: { width: '100%', maxWidth: 620, maxHeight: '92%', borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  formHeader: { minHeight: 76, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 12 },
  formContent: { paddingHorizontal: 20, paddingBottom: 22, gap: 20 },
  field: { gap: 8 },
  fieldLabel: { fontWeight: '700' },
  sourceFilters: { gap: 7, paddingBottom: 2 },
  filterChip: { minHeight: 34, borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  sourceList: { height: 214, borderWidth: 1, borderRadius: radius.sm, overflow: 'hidden' },
  sourceOption: { minHeight: 64, borderBottomWidth: 1, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  noSourceText: { padding: 20, textAlign: 'center' },
  sourceSummary: { minHeight: 64, borderRadius: radius.sm, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  timeInputRow: { height: 48, borderRadius: radius.sm, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 9 },
  timeInput: { flex: 1, height: 48, padding: 0 },
  memberOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  memberOption: { minHeight: 42, borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 7 },
  memberEmoji: { fontSize: 18 },
  message: { borderRadius: radius.sm, padding: 11 },
});
