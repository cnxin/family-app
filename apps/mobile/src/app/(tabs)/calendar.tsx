import * as Haptics from 'expo-haptics';
import {
  CalendarDays,
  ChevronRight,
  Clock3,
  CookingPot,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  X,
} from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
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
  CalendarMonth,
  calendarRange,
  startOfMonth,
} from '../../components/calendar-month';
import { DateSelector } from '../../components/date-selector';
import { Card, ConfirmDialog, PrimaryButton } from '../../components/ui';
import { formatPlanDate, parseDate, todayStr } from '../../lib/date';
import {
  useCalendarEntries,
  useDeleteCalendarEvent,
  useUpsertCalendarEvent,
} from '../../lib/queries';
import { radius, type as t, useTheme } from '../../lib/theme';
import type { CalendarEntry, MealType } from '../../lib/types';

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function validDate(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayStr();
}

function timeInputValue(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function localDateTime(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}

function eventTime(entry: CalendarEntry) {
  if (!entry.startsAt) return '全天';
  const format = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const start = format.format(new Date(entry.startsAt));
  return entry.endsAt
    ? `${start} - ${format.format(new Date(entry.endsAt))}`
    : start;
}

function fullDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(parseDate(value));
}

function EventForm({
  entry,
  initialDate,
  onClose,
  onSaved,
  visible,
}: {
  entry: CalendarEntry | null;
  initialDate: string;
  onClose: () => void;
  onSaved: (date: string) => void;
  visible: boolean;
}) {
  const c = useTheme();
  const save = useUpsertCalendarEvent();
  const [date, setDate] = useState(initialDate);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [timed, setTimed] = useState(false);
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('20:00');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setDate(entry?.date ?? initialDate);
    setTitle(entry?.title ?? '');
    setNote(entry?.summary ?? '');
    setTimed(Boolean(entry?.startsAt));
    setStartTime(timeInputValue(entry?.startsAt ?? null) || '18:00');
    setEndTime(timeInputValue(entry?.endsAt ?? null) || '20:00');
    setMessage(null);
  }, [entry, initialDate, visible]);

  const submit = async () => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setMessage('请填写事件名称');
      return;
    }
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (timed && (!timePattern.test(startTime) || !timePattern.test(endTime))) {
      setMessage('时间请使用 24 小时制，例如 18:30');
      return;
    }
    const startsAt = timed ? localDateTime(date, startTime) : null;
    const endsAt = timed ? localDateTime(date, endTime) : null;
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      setMessage('结束时间需要晚于开始时间');
      return;
    }

    setMessage(null);
    try {
      await save.mutateAsync({
        id: entry?.sourceId,
        date,
        startsAt,
        endsAt,
        title: normalizedTitle,
        note: note.trim() || null,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved(date);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，请稍后再试');
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={styles.modalOverlay}>
        <Pressable
          accessibilityLabel="关闭事件编辑"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.formSheet,
            { backgroundColor: c.card, borderColor: c.separator },
          ]}
        >
          <View style={styles.formHeader}>
            <View>
              <Text style={[t.title2, { color: c.label }]}>
                {entry ? '编辑家庭事件' : '新建家庭事件'}
              </Text>
              <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>
                {formatPlanDate(date)}
              </Text>
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
              <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>事件名称</Text>
              <TextInput
                accessibilityLabel="事件名称"
                maxLength={120}
                onChangeText={setTitle}
                placeholder="比如：家庭聚餐、设备维护"
                placeholderTextColor={c.tertiaryLabel}
                style={[
                  t.body,
                  styles.input,
                  { backgroundColor: c.fill, color: c.label },
                ]}
                value={title}
              />
            </View>

            <View style={styles.field}>
              <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>日期</Text>
              <DateSelector allowPast onChange={setDate} value={date} />
            </View>

            <View
              style={[
                styles.allDayRow,
                { borderColor: c.separator, backgroundColor: c.fill },
              ]}
            >
              <View style={styles.allDayLabel}>
                <Clock3 color={c.tint} size={18} />
                <View>
                  <Text style={[t.subhead, { color: c.label, fontWeight: '600' }]}>全天事件</Text>
                  <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>不显示具体时间</Text>
                </View>
              </View>
              <Switch
                accessibilityLabel="全天事件"
                onValueChange={(allDay) => setTimed(!allDay)}
                trackColor={{ false: c.fillStrong, true: c.tint }}
                value={!timed}
              />
            </View>

            {timed ? (
              <View style={styles.timeFields}>
                <View style={[styles.field, styles.timeField]}>
                  <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>开始</Text>
                  <TextInput
                    accessibilityLabel="开始时间"
                    maxLength={5}
                    onChangeText={setStartTime}
                    placeholder="18:00"
                    placeholderTextColor={c.tertiaryLabel}
                    style={[
                      t.body,
                      styles.input,
                      { backgroundColor: c.fill, color: c.label },
                    ]}
                    value={startTime}
                  />
                </View>
                <View style={[styles.field, styles.timeField]}>
                  <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>结束</Text>
                  <TextInput
                    accessibilityLabel="结束时间"
                    maxLength={5}
                    onChangeText={setEndTime}
                    placeholder="20:00"
                    placeholderTextColor={c.tertiaryLabel}
                    style={[
                      t.body,
                      styles.input,
                      { backgroundColor: c.fill, color: c.label },
                    ]}
                    value={endTime}
                  />
                </View>
              </View>
            ) : null}

            <View style={styles.field}>
              <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>备注</Text>
              <TextInput
                accessibilityLabel="事件备注"
                maxLength={1000}
                multiline
                onChangeText={setNote}
                placeholder="地点、准备事项或其他说明"
                placeholderTextColor={c.tertiaryLabel}
                style={[
                  t.body,
                  styles.noteInput,
                  { backgroundColor: c.fill, color: c.label },
                ]}
                textAlignVertical="top"
                value={note}
              />
            </View>

            {message ? (
              <Text style={[t.footnote, { color: c.red }]}>{message}</Text>
            ) : null}

            <View style={styles.formActions}>
              <Pressable
                accessibilityRole="button"
                disabled={save.isPending}
                onPress={onClose}
                style={[styles.cancelButton, { backgroundColor: c.fill }]}
              >
                <Text style={[t.headline, { color: c.label }]}>取消</Text>
              </Pressable>
              <PrimaryButton
                loading={save.isPending}
                onPress={() => void submit()}
                style={styles.saveButton}
                title={entry ? '保存修改' : '添加事件'}
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ScheduleRow({
  entry,
  onDelete,
  onEdit,
  onOpenMenu,
}: {
  entry: CalendarEntry;
  onDelete: () => void;
  onEdit: () => void;
  onOpenMenu: () => void;
}) {
  const c = useTheme();
  const isMenu = entry.module === 'menu';
  const canManage = !isMenu && Boolean(entry.metadata.canManage);

  return (
    <Pressable
      accessibilityRole={isMenu ? 'button' : undefined}
      onPress={isMenu ? onOpenMenu : undefined}
      style={({ pressed }) => [
        styles.scheduleRow,
        { borderBottomColor: c.separator },
        pressed && isMenu && { backgroundColor: c.fill },
      ]}
    >
      <View
        style={[
          styles.scheduleIcon,
          { backgroundColor: isMenu ? c.orangeSoft : c.tintSoft },
        ]}
      >
        {isMenu ? (
          <CookingPot color={c.orange} size={19} />
        ) : (
          <CalendarDays color={c.tint} size={19} />
        )}
      </View>
      <View style={styles.scheduleBody}>
        <View style={styles.scheduleTitleRow}>
          <Text
            numberOfLines={1}
            style={[t.subhead, { color: c.label, flex: 1, fontWeight: '700' }]}
          >
            {entry.title}
          </Text>
          <Text style={[t.caption, { color: c.secondaryLabel }]}>
            {isMenu ? entry.summary : eventTime(entry)}
          </Text>
        </View>
        {!isMenu && entry.summary ? (
          <Text
            numberOfLines={2}
            style={[t.footnote, { color: c.secondaryLabel, marginTop: 4 }]}
          >
            {entry.summary}
          </Text>
        ) : null}
        {!isMenu ? (
          <View style={styles.creatorRow}>
            <UserRound color={c.tertiaryLabel} size={12} />
            <Text style={[t.caption, { color: c.tertiaryLabel }]}>
              {entry.metadata.createdByName ?? '家庭成员'}创建
            </Text>
          </View>
        ) : null}
      </View>
      {isMenu ? <ChevronRight color={c.tertiaryLabel} size={18} /> : null}
      {canManage ? (
        <View style={styles.rowActions}>
          <Pressable
            accessibilityLabel={`编辑${entry.title}`}
            accessibilityRole="button"
            onPress={onEdit}
            style={({ pressed }) => [
              styles.smallIconButton,
              { backgroundColor: pressed ? c.fillStrong : c.fill },
            ]}
          >
            <Pencil color={c.tint} size={15} />
          </Pressable>
          <Pressable
            accessibilityLabel={`删除${entry.title}`}
            accessibilityRole="button"
            onPress={onDelete}
            style={({ pressed }) => [
              styles.smallIconButton,
              { backgroundColor: pressed ? c.redSoft : c.fill },
            ]}
          >
            <Trash2 color={c.red} size={15} />
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

export default function CalendarScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string; eventId?: string }>();
  const parameterDate = validDate(firstParam(params.date));
  const parameterEventId = firstParam(params.eventId);
  const [selectedDate, setSelectedDate] = useState(parameterDate);
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(parseDate(parameterDate)),
  );
  const [formOpen, setFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<CalendarEntry | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CalendarEntry | null>(null);
  const openedParameterEvent = useRef<string | null>(null);
  const range = calendarRange(visibleMonth);
  const { data: entries, isLoading } = useCalendarEntries(range.start, range.end);
  const remove = useDeleteCalendarEvent();

  useEffect(() => {
    setSelectedDate(parameterDate);
    setVisibleMonth(startOfMonth(parseDate(parameterDate)));
  }, [parameterDate]);

  useEffect(() => {
    if (!parameterEventId || openedParameterEvent.current === parameterEventId) return;
    const target = entries?.find(
      (entry) => entry.module === 'calendar' && entry.sourceId === parameterEventId,
    );
    if (!target || !target.metadata.canManage) return;
    openedParameterEvent.current = parameterEventId;
    setEditingEntry(target);
    setFormOpen(true);
  }, [entries, parameterEventId]);

  const selectedEntries = useMemo(
    () => entries?.filter((entry) => entry.date === selectedDate) ?? [],
    [entries, selectedDate],
  );

  const openCreate = () => {
    setEditingEntry(null);
    setFormOpen(true);
  };

  const openMenu = (entry: CalendarEntry) => {
    const mealType = entry.metadata.mealType as MealType | undefined;
    router.push({
      pathname: '/kitchen',
      params: { date: entry.date, ...(mealType ? { mealType } : {}) },
    });
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <PageContainer maxWidth={1100} style={styles.page}>
          <View style={styles.pageHeader}>
            <View style={styles.pageHeading}>
              <Text style={[t.title1, { color: c.label }]}>家庭日历</Text>
              <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 4 }]}>
                {fullDate(selectedDate)}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={openCreate}
              style={({ pressed }) => [
                styles.addButton,
                { backgroundColor: pressed ? c.green : c.tint },
              ]}
            >
              <Plus color="#FFFFFF" size={18} />
              <Text style={[t.subhead, { color: '#FFFFFF', fontWeight: '700' }]}>添加事件</Text>
            </Pressable>
          </View>

          <View style={[styles.main, desktop && styles.mainDesktop]}>
            <Card style={[styles.calendarCard, desktop && styles.calendarCardDesktop]}>
              <CalendarMonth
                entries={entries}
                onMonthChange={setVisibleMonth}
                onSelect={(date) => {
                  setSelectedDate(date);
                  const month = startOfMonth(parseDate(date));
                  if (month.getTime() !== visibleMonth.getTime()) {
                    setVisibleMonth(month);
                  }
                }}
                selectedDate={selectedDate}
                visibleMonth={visibleMonth}
              />
              {isLoading ? (
                <ActivityIndicator color={c.tint} style={styles.calendarLoader} />
              ) : null}
            </Card>

            <View style={styles.scheduleColumn}>
              <View style={styles.scheduleHeader}>
                <View>
                  <Text style={[t.title2, { color: c.label }]}>{fullDate(selectedDate)}</Text>
                  <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>
                    {selectedEntries.length
                      ? `${selectedEntries.length} 项安排`
                      : '暂无安排'}
                  </Text>
                </View>
              </View>

              <Card style={styles.scheduleCard}>
                {isLoading ? (
                  <ActivityIndicator color={c.tint} style={styles.scheduleLoader} />
                ) : selectedEntries.length ? (
                  selectedEntries.map((entry) => (
                    <ScheduleRow
                      entry={entry}
                      key={entry.id}
                      onDelete={() => setPendingDelete(entry)}
                      onEdit={() => {
                        setEditingEntry(entry);
                        setFormOpen(true);
                      }}
                      onOpenMenu={() => openMenu(entry)}
                    />
                  ))
                ) : (
                  <View style={styles.emptySchedule}>
                    <CalendarDays color={c.tertiaryLabel} size={28} />
                    <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 10 }]}>这天还没有安排</Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={openCreate}
                      style={styles.emptyAction}
                    >
                      <Plus color={c.tint} size={15} />
                      <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>添加家庭事件</Text>
                    </Pressable>
                  </View>
                )}
              </Card>
            </View>
          </View>
        </PageContainer>
      </ScrollView>

      <EventForm
        entry={editingEntry}
        initialDate={selectedDate}
        onClose={() => {
          setFormOpen(false);
        }}
        onSaved={(date) => {
          setFormOpen(false);
          setSelectedDate(date);
          setVisibleMonth(startOfMonth(parseDate(date)));
        }}
        visible={formOpen}
      />

      <ConfirmDialog
        confirmLabel="删除事件"
        loading={remove.isPending}
        message={`「${pendingDelete?.title ?? ''}」将从家庭日历中删除。`}
        onCancel={() => {
          if (!remove.isPending) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (!pendingDelete) return;
          remove.mutate(pendingDelete.sourceId, {
            onSuccess: () => {
              setPendingDelete(null);
              void Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              );
            },
            onError: (error) =>
              Alert.alert(
                '删除失败',
                error instanceof Error ? error.message : '请稍后再试',
              ),
          });
        }}
        title="删除这个事件？"
        visible={Boolean(pendingDelete)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { paddingTop: 22, paddingBottom: 40 },
  pageHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  pageHeading: { flex: 1, minWidth: 0 },
  addButton: {
    height: 42,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  main: { gap: 24, marginTop: 24 },
  mainDesktop: { flexDirection: 'row', alignItems: 'flex-start', gap: 28 },
  calendarCard: { padding: 14, minHeight: 370 },
  calendarCardDesktop: { flex: 1, minWidth: 0 },
  calendarLoader: { position: 'absolute', right: 18, bottom: 14 },
  scheduleColumn: { flex: 1.05, minWidth: 0 },
  scheduleHeader: { minHeight: 48, justifyContent: 'center', marginBottom: 10 },
  scheduleCard: { overflow: 'hidden', minHeight: 250 },
  scheduleLoader: { marginTop: 70 },
  scheduleRow: {
    minHeight: 76,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  scheduleIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleBody: { flex: 1, minWidth: 0 },
  scheduleTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  creatorRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  smallIconButton: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySchedule: {
    minHeight: 248,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyAction: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 10,
    paddingHorizontal: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 25, 20, 0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  formSheet: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '92%',
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  formHeader: {
    minHeight: 70,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formContent: { paddingHorizontal: 20, paddingBottom: 20, gap: 16 },
  field: { gap: 7 },
  fieldLabel: { fontWeight: '600' },
  input: { height: 46, borderRadius: radius.sm, paddingHorizontal: 12 },
  noteInput: {
    minHeight: 90,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  allDayRow: {
    minHeight: 62,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  allDayLabel: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timeFields: { flexDirection: 'row', gap: 12 },
  timeField: { flex: 1, minWidth: 0 },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelButton: {
    flex: 1,
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButton: { flex: 1 },
});
