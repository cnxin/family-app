import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  BellPlus,
  Check,
  Circle,
  CircleDollarSign,
  Pencil,
  Plus,
  Repeat2,
  RotateCcw,
  SkipForward,
  Trash2,
  UserRound,
  X,
} from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
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
  useArchiveTask,
  useMembers,
  useTasks,
  useUpdateTaskOccurrence,
  useUpsertTask,
} from '../../lib/queries';
import { useSession } from '../../lib/session';
import { radius, type as t, useTheme } from '../../lib/theme';
import type {
  Member,
  TaskInstanceStatus,
  TaskOccurrence,
  TaskRecurrence,
} from '../../lib/types';

type TaskFilter = 'pending' | 'done' | 'all';
type TaskScope = 'all' | 'mine';

const RECURRENCE_LABELS: Record<TaskRecurrence, string> = {
  once: '一次',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function validDate(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayStr();
}

function addDays(value: string, amount: number) {
  const date = parseDate(value);
  date.setDate(date.getDate() + amount);
  return dateStr(date);
}

function recurrenceLabel(task: TaskOccurrence['task']) {
  if (task.recurrence === 'once') return '一次性';
  const unit = RECURRENCE_LABELS[task.recurrence];
  return task.repeatInterval === 1
    ? unit
    : `每 ${task.repeatInterval} ${task.recurrence === 'daily' ? '天' : task.recurrence === 'weekly' ? '周' : '个月'}`;
}

function TaskForm({
  canManagePoints,
  entry,
  initialDate,
  members,
  onClose,
  onSaved,
  visible,
}: {
  canManagePoints: boolean;
  entry: TaskOccurrence | null;
  initialDate: string;
  members: Member[];
  onClose: () => void;
  onSaved: (date: string) => void;
  visible: boolean;
}) {
  const c = useTheme();
  const save = useUpsertTask();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [startsOn, setStartsOn] = useState(initialDate);
  const [recurrence, setRecurrence] = useState<TaskRecurrence>('once');
  const [repeatInterval, setRepeatInterval] = useState('1');
  const [hasEnd, setHasEnd] = useState(false);
  const [endsOn, setEndsOn] = useState(addDays(initialDate, 30));
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [rewardPoints, setRewardPoints] = useState('0');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const task = entry?.task;
    const date = task?.startsOn ?? initialDate;
    setTitle(task?.title ?? '');
    setNote(task?.note ?? '');
    setStartsOn(date);
    setRecurrence(task?.recurrence ?? 'once');
    setRepeatInterval(String(task?.repeatInterval ?? 1));
    setHasEnd(Boolean(task?.endsOn));
    setEndsOn(task?.endsOn ?? addDays(date, 30));
    setAssigneeId(task?.defaultAssigneeId ?? null);
    setRewardPoints(String(task?.rewardPoints ?? 0));
    setMessage(null);
  }, [entry, initialDate, visible]);

  const submit = async () => {
    const normalizedTitle = title.trim();
    const interval = Number(repeatInterval);
    const points = Number(rewardPoints);
    if (!normalizedTitle) {
      setMessage('请填写任务名称');
      return;
    }
    if (!Number.isInteger(interval) || interval < 1 || interval > 365) {
      setMessage('重复间隔需要是 1 到 365 的整数');
      return;
    }
    if (
      canManagePoints &&
      (!Number.isInteger(points) || points < 0 || points > 10000)
    ) {
      setMessage('任务积分需要是 0 到 10000 的整数');
      return;
    }
    if (recurrence !== 'once' && hasEnd && endsOn < startsOn) {
      setMessage('结束日期不能早于开始日期');
      return;
    }
    setMessage(null);
    try {
      await save.mutateAsync({
        id: entry?.taskId,
        title: normalizedTitle,
        note: note.trim() || null,
        startsOn,
        recurrence,
        repeatInterval: interval,
        endsOn: recurrence !== 'once' && hasEnd ? endsOn : null,
        defaultAssigneeId: assigneeId,
        ...(canManagePoints ? { rewardPoints: points } : {}),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved(startsOn);
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
          accessibilityLabel="关闭任务编辑"
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
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.title2, { color: c.label }]}>
                {entry ? '编辑家庭任务' : '新建家庭任务'}
              </Text>
              <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>
                {formatPlanDate(startsOn)}开始
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
              <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>任务名称</Text>
              <TextInput
                accessibilityLabel="任务名称"
                maxLength={120}
                onChangeText={setTitle}
                placeholder="比如：换床单、给绿植浇水"
                placeholderTextColor={c.tertiaryLabel}
                style={[t.body, styles.input, { backgroundColor: c.fill, color: c.label }]}
                value={title}
              />
            </View>

            <View style={styles.field}>
              <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>开始日期</Text>
              <DateSelector allowPast onChange={setStartsOn} value={startsOn} />
            </View>

            <View style={styles.field}>
              <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>重复</Text>
              <Segmented<TaskRecurrence>
                onChange={setRecurrence}
                options={[
                  { label: '一次', value: 'once' },
                  { label: '每天', value: 'daily' },
                  { label: '每周', value: 'weekly' },
                  { label: '每月', value: 'monthly' },
                ]}
                value={recurrence}
              />
            </View>

            {recurrence !== 'once' ? (
              <>
                <View style={styles.field}>
                  <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>重复间隔</Text>
                  <View style={[styles.intervalRow, { backgroundColor: c.fill }]}>
                    <Text style={[t.subhead, { color: c.secondaryLabel }]}>每</Text>
                    <TextInput
                      accessibilityLabel="重复间隔"
                      inputMode="numeric"
                      maxLength={3}
                      onChangeText={setRepeatInterval}
                      style={[t.body, styles.intervalInput, { backgroundColor: c.card, color: c.label }]}
                      value={repeatInterval}
                    />
                    <Text style={[t.subhead, { color: c.secondaryLabel }]}>
                      {recurrence === 'daily' ? '天' : recurrence === 'weekly' ? '周' : '个月'}
                    </Text>
                  </View>
                </View>
                <View style={[styles.endRow, { backgroundColor: c.fill, borderColor: c.separator }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[t.subhead, { color: c.label, fontWeight: '600' }]}>设置结束日期</Text>
                    <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>关闭时持续重复</Text>
                  </View>
                  <Switch
                    accessibilityLabel="设置任务结束日期"
                    onValueChange={setHasEnd}
                    trackColor={{ false: c.fillStrong, true: c.tintSoft }}
                    thumbColor={hasEnd ? c.tint : c.tertiaryLabel}
                    value={hasEnd}
                  />
                </View>
                {hasEnd ? (
                  <View style={styles.field}>
                    <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>结束日期</Text>
                    <DateSelector allowPast onChange={setEndsOn} value={endsOn} />
                  </View>
                ) : null}
              </>
            ) : null}

            <View style={styles.field}>
              <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>默认负责人</Text>
              <View style={styles.memberOptions}>
                <MemberOption
                  active={assigneeId == null}
                  label="不指定"
                  onPress={() => setAssigneeId(null)}
                />
                {members.map((member) => (
                  <MemberOption
                    active={assigneeId === member.id}
                    emoji={member.avatarEmoji}
                    key={member.id}
                    label={member.name}
                    onPress={() => setAssigneeId(member.id)}
                  />
                ))}
              </View>
            </View>

            {canManagePoints ? (
              <View style={styles.field}>
                <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>完成积分</Text>
                <TextInput
                  accessibilityLabel="任务完成积分"
                  inputMode="numeric"
                  maxLength={5}
                  onChangeText={setRewardPoints}
                  placeholder="0"
                  placeholderTextColor={c.tertiaryLabel}
                  style={[t.body, styles.input, { backgroundColor: c.fill, color: c.label }]}
                  value={rewardPoints}
                />
                <Text style={[t.caption, { color: c.secondaryLabel }]}>设为 0 时不发放积分；恢复已完成任务会冲销本次积分。</Text>
              </View>
            ) : null}

            <View style={styles.field}>
              <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>备注</Text>
              <TextInput
                accessibilityLabel="任务备注"
                maxLength={1000}
                multiline
                onChangeText={setNote}
                placeholder="完成标准、物品位置或注意事项"
                placeholderTextColor={c.tertiaryLabel}
                style={[t.body, styles.noteInput, { backgroundColor: c.fill, color: c.label }]}
                textAlignVertical="top"
                value={note}
              />
            </View>

            {message ? <Text style={[t.footnote, { color: c.red }]}>{message}</Text> : null}

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
                title={entry ? '保存修改' : '添加任务'}
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function MemberOption({
  active,
  emoji,
  label,
  onPress,
}: {
  active: boolean;
  emoji?: string;
  label: string;
  onPress: () => void;
}) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.memberOption,
        {
          backgroundColor: active ? c.tintSoft : pressed ? c.fill : c.card,
          borderColor: active ? c.tint : c.separator,
        },
      ]}
    >
      {emoji ? <Text>{emoji}</Text> : <UserRound color={active ? c.tint : c.secondaryLabel} size={16} />}
      <Text style={[t.footnote, { color: active ? c.tint : c.label, fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  );
}

function TaskRow({
  entry,
  focused,
  memberId,
  onArchive,
  onAssign,
  onEdit,
  onRemind,
  onStatus,
}: {
  entry: TaskOccurrence;
  focused: boolean;
  memberId: string | undefined;
  onArchive: () => void;
  onAssign: (memberId: string | null) => void;
  onEdit: () => void;
  onRemind: () => void;
  onStatus: (status: TaskInstanceStatus) => void;
}) {
  const c = useTheme();
  const completed = entry.status === 'done';
  const skipped = entry.status === 'skipped';
  const pending = entry.status === 'pending';
  return (
    <View
      style={[
        styles.taskRow,
        { borderBottomColor: c.separator },
        focused && { backgroundColor: c.tintSoft },
      ]}
    >
      <Pressable
        accessibilityLabel={completed ? `恢复${entry.task.title}` : `完成${entry.task.title}`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: completed, disabled: !entry.canUpdate }}
        disabled={!entry.canUpdate}
        onPress={() => onStatus(completed || skipped ? 'pending' : 'done')}
        style={styles.checkButton}
      >
        {completed ? (
          <View style={[styles.checkedCircle, { backgroundColor: c.tint }]}>
            <Check color="#FFFFFF" size={17} strokeWidth={3} />
          </View>
        ) : skipped ? (
          <View style={[styles.skippedCircle, { borderColor: c.orange }]}>
            <SkipForward color={c.orange} size={14} />
          </View>
        ) : (
          <Circle color={entry.canUpdate ? c.tint : c.tertiaryLabel} size={25} />
        )}
      </Pressable>

      <View style={styles.taskBody}>
        <Text
          numberOfLines={2}
          style={[
            t.body,
            styles.taskTitle,
            {
              color: completed || skipped ? c.secondaryLabel : c.label,
              textDecorationLine: completed ? 'line-through' : 'none',
            },
          ]}
        >
          {entry.task.title}
        </Text>
        <View style={styles.taskMeta}>
          <Repeat2 color={c.tertiaryLabel} size={13} />
          <Text style={[t.caption, { color: c.secondaryLabel }]}>{recurrenceLabel(entry.task)}</Text>
          <Text style={[t.caption, { color: c.tertiaryLabel }]}>·</Text>
          <UserRound color={c.tertiaryLabel} size={13} />
          <Text style={[t.caption, { color: c.secondaryLabel }]}>
            {entry.assignee?.name ?? '全家可做'}
          </Text>
          {entry.task.rewardPoints > 0 ? (
            <>
              <Text style={[t.caption, { color: c.tertiaryLabel }]}>·</Text>
              <CircleDollarSign color={entry.pointsAwarded ? c.green : c.orange} size={13} />
              <Text style={[t.caption, { color: entry.pointsAwarded ? c.green : c.orange }]}>
                {entry.pointsAwarded ? '已发' : '完成'} +{entry.task.rewardPoints}
              </Text>
            </>
          ) : null}
        </View>
        {entry.task.note ? (
          <Text numberOfLines={2} style={[t.footnote, { color: c.secondaryLabel, marginTop: 5 }]}>
            {entry.task.note}
          </Text>
        ) : null}
        {pending && !entry.assigneeId && memberId ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onAssign(memberId)}
            style={styles.claimButton}
          >
            <Text style={[t.caption, { color: c.tint, fontWeight: '700' }]}>由我认领</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.taskActions}>
        {pending && entry.dueDate >= todayStr() ? (
          <Pressable
            accessibilityLabel={`提醒${entry.task.title}`}
            accessibilityRole="button"
            onPress={onRemind}
            style={({ pressed }) => [
              styles.smallIconButton,
              { backgroundColor: pressed ? c.tintSoft : c.fill },
            ]}
          >
            <BellPlus color={c.tint} size={15} />
          </Pressable>
        ) : null}
        {pending && entry.canUpdate ? (
          <Pressable
            accessibilityLabel={`跳过${entry.task.title}`}
            accessibilityRole="button"
            onPress={() => onStatus('skipped')}
            style={({ pressed }) => [
              styles.smallIconButton,
              { backgroundColor: pressed ? c.orangeSoft : c.fill },
            ]}
          >
            <SkipForward color={c.orange} size={16} />
          </Pressable>
        ) : null}
        {(completed || skipped) && entry.canUpdate ? (
          <Pressable
            accessibilityLabel={`恢复${entry.task.title}`}
            accessibilityRole="button"
            onPress={() => onStatus('pending')}
            style={({ pressed }) => [
              styles.smallIconButton,
              { backgroundColor: pressed ? c.tintSoft : c.fill },
            ]}
          >
            <RotateCcw color={c.tint} size={15} />
          </Pressable>
        ) : null}
        {entry.canManageTask ? (
          <>
            <Pressable
              accessibilityLabel={`编辑${entry.task.title}`}
              accessibilityRole="button"
              onPress={onEdit}
              style={({ pressed }) => [
                styles.smallIconButton,
                { backgroundColor: pressed ? c.tintSoft : c.fill },
              ]}
            >
              <Pencil color={c.tint} size={15} />
            </Pressable>
            <Pressable
              accessibilityLabel={`停用${entry.task.title}`}
              accessibilityRole="button"
              onPress={onArchive}
              style={({ pressed }) => [
                styles.smallIconButton,
                { backgroundColor: pressed ? c.redSoft : c.fill },
              ]}
            >
              <Trash2 color={c.red} size={15} />
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

export default function TasksScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string; taskId?: string }>();
  const parameterDate = validDate(firstParam(params.date));
  const parameterTaskId = firstParam(params.taskId);
  const { member } = useSession();
  const [selectedDate, setSelectedDate] = useState(parameterDate);
  const [filter, setFilter] = useState<TaskFilter>('pending');
  const [scope, setScope] = useState<TaskScope>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TaskOccurrence | null>(null);
  const [pendingArchive, setPendingArchive] = useState<TaskOccurrence | null>(null);
  const { data: members } = useMembers();
  const { data: tasks, isLoading, error } = useTasks(selectedDate, selectedDate);
  const updateOccurrence = useUpdateTaskOccurrence();
  const archive = useArchiveTask();

  useEffect(() => setSelectedDate(parameterDate), [parameterDate]);

  const visibleTasks = useMemo(
    () =>
      (tasks ?? []).filter((entry) => {
        if (
          scope === 'mine' &&
          entry.assigneeId !== member?.id &&
          entry.task.createdById !== member?.id
        ) {
          return false;
        }
        if (filter === 'pending') return entry.status === 'pending';
        if (filter === 'done') return entry.status !== 'pending';
        return true;
      }),
    [filter, member?.id, scope, tasks],
  );
  const pendingCount = tasks?.filter((entry) => entry.status === 'pending').length ?? 0;
  const doneCount = tasks?.filter((entry) => entry.status === 'done').length ?? 0;

  const changeOccurrence = (
    entry: TaskOccurrence,
    input: { status?: TaskInstanceStatus; assigneeId?: string | null },
  ) => {
    updateOccurrence.mutate(
      { taskId: entry.taskId, dueDate: entry.dueDate, ...input },
      {
        onSuccess: () =>
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
        onError: (updateError) =>
          Alert.alert(
            '更新失败',
            updateError instanceof Error ? updateError.message : '请稍后再试',
          ),
      },
    );
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <PageContainer maxWidth={1050} style={[styles.page, desktop && styles.pageDesktop]}>
        <View style={styles.pageHeader}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[t.largeTitle, { color: c.label }]}>家庭任务</Text>
            <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 4 }]}>
              {formatPlanDate(selectedDate)} · {pendingCount} 项待办 · {doneCount} 项完成
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setEditingEntry(null);
              setFormOpen(true);
            }}
            style={({ pressed }) => [
              styles.addButton,
              { backgroundColor: pressed ? c.green : c.tint },
            ]}
          >
            <Plus color="#FFFFFF" size={18} />
            <Text style={[t.subhead, { color: '#FFFFFF', fontWeight: '700' }]}>添加任务</Text>
          </Pressable>
        </View>

        <View style={[styles.toolbar, desktop && styles.toolbarDesktop]}>
          <DateSelector allowPast onChange={setSelectedDate} value={selectedDate} />
          <View style={styles.filters}>
            <View style={styles.scopeFilter}>
              <Segmented<TaskScope>
                onChange={setScope}
                options={[
                  { label: '全家', value: 'all' },
                  { label: '与我相关', value: 'mine' },
                ]}
                value={scope}
              />
            </View>
            <View style={styles.statusFilter}>
              <Segmented<TaskFilter>
                onChange={setFilter}
                options={[
                  { label: '待办', value: 'pending' },
                  { label: '已处理', value: 'done' },
                  { label: '全部', value: 'all' },
                ]}
                value={filter}
              />
            </View>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Card style={styles.taskList}>
            {isLoading ? <ActivityIndicator color={c.tint} style={styles.loader} /> : null}
            {error ? (
              <EmptyState emoji="📋" title="任务加载失败" hint="请检查 API 服务" />
            ) : null}
            {!isLoading && !error && visibleTasks.length ? (
              visibleTasks.map((entry) => (
                <TaskRow
                  entry={entry}
                  focused={entry.taskId === parameterTaskId}
                  key={entry.id}
                  memberId={member?.id}
                  onArchive={() => setPendingArchive(entry)}
                  onAssign={(assigneeId) => changeOccurrence(entry, { assigneeId })}
                  onEdit={() => {
                    setEditingEntry(entry);
                    setFormOpen(true);
                  }}
                  onRemind={() =>
                    router.push({
                      pathname: '/reminders',
                      params: {
                        sourceModule: 'task',
                        sourceId: entry.taskId,
                        occurrenceDate: entry.dueDate,
                      },
                    })
                  }
                  onStatus={(status) => changeOccurrence(entry, { status })}
                />
              ))
            ) : null}
            {!isLoading && !error && !visibleTasks.length ? (
              <EmptyState
                emoji="✅"
                title={filter === 'pending' ? '这天没有待办任务' : '没有匹配的任务'}
                hint="可以提前安排家务、维护或采购准备"
              />
            ) : null}
          </Card>
        </ScrollView>
      </PageContainer>

      <TaskForm
        canManagePoints={member?.role === 'owner' || member?.role === 'admin'}
        entry={editingEntry}
        initialDate={selectedDate}
        members={members ?? []}
        onClose={() => setFormOpen(false)}
        onSaved={(date) => {
          setFormOpen(false);
          setSelectedDate(date);
        }}
        visible={formOpen}
      />

      <ConfirmDialog
        confirmLabel="停用任务"
        loading={archive.isPending}
        message={`「${pendingArchive?.task.title ?? ''}」之后将不再出现在任务和日历中，已经记录的完成实例仍保留在数据库。`}
        onCancel={() => {
          if (!archive.isPending) setPendingArchive(null);
        }}
        onConfirm={() => {
          if (!pendingArchive) return;
          archive.mutate(pendingArchive.taskId, {
            onSuccess: () => {
              setPendingArchive(null);
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            },
            onError: (archiveError) =>
              Alert.alert(
                '停用失败',
                archiveError instanceof Error ? archiveError.message : '请稍后再试',
              ),
          });
        }}
        title="停用这个任务？"
        visible={Boolean(pendingArchive)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { flex: 1, paddingTop: 18 },
  pageDesktop: { paddingTop: 30 },
  pageHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  addButton: {
    height: 42,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  toolbar: { gap: 12, marginTop: 20 },
  toolbarDesktop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  filters: { flexDirection: 'row', gap: 10, minWidth: 0 },
  scopeFilter: { width: 190 },
  statusFilter: { width: 250 },
  scrollContent: { paddingTop: 18, paddingBottom: 40 },
  taskList: { overflow: 'hidden', minHeight: 280 },
  loader: { marginTop: 80 },
  taskRow: {
    minHeight: 94,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  checkButton: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
  checkedCircle: {
    width: 25,
    height: 25,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skippedCircle: {
    width: 25,
    height: 25,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskBody: { flex: 1, minWidth: 0 },
  taskTitle: { fontWeight: '600', lineHeight: 22 },
  taskMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: 5 },
  claimButton: { alignSelf: 'flex-start', minHeight: 30, justifyContent: 'center', marginTop: 4 },
  taskActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 5, maxWidth: 76 },
  smallIconButton: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
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
    maxWidth: 560,
    maxHeight: '94%',
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
    gap: 10,
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
    minHeight: 86,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  intervalRow: {
    minHeight: 50,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  intervalInput: {
    width: 64,
    height: 36,
    borderRadius: radius.sm,
    textAlign: 'center',
  },
  endRow: {
    minHeight: 62,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  memberOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  memberOption: {
    minHeight: 38,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
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
