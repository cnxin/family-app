import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import {
  Check,
  Clock3,
  LockKeyhole,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  UserRound,
  Vote,
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
import { dateStr, parseDate, todayStr } from '../../lib/date';
import {
  useArchivePoll,
  usePolls,
  useSetPollStatus,
  useUpsertPoll,
  useVotePoll,
} from '../../lib/queries';
import { radius, type as t, useTheme } from '../../lib/theme';
import type {
  HouseholdPoll,
  PollCategory,
  PollStatus,
  PollVoteMode,
} from '../../lib/types';

type PollFilter = PollStatus | 'all';
type PendingAction = { type: 'close' | 'archive'; poll: HouseholdPoll } | null;

const CATEGORY_LABELS: Record<PollCategory, string> = {
  general: '家庭',
  meal: '吃什么',
  activity: '活动',
  movie: '观影',
  shopping: '采购',
};

const CATEGORY_EMOJI: Record<PollCategory, string> = {
  general: '🏠',
  meal: '🍽️',
  activity: '🎯',
  movie: '🎬',
  shopping: '🛒',
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function addDays(value: string, amount: number) {
  const date = parseDate(value);
  date.setDate(date.getDate() + amount);
  return dateStr(date);
}

function deadlineParts(value: string | null) {
  const date = value ? new Date(value) : new Date();
  if (!value) date.setDate(date.getDate() + 2);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return { date: dateStr(date), time: value ? `${hours}:${minutes}` : '20:00' };
}

function toDeadline(dateValue: string, timeValue: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeValue)) return null;
  const [hours, minutes] = timeValue.split(':').map(Number);
  const date = parseDate(dateValue);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function formatDeadline(value: string | null) {
  if (!value) return '不设截止';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function sameSelection(left: string[], right: string[]) {
  return [...left].sort().join(',') === [...right].sort().join(',');
}

function PollForm({
  poll,
  visible,
  onClose,
  onSaved,
}: {
  poll: HouseholdPoll | null;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const c = useTheme();
  const save = useUpsertPoll();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<PollCategory>('general');
  const [voteMode, setVoteMode] = useState<PollVoteMode>('single');
  const [maxChoices, setMaxChoices] = useState('2');
  const [hasDeadline, setHasDeadline] = useState(false);
  const [closesOn, setClosesOn] = useState(addDays(todayStr(), 2));
  const [closesTime, setClosesTime] = useState('20:00');
  const [options, setOptions] = useState(['', '']);
  const [message, setMessage] = useState<string | null>(null);
  const rulesLocked = Boolean(poll?.totalVotes);

  useEffect(() => {
    if (!visible) return;
    const deadline = deadlineParts(poll?.closesAt ?? null);
    setTitle(poll?.title ?? '');
    setDescription(poll?.description ?? '');
    setCategory(poll?.category ?? 'general');
    setVoteMode(poll?.voteMode ?? 'single');
    setMaxChoices(String(poll?.maxChoices ?? 2));
    setHasDeadline(Boolean(poll?.closesAt));
    setClosesOn(deadline.date);
    setClosesTime(deadline.time);
    setOptions(poll?.options.map((option) => option.label) ?? ['', '']);
    setMessage(null);
  }, [poll, visible]);

  const updateOption = (index: number, value: string) => {
    setOptions((current) =>
      current.map((option, optionIndex) => (optionIndex === index ? value : option)),
    );
  };

  const submit = async () => {
    const normalizedTitle = title.trim();
    const normalizedOptions = options.map((option) => option.trim()).filter(Boolean);
    const max = voteMode === 'single' ? 1 : Number(maxChoices);
    if (!normalizedTitle) {
      setMessage('请填写投票标题');
      return;
    }
    if (normalizedOptions.length < 2) {
      setMessage('至少需要两个候选项');
      return;
    }
    if (new Set(normalizedOptions.map((option) => option.toLocaleLowerCase('zh-CN'))).size !== normalizedOptions.length) {
      setMessage('候选项不能重复');
      return;
    }
    if (voteMode === 'multiple' && (!Number.isInteger(max) || max < 2 || max > normalizedOptions.length)) {
      setMessage('多选数量需要在 2 和候选项总数之间');
      return;
    }
    const deadline = hasDeadline ? toDeadline(closesOn, closesTime) : null;
    if (hasDeadline && !deadline) {
      setMessage('时间请使用 HH:mm 格式');
      return;
    }
    if (deadline && deadline.getTime() <= Date.now()) {
      setMessage('截止时间必须晚于当前时间');
      return;
    }

    setMessage(null);
    try {
      await save.mutateAsync({
        id: poll?.id,
        title: normalizedTitle,
        description: description.trim() || null,
        category,
        closesAt: deadline?.toISOString() ?? null,
        ...(!rulesLocked
          ? {
              voteMode,
              maxChoices: max,
              options: normalizedOptions.map((label) => ({ label })),
            }
          : {}),
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
          accessibilityLabel="关闭投票编辑"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.formSheet, { backgroundColor: c.card, borderColor: c.separator }]}>
          <View style={styles.formHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.title2, { color: c.label }]}>
                {poll ? '编辑家庭投票' : '发起家庭投票'}
              </Text>
              <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>
                {poll ? `${poll.totalVoters} 人已经参与` : '家庭成员都可以参与选择'}
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
              <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>投票标题</Text>
              <TextInput
                accessibilityLabel="投票标题"
                maxLength={120}
                onChangeText={setTitle}
                placeholder="比如：周末去哪儿"
                placeholderTextColor={c.tertiaryLabel}
                style={[t.body, styles.input, { backgroundColor: c.fill, color: c.label }]}
                value={title}
              />
            </View>

            <View style={styles.field}>
              <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>分类</Text>
              <Segmented<PollCategory>
                onChange={setCategory}
                options={[
                  { label: '家庭', value: 'general' },
                  { label: '吃什么', value: 'meal' },
                  { label: '活动', value: 'activity' },
                  { label: '观影', value: 'movie' },
                  { label: '采购', value: 'shopping' },
                ]}
                value={category}
              />
            </View>

            <View style={styles.field}>
              <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>补充说明</Text>
              <TextInput
                accessibilityLabel="投票说明"
                maxLength={1000}
                multiline
                onChangeText={setDescription}
                placeholder="预算、时间或需要一起考虑的条件"
                placeholderTextColor={c.tertiaryLabel}
                style={[t.body, styles.descriptionInput, { backgroundColor: c.fill, color: c.label }]}
                textAlignVertical="top"
                value={description}
              />
            </View>

            <View style={styles.field}>
              <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>选择规则</Text>
              {rulesLocked ? (
                <View style={[styles.lockedRule, { backgroundColor: c.fill }]}>
                  <LockKeyhole color={c.secondaryLabel} size={16} />
                  <Text style={[t.subhead, { color: c.secondaryLabel }]}>
                    {poll?.voteMode === 'single' ? '单选' : `多选，最多 ${poll?.maxChoices} 项`}
                  </Text>
                </View>
              ) : (
                <Segmented<PollVoteMode>
                  onChange={(value) => {
                    setVoteMode(value);
                    if (value === 'single') setMaxChoices('1');
                    else if (Number(maxChoices) < 2) setMaxChoices('2');
                  }}
                  options={[
                    { label: '单选', value: 'single' },
                    { label: '多选', value: 'multiple' },
                  ]}
                  value={voteMode}
                />
              )}
            </View>

            {!rulesLocked && voteMode === 'multiple' ? (
              <View style={styles.field}>
                <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>最多选择</Text>
                <View style={[styles.maxChoicesRow, { backgroundColor: c.fill }]}>
                  <TextInput
                    accessibilityLabel="最多选择数"
                    inputMode="numeric"
                    maxLength={2}
                    onChangeText={setMaxChoices}
                    style={[t.body, styles.numberInput, { backgroundColor: c.card, color: c.label }]}
                    value={maxChoices}
                  />
                  <Text style={[t.subhead, { color: c.secondaryLabel }]}>项</Text>
                </View>
              </View>
            ) : null}

            <View style={styles.field}>
              <View style={styles.optionsHeader}>
                <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>候选项</Text>
                {!rulesLocked && options.length < 12 ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setOptions((current) => [...current, ''])}
                    style={styles.addOptionButton}
                  >
                    <Plus color={c.tint} size={16} />
                    <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>添加选项</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.optionInputs}>
                {options.map((option, index) => (
                  <View key={`option-${index}`} style={styles.optionInputRow}>
                    <TextInput
                      accessibilityLabel={`候选项${index + 1}`}
                      editable={!rulesLocked}
                      maxLength={120}
                      onChangeText={(value) => updateOption(index, value)}
                      placeholder={`候选项 ${index + 1}`}
                      placeholderTextColor={c.tertiaryLabel}
                      style={[
                        t.body,
                        styles.optionInput,
                        { backgroundColor: c.fill, color: rulesLocked ? c.secondaryLabel : c.label },
                      ]}
                      value={option}
                    />
                    {!rulesLocked ? (
                      <Pressable
                        accessibilityLabel={`删除候选项${index + 1}`}
                        accessibilityRole="button"
                        disabled={options.length <= 2}
                        onPress={() =>
                          setOptions((current) => current.filter((_, optionIndex) => optionIndex !== index))
                        }
                        style={({ pressed }) => [
                          styles.removeOptionButton,
                          { backgroundColor: pressed ? c.redSoft : c.fill },
                          options.length <= 2 && { opacity: 0.35 },
                        ]}
                      >
                        <Trash2 color={c.red} size={16} />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>

            <View style={[styles.deadlineRow, { backgroundColor: c.fill, borderColor: c.separator }]}>
              <View style={{ flex: 1 }}>
                <Text style={[t.subhead, { color: c.label, fontWeight: '600' }]}>设置截止时间</Text>
                <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>关闭时可以手动结束</Text>
              </View>
              <Switch
                accessibilityLabel="设置投票截止时间"
                onValueChange={setHasDeadline}
                trackColor={{ false: c.fillStrong, true: c.tintSoft }}
                thumbColor={hasDeadline ? c.tint : c.tertiaryLabel}
                value={hasDeadline}
              />
            </View>

            {hasDeadline ? (
              <View style={styles.deadlineFields}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel, marginBottom: 7 }]}>截止日期</Text>
                  <DateSelector onChange={setClosesOn} value={closesOn} />
                </View>
                <View style={{ width: 112 }}>
                  <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel, marginBottom: 7 }]}>截止时间</Text>
                  <TextInput
                    accessibilityLabel="截止时间"
                    maxLength={5}
                    onChangeText={setClosesTime}
                    placeholder="20:00"
                    placeholderTextColor={c.tertiaryLabel}
                    style={[t.body, styles.timeInput, { backgroundColor: c.fill, color: c.label }]}
                    value={closesTime}
                  />
                </View>
              </View>
            ) : null}

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
                title={poll ? '保存修改' : '发起投票'}
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function PollCard({
  poll,
  focused,
  onArchive,
  onClose,
  onEdit,
  onReopen,
}: {
  poll: HouseholdPoll;
  focused: boolean;
  onArchive: () => void;
  onClose: () => void;
  onEdit: () => void;
  onReopen: () => void;
}) {
  const c = useTheme();
  const vote = useVotePoll();
  const [selected, setSelected] = useState(poll.selectedOptionIds);

  useEffect(() => setSelected(poll.selectedOptionIds), [poll.selectedOptionIds]);

  const toggle = (optionId: string) => {
    if (!poll.canVote) return;
    setSelected((current) => {
      if (poll.voteMode === 'single') return current.includes(optionId) ? [] : [optionId];
      if (current.includes(optionId)) return current.filter((id) => id !== optionId);
      if (current.length >= poll.maxChoices) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return current;
      }
      return [...current, optionId];
    });
  };

  const changed = !sameSelection(selected, poll.selectedOptionIds);
  const submitVote = () => {
    vote.mutate(
      { id: poll.id, optionIds: selected },
      {
        onSuccess: () =>
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
        onError: (error) =>
          Alert.alert('投票失败', error instanceof Error ? error.message : '请稍后再试'),
      },
    );
  };

  return (
    <Card
      style={[
        styles.pollCard,
        focused && { borderColor: c.tint, borderWidth: 2 },
      ]}
    >
      <View style={styles.pollHeader}>
        <View style={[styles.categoryIcon, { backgroundColor: c.accentSoft }]}>
          <Text style={styles.categoryEmoji}>{CATEGORY_EMOJI[poll.category]}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.pollTitleRow}>
            <Text numberOfLines={2} style={[t.headline, { color: c.label, flex: 1 }]}>
              {poll.title}
            </Text>
            <View
              style={[
                styles.statusPill,
                { backgroundColor: poll.status === 'open' ? c.tintSoft : c.fill },
              ]}
            >
              <Text
                style={[
                  t.caption,
                  {
                    color: poll.status === 'open' ? c.tint : c.secondaryLabel,
                    fontWeight: '700',
                  },
                ]}
              >
                {poll.status === 'open' ? '进行中' : '已结束'}
              </Text>
            </View>
          </View>
          <View style={styles.pollMeta}>
            <Text style={[t.caption, { color: c.secondaryLabel }]}>
              {CATEGORY_LABELS[poll.category]}
            </Text>
            <Text style={[t.caption, { color: c.tertiaryLabel }]}>·</Text>
            <Text style={[t.caption, { color: c.secondaryLabel }]}>
              {poll.voteMode === 'single' ? '单选' : `最多选 ${poll.maxChoices} 项`}
            </Text>
            <Text style={[t.caption, { color: c.tertiaryLabel }]}>·</Text>
            <UserRound color={c.tertiaryLabel} size={12} />
            <Text style={[t.caption, { color: c.secondaryLabel }]}>{poll.createdBy.name}</Text>
          </View>
        </View>
        {poll.canManage ? (
          <View style={styles.manageActions}>
            <Pressable
              accessibilityLabel={`编辑投票${poll.title}`}
              accessibilityRole="button"
              onPress={onEdit}
              style={({ pressed }) => [
                styles.smallIconButton,
                { backgroundColor: pressed ? c.tintSoft : c.fill },
              ]}
            >
              <Pencil color={c.tint} size={15} />
            </Pressable>
            {poll.status === 'open' ? (
              <Pressable
                accessibilityLabel={`结束投票${poll.title}`}
                accessibilityRole="button"
                onPress={onClose}
                style={({ pressed }) => [
                  styles.smallIconButton,
                  { backgroundColor: pressed ? c.orangeSoft : c.fill },
                ]}
              >
                <LockKeyhole color={c.orange} size={15} />
              </Pressable>
            ) : (
              <Pressable
                accessibilityLabel={`重新开启投票${poll.title}`}
                accessibilityRole="button"
                onPress={onReopen}
                style={({ pressed }) => [
                  styles.smallIconButton,
                  { backgroundColor: pressed ? c.tintSoft : c.fill },
                ]}
              >
                <RotateCcw color={c.tint} size={15} />
              </Pressable>
            )}
            <Pressable
              accessibilityLabel={`删除投票${poll.title}`}
              accessibilityRole="button"
              onPress={onArchive}
              style={({ pressed }) => [
                styles.smallIconButton,
                { backgroundColor: pressed ? c.redSoft : c.fill },
              ]}
            >
              <Trash2 color={c.red} size={15} />
            </Pressable>
          </View>
        ) : null}
      </View>

      {poll.description ? (
        <Text style={[t.subhead, styles.pollDescription, { color: c.secondaryLabel }]}>
          {poll.description}
        </Text>
      ) : null}

      <View style={styles.optionsList}>
        {poll.options.map((option) => {
          const active = selected.includes(option.id);
          return (
            <View key={option.id} style={styles.resultOption}>
              <Pressable
                accessibilityLabel={`${active ? '取消选择' : '选择'}${option.label}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active, disabled: !poll.canVote }}
                disabled={!poll.canVote}
                onPress={() => toggle(option.id)}
                style={({ pressed }) => [
                  styles.optionButton,
                  {
                    backgroundColor: active ? c.tintSoft : pressed ? c.fill : 'transparent',
                    borderColor: active ? c.tint : c.separator,
                  },
                ]}
              >
                <View
                  style={[
                    styles.choiceIndicator,
                    {
                      borderColor: active ? c.tint : c.fillStrong,
                      backgroundColor: active ? c.tint : c.card,
                    },
                  ]}
                >
                  {active ? <Check color="#FFFFFF" size={13} strokeWidth={3} /> : null}
                </View>
                <Text numberOfLines={2} style={[t.subhead, { color: c.label, flex: 1, fontWeight: '600' }]}>
                  {option.label}
                </Text>
                <Text style={[t.footnote, { color: c.secondaryLabel, fontWeight: '700' }]}>
                  {option.voteCount} 票 · {option.percentage}%
                </Text>
              </Pressable>
              <View style={[styles.progressTrack, { backgroundColor: c.fill }]}>
                <View
                  style={[
                    styles.progressFill,
                    { backgroundColor: c.blue, width: `${option.percentage}%` },
                  ]}
                />
              </View>
              {option.voters.length ? (
                <Text numberOfLines={1} style={[t.caption, { color: c.tertiaryLabel, marginTop: 5 }]}>
                  {option.voters.map((member) => `${member.avatarEmoji} ${member.name}`).join('  ')}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>

      <View style={[styles.pollFooter, { borderTopColor: c.separator }]}>
        <View style={styles.deadlineMeta}>
          <Clock3 color={c.tertiaryLabel} size={14} />
          <Text style={[t.caption, { color: c.secondaryLabel }]}>
            {formatDeadline(poll.closesAt)} · {poll.totalVoters} 人参与
          </Text>
        </View>
        {poll.canVote ? (
          <Pressable
            accessibilityLabel={`提交${poll.title}的投票`}
            accessibilityRole="button"
            disabled={!changed || vote.isPending}
            onPress={submitVote}
            style={[
              styles.voteButton,
              { backgroundColor: changed ? c.tint : c.fillStrong },
            ]}
          >
            {vote.isPending ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <Vote color={changed ? '#FFFFFF' : c.tertiaryLabel} size={16} />
                <Text
                  style={[
                    t.footnote,
                    { color: changed ? '#FFFFFF' : c.tertiaryLabel, fontWeight: '700' },
                  ]}
                >
                  {selected.length ? '提交选择' : '撤回选择'}
                </Text>
              </>
            )}
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

export default function PollsScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const params = useLocalSearchParams<{ pollId?: string }>();
  const focusedPollId = firstParam(params.pollId);
  const { data: polls, isLoading, error } = usePolls();
  const [filter, setFilter] = useState<PollFilter>('open');
  const [formOpen, setFormOpen] = useState(false);
  const [editingPoll, setEditingPoll] = useState<HouseholdPoll | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const setStatus = useSetPollStatus();
  const archive = useArchivePoll();

  useEffect(() => {
    if (focusedPollId && polls?.some((poll) => poll.id === focusedPollId)) {
      const focused = polls.find((poll) => poll.id === focusedPollId);
      if (focused?.status === 'closed') setFilter('all');
    }
  }, [focusedPollId, polls]);

  const visiblePolls = useMemo(
    () =>
      filter === 'all' ? polls ?? [] : (polls ?? []).filter((poll) => poll.status === filter),
    [filter, polls],
  );
  const openCount = polls?.filter((poll) => poll.status === 'open').length ?? 0;
  const closedCount = polls?.filter((poll) => poll.status === 'closed').length ?? 0;

  const reopen = (poll: HouseholdPoll) => {
    setStatus.mutate(
      { id: poll.id, action: 'reopen' },
      {
        onSuccess: () =>
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
        onError: (statusError) =>
          Alert.alert(
            '重新开启失败',
            statusError instanceof Error ? statusError.message : '请稍后再试',
          ),
      },
    );
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <PageContainer maxWidth={940} style={[styles.page, desktop && styles.pageDesktop]}>
        <View style={styles.pageHeader}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[t.largeTitle, { color: c.label }]}>家庭投票</Text>
            <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 4 }]}>
              {openCount} 项进行中 · {closedCount} 项已结束
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setEditingPoll(null);
              setFormOpen(true);
            }}
            style={({ pressed }) => [
              styles.addButton,
              { backgroundColor: pressed ? c.green : c.tint },
            ]}
          >
            <Plus color="#FFFFFF" size={18} />
            <Text style={[t.subhead, { color: '#FFFFFF', fontWeight: '700' }]}>发起投票</Text>
          </Pressable>
        </View>

        <View style={styles.filterWrap}>
          <Segmented<PollFilter>
            onChange={setFilter}
            options={[
              { label: '进行中', value: 'open' },
              { label: '已结束', value: 'closed' },
              { label: '全部', value: 'all' },
            ]}
            value={filter}
          />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {isLoading ? <ActivityIndicator color={c.tint} style={styles.loader} /> : null}
          {error ? (
            <Card>
              <EmptyState emoji="🗳️" title="投票加载失败" hint="请检查 API 服务" />
            </Card>
          ) : null}
          {!isLoading && !error && visiblePolls.length
            ? visiblePolls.map((poll) => (
                <PollCard
                  focused={poll.id === focusedPollId}
                  key={poll.id}
                  onArchive={() => setPendingAction({ type: 'archive', poll })}
                  onClose={() => setPendingAction({ type: 'close', poll })}
                  onEdit={() => {
                    setEditingPoll(poll);
                    setFormOpen(true);
                  }}
                  onReopen={() => reopen(poll)}
                  poll={poll}
                />
              ))
            : null}
          {!isLoading && !error && !visiblePolls.length ? (
            <Card>
              <EmptyState
                emoji="🗳️"
                title={filter === 'open' ? '暂无进行中的投票' : '没有匹配的投票'}
                hint="需要全家一起决定的事情可以放在这里"
              />
            </Card>
          ) : null}
        </ScrollView>
      </PageContainer>

      <PollForm
        onClose={() => setFormOpen(false)}
        onSaved={() => setFormOpen(false)}
        poll={editingPoll}
        visible={formOpen}
      />

      <ConfirmDialog
        confirmLabel={pendingAction?.type === 'close' ? '结束投票' : '删除投票'}
        destructive={pendingAction?.type !== 'close'}
        loading={setStatus.isPending || archive.isPending}
        message={
          pendingAction?.type === 'close'
            ? `「${pendingAction.poll.title}」结束后将暂时不能继续改票，也可以由管理者重新开启。`
            : `「${pendingAction?.poll.title ?? ''}」将从家庭投票中移除，已有选票仍保留在数据库。`
        }
        onCancel={() => {
          if (!setStatus.isPending && !archive.isPending) setPendingAction(null);
        }}
        onConfirm={() => {
          if (!pendingAction) return;
          if (pendingAction.type === 'close') {
            setStatus.mutate(
              { id: pendingAction.poll.id, action: 'close' },
              {
                onSuccess: () => {
                  setPendingAction(null);
                  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                },
                onError: (statusError) =>
                  Alert.alert(
                    '结束失败',
                    statusError instanceof Error ? statusError.message : '请稍后再试',
                  ),
              },
            );
            return;
          }
          archive.mutate(pendingAction.poll.id, {
            onSuccess: () => {
              setPendingAction(null);
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            },
            onError: (archiveError) =>
              Alert.alert(
                '删除失败',
                archiveError instanceof Error ? archiveError.message : '请稍后再试',
              ),
          });
        }}
        title={pendingAction?.type === 'close' ? '结束这个投票？' : '删除这个投票？'}
        visible={Boolean(pendingAction)}
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
  filterWrap: { width: 310, maxWidth: '100%', marginTop: 20 },
  scrollContent: { paddingTop: 18, paddingBottom: 44, gap: 14 },
  loader: { marginTop: 100 },
  pollCard: { padding: 0, overflow: 'hidden' },
  pollHeader: {
    minHeight: 74,
    paddingHorizontal: 16,
    paddingTop: 15,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },
  categoryIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryEmoji: { fontSize: 20 },
  pollTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  statusPill: { minHeight: 24, borderRadius: radius.sm, paddingHorizontal: 8, justifyContent: 'center' },
  pollMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: 5 },
  manageActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 5, maxWidth: 70 },
  smallIconButton: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pollDescription: { paddingHorizontal: 16, paddingTop: 8, lineHeight: 21 },
  optionsList: { paddingHorizontal: 16, paddingTop: 15, paddingBottom: 14, gap: 13 },
  resultOption: { minWidth: 0 },
  optionButton: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  choiceIndicator: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: { height: 5, borderRadius: 3, marginTop: 6, overflow: 'hidden' },
  progressFill: { height: 5, borderRadius: 3 },
  pollFooter: {
    minHeight: 58,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  deadlineMeta: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 5 },
  voteButton: {
    minWidth: 112,
    height: 38,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
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
    maxWidth: 600,
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
  descriptionInput: {
    minHeight: 78,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  lockedRule: {
    minHeight: 46,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  maxChoicesRow: {
    minHeight: 50,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  numberInput: { width: 64, height: 36, borderRadius: radius.sm, textAlign: 'center' },
  optionsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  addOptionButton: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 4 },
  optionInputs: { gap: 8 },
  optionInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  optionInput: { flex: 1, minWidth: 0, height: 44, borderRadius: radius.sm, paddingHorizontal: 12 },
  removeOptionButton: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deadlineRow: {
    minHeight: 62,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  deadlineFields: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  timeInput: { height: 46, borderRadius: radius.sm, paddingHorizontal: 12, textAlign: 'center' },
  formActions: { flexDirection: 'row', gap: 10, paddingTop: 2 },
  cancelButton: {
    flex: 1,
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButton: { flex: 1 },
});
