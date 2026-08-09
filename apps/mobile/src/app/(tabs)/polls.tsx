import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import {
  BellPlus,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Ellipsis,
  Film,
  House,
  LockKeyhole,
  Pencil,
  Plus,
  RotateCcw,
  ShoppingCart,
  Sparkles,
  TentTree,
  TriangleAlert,
  Trash2,
  UserRound,
  UtensilsCrossed,
  Vote,
  X,
  type LucideIcon,
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
import {
  ModuleBackButton,
  PageContainer,
  PageHeader,
  useDesktopLayout,
} from '../../components/app-shell';
import { DateSelector } from '../../components/date-selector';
import {
  AdaptiveDialog,
  Card,
  ConfirmDialog,
  EmptyState,
  PressableScale,
  PrimaryButton,
  Segmented,
} from '../../components/ui';
import { dateStr, parseDate, todayStr } from '../../lib/date';
import {
  useArchivePoll,
  useMedia,
  usePolls,
  useSetPollStatus,
  useUpsertPoll,
  useVotePoll,
} from '../../lib/queries';
import { radius, type as t, useTheme } from '../../lib/theme';
import type {
  HouseholdMedia,
  HouseholdPoll,
  PollCategory,
  PollStatus,
  PollVoteMode,
} from '../../lib/types';

type PollFilter = PollStatus | 'all';
type PendingAction = { type: 'close' | 'archive'; poll: HouseholdPoll } | null;
type PollSource = { module: 'media'; id: string; title: string };

const CATEGORY_LABELS: Record<PollCategory, string> = {
  general: '家庭',
  meal: '吃什么',
  activity: '活动',
  movie: '观影',
  shopping: '采购',
};

const CATEGORY_ICONS: Record<PollCategory, LucideIcon> = {
  general: House,
  meal: UtensilsCrossed,
  activity: TentTree,
  movie: Film,
  shopping: ShoppingCart,
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
  source,
  mediaCandidates,
  initialMediaIds,
  mediaScope,
}: {
  poll: HouseholdPoll | null;
  visible: boolean;
  onClose: () => void;
  onSaved: (saved: HouseholdPoll) => void;
  source: PollSource | null;
  mediaCandidates: HouseholdMedia[];
  initialMediaIds: string[];
  mediaScope: boolean;
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
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const structuredPoll = Boolean(poll?.options.some((option) => option.mediaId));
  const candidateMode = !poll && initialMediaIds.length > 0;
  const rulesLocked = Boolean(poll?.totalVotes) || structuredPoll;

  useEffect(() => {
    if (!visible) return;
    const deadline = deadlineParts(poll?.closesAt ?? null);
    setTitle(
      poll?.title ??
        (source
          ? `要一起看《${source.title}》吗？`
          : candidateMode
            ? '这次一起看哪一部？'
            : ''),
    );
    setDescription(poll?.description ?? '');
    setCategory(
      poll?.category ?? (source || candidateMode || mediaScope ? 'movie' : 'general'),
    );
    setVoteMode(poll?.voteMode ?? 'single');
    setMaxChoices(String(poll?.maxChoices ?? 2));
    setHasDeadline(Boolean(poll?.closesAt));
    setClosesOn(deadline.date);
    setClosesTime(deadline.time);
    setOptions(
      poll?.options.map((option) => option.label) ??
        (source ? ['想看', '这次先不看'] : ['', '']),
    );
    setSelectedMediaIds(initialMediaIds);
    setMessage(null);
  }, [candidateMode, initialMediaIds, mediaScope, poll, source, visible]);

  const updateOption = (index: number, value: string) => {
    setOptions((current) =>
      current.map((option, optionIndex) => (optionIndex === index ? value : option)),
    );
  };

  const submit = async () => {
    const normalizedTitle = title.trim();
    const normalizedOptions = options.map((option) => option.trim()).filter(Boolean);
    const optionCount = candidateMode
      ? selectedMediaIds.length
      : normalizedOptions.length;
    const max = voteMode === 'single' ? 1 : Number(maxChoices);
    if (!normalizedTitle) {
      setMessage('请填写投票标题');
      return;
    }
    if (optionCount < 2) {
      setMessage(candidateMode ? '至少选择两部候选影视' : '至少需要两个候选项');
      return;
    }
    if (
      !candidateMode &&
      new Set(
        normalizedOptions.map((option) => option.toLocaleLowerCase('zh-CN')),
      ).size !== normalizedOptions.length
    ) {
      setMessage('候选项不能重复');
      return;
    }
    if (
      voteMode === 'multiple' &&
      (!Number.isInteger(max) || max < 2 || max > optionCount)
    ) {
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
      const saved = await save.mutateAsync({
        id: poll?.id,
        title: normalizedTitle,
        description: description.trim() || null,
        category: mediaScope && !poll ? 'movie' : category,
        closesAt: deadline?.toISOString() ?? null,
        ...(!rulesLocked
          ? {
              voteMode,
              maxChoices: max,
              options: candidateMode
                ? selectedMediaIds.map((mediaId) => ({ mediaId }))
                : normalizedOptions.map((label) => ({ label })),
            }
          : {}),
        ...(!poll && source
          ? { sourceModule: source.module, sourceId: source.id }
          : {}),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved(saved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，请稍后再试');
    }
  };

  return (
    <AdaptiveDialog
      accessibilityLabel={poll ? '编辑家庭投票' : '发起家庭投票'}
      maxWidth={600}
      onClose={onClose}
      testID="poll-form-dialog"
      visible={visible}
    >
          <View style={styles.formHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.title2, { color: c.label }]}>
                {poll
                  ? '编辑家庭投票'
                  : candidateMode
                    ? '发起选片投票'
                    : mediaScope
                      ? '发起观影投票'
                      : '发起家庭投票'}
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
              {source || candidateMode || mediaScope ? (
                <View style={[styles.sourceNotice, { backgroundColor: c.accentSoft }]}>
                  <Film color={c.accent} size={17} />
                  <Text numberOfLines={2} style={[t.subhead, { color: c.accent, flex: 1, fontWeight: '600' }]}>
                    {source
                      ? `来自家庭片单 · ${source.title}`
                      : candidateMode
                        ? `家庭片单候选 · 已选 ${selectedMediaIds.length} 部`
                        : '家庭观影'}
                  </Text>
                </View>
              ) : (
                <View style={styles.categoryChoices}>
                  {(Object.entries(CATEGORY_LABELS) as [PollCategory, string][]).map(
                    ([value, label]) => {
                      const active = category === value;
                      return (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          key={value}
                          onPress={() => setCategory(value)}
                          style={({ pressed }) => [
                            styles.categoryChoice,
                            {
                              backgroundColor: active
                                ? c.tintSoft
                                : pressed
                                  ? c.fillStrong
                                  : c.fill,
                              borderColor: active ? c.tint : c.separator,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              t.subhead,
                              { color: active ? c.tint : c.secondaryLabel, fontWeight: active ? '700' : '500' },
                            ]}
                          >
                            {label}
                          </Text>
                        </Pressable>
                      );
                    },
                  )}
                </View>
              )}
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
                <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>
                  {candidateMode ? '候选影视' : '候选项'}
                </Text>
                {!candidateMode && !rulesLocked && options.length < 12 ? (
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
              {candidateMode ? (
                <View style={styles.candidateInputs}>
                  {mediaCandidates.map((entry) => {
                    const selected = selectedMediaIds.includes(entry.id);
                    const eligible =
                      entry.status === 'watchlist' || entry.status === 'voting';
                    return (
                      <Pressable
                        accessibilityLabel={`${selected ? '移除' : '选择'}候选影视${entry.mediaTitle.title}`}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected, disabled: !eligible }}
                        aria-checked={selected}
                        disabled={!eligible}
                        key={entry.id}
                        onPress={() =>
                          setSelectedMediaIds((current) =>
                            current.includes(entry.id)
                              ? current.filter((id) => id !== entry.id)
                              : current.length < 12
                                ? [...current, entry.id]
                                : current,
                          )
                        }
                        style={({ pressed }) => [
                          styles.candidateInput,
                          {
                            backgroundColor: selected
                              ? c.tintSoft
                              : pressed
                                ? c.fill
                                : c.card,
                            borderColor: selected ? c.tint : c.separator,
                            opacity: eligible ? 1 : 0.5,
                          },
                        ]}
                      >
                        {entry.mediaTitle.posterUrl ? (
                          <Image
                            contentFit="cover"
                            source={{ uri: entry.mediaTitle.posterUrl }}
                            style={styles.candidatePoster}
                          />
                        ) : (
                          <View style={[styles.candidatePoster, styles.candidatePosterFallback, { backgroundColor: c.fill }]}>
                            <Film color={c.tertiaryLabel} size={18} />
                          </View>
                        )}
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text numberOfLines={2} style={[t.subhead, { color: c.label, fontWeight: '600' }]}>
                            {entry.mediaTitle.title}
                          </Text>
                          <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>
                            {entry.mediaTitle.type === 'movie' ? '电影' : '剧集'}
                            {entry.mediaTitle.year ? ` · ${entry.mediaTitle.year}` : ''}
                            {!eligible ? ' · 当前状态不可投票' : ''}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.choiceIndicator,
                            {
                              borderColor: selected ? c.tint : c.fillStrong,
                              backgroundColor: selected ? c.tint : c.card,
                            },
                          ]}
                        >
                          {selected ? <Check color="#FFFFFF" size={13} strokeWidth={3} /> : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
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
              )}
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

          </ScrollView>
          <View style={[styles.formFooter, { borderTopColor: c.separator, backgroundColor: c.chromeStrong }]}>
            {message ? (
              <View accessibilityLiveRegion="polite" style={[styles.formMessage, { backgroundColor: c.redSoft }]}>
                <TriangleAlert color={c.red} size={17} />
                <Text style={[t.footnote, { color: c.red, flex: 1 }]}>{message}</Text>
              </View>
            ) : null}
            <View style={styles.formActions}>
              <Pressable
                accessibilityRole="button"
                disabled={save.isPending}
                onPress={onClose}
                style={({ pressed }) => [
                  styles.cancelButton,
                  { backgroundColor: pressed ? c.fillStrong : c.fill },
                ]}
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
          </View>
    </AdaptiveDialog>
  );
}

function PollCard({
  poll,
  focused,
  onArchive,
  onClose,
  onEdit,
  onOpenSource,
  onRemind,
  onReopen,
}: {
  poll: HouseholdPoll;
  focused: boolean;
  onArchive: () => void;
  onClose: () => void;
  onEdit: () => void;
  onOpenSource: (mediaId?: string) => void;
  onRemind: () => void;
  onReopen: () => void;
}) {
  const c = useTheme();
  const vote = useVotePoll();
  const [managementOpen, setManagementOpen] = useState(false);
  const [selected, setSelected] = useState(poll.selectedOptionIds);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => setSelected(poll.selectedOptionIds), [poll.selectedOptionIds]);
  useEffect(() => setFeedback(null), [poll.id]);

  const toggle = (optionId: string) => {
    if (!poll.canVote) return;
    if (poll.voteMode === 'single') {
      setFeedback(null);
      setSelected(selected.includes(optionId) ? [] : [optionId]);
      return;
    }
    if (selected.includes(optionId)) {
      setFeedback(null);
      setSelected(selected.filter((id) => id !== optionId));
      return;
    }
    if (selected.length >= poll.maxChoices) {
      setFeedback({
        type: 'warning',
        text: `这个投票最多选择 ${poll.maxChoices} 项`,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    setFeedback(null);
    setSelected([...selected, optionId]);
  };

  const changed = !sameSelection(selected, poll.selectedOptionIds);
  const CategoryIcon = CATEGORY_ICONS[poll.category];
  const categoryTone = poll.category === 'meal'
    ? { background: c.orangeSoft, color: c.orange }
    : poll.category === 'activity'
      ? { background: c.blueSoft, color: c.blue }
      : poll.category === 'movie'
        ? { background: c.accentSoft, color: c.accent }
        : { background: c.tintSoft, color: c.tint };
  const submitVote = () => {
    vote.mutate(
      { id: poll.id, optionIds: selected },
      {
        onSuccess: () => {
          setFeedback({ type: 'success', text: '投票已提交，可以继续修改选择' });
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        },
        onError: (error) =>
          setFeedback({
            type: 'error',
            text: error instanceof Error ? error.message : '投票失败，请稍后再试',
          }),
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
        <View style={[styles.categoryIcon, { backgroundColor: categoryTone.background }]}>
          <CategoryIcon color={categoryTone.color} size={20} strokeWidth={2} />
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
      </View>

      {poll.canManage ? (
        <View style={styles.managementActions}>
          <Pressable
            accessibilityLabel={`编辑投票${poll.title}`}
            accessibilityRole="button"
            onPress={onEdit}
            style={({ pressed }) => [
              styles.managementButton,
              { backgroundColor: pressed ? c.tintSoft : c.fill },
            ]}
          >
            <Pencil color={c.tint} size={16} />
            <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>编辑</Text>
          </Pressable>
          <Pressable
            accessibilityLabel={`更多投票操作${poll.title}`}
            accessibilityRole="button"
            onPress={() => setManagementOpen(true)}
            style={({ pressed }) => [
              styles.managementButton,
              { backgroundColor: pressed ? c.tintSoft : c.fill },
            ]}
          >
            <Ellipsis color={c.secondaryLabel} size={18} />
            <Text style={[t.footnote, { color: c.secondaryLabel, fontWeight: '700' }]}>更多操作</Text>
          </Pressable>
        </View>
      ) : null}

      <AdaptiveDialog
        accessibilityLabel={`管理投票${poll.title}`}
        maxWidth={420}
        onClose={() => setManagementOpen(false)}
        testID="poll-management-dialog"
        visible={managementOpen}
      >
        <View style={styles.managementDialog}>
          <View style={styles.managementDialogHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.title2, { color: c.label }]}>更多操作</Text>
              <Text numberOfLines={2} style={[t.footnote, { color: c.secondaryLabel, marginTop: 4 }]}>
                {poll.title}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="关闭投票管理"
              accessibilityRole="button"
              onPress={() => setManagementOpen(false)}
              style={({ pressed }) => [
                styles.managementDialogClose,
                pressed && { backgroundColor: c.fill },
              ]}
            >
              <X color={c.secondaryLabel} size={20} />
            </Pressable>
          </View>
          <View style={styles.managementDialogActions}>
            <Pressable
              accessibilityLabel={poll.status === 'open' ? `结束投票${poll.title}` : `重新开启投票${poll.title}`}
              accessibilityRole="button"
              onPress={() => {
                setManagementOpen(false);
                if (poll.status === 'open') onClose();
                else onReopen();
              }}
              style={({ pressed }) => [
                styles.managementDialogAction,
                {
                  backgroundColor: pressed
                    ? poll.status === 'open' ? c.orangeSoft : c.tintSoft
                    : c.fill,
                },
              ]}
            >
              {poll.status === 'open' ? (
                <LockKeyhole color={c.orange} size={19} />
              ) : (
                <RotateCcw color={c.tint} size={19} />
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[t.headline, { color: poll.status === 'open' ? c.orange : c.tint }]}>
                  {poll.status === 'open' ? '结束投票' : '重新开启'}
                </Text>
                <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>
                  {poll.status === 'open' ? '结束后成员不能继续改票' : '恢复成员投票和修改选择'}
                </Text>
              </View>
            </Pressable>
            <Pressable
              accessibilityLabel={`删除投票${poll.title}`}
              accessibilityRole="button"
              onPress={() => {
                setManagementOpen(false);
                onArchive();
              }}
              style={({ pressed }) => [
                styles.managementDialogAction,
                { backgroundColor: pressed ? c.redSoft : c.fill },
              ]}
            >
              <Trash2 color={c.red} size={19} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[t.headline, { color: c.red }]}>删除投票</Text>
                <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>从家庭投票列表中移除</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </AdaptiveDialog>

      <View style={styles.utilityActions}>
        {poll.sourceModule === 'media' && poll.sourceId ? (
          <Pressable
            accessibilityLabel={`查看${poll.title}关联的片单条目`}
            accessibilityRole="button"
            onPress={() => onOpenSource()}
            style={({ pressed }) => [
              styles.reminderButton,
              { backgroundColor: pressed ? c.accentSoft : c.fill },
            ]}
          >
            <Film color={c.accent} size={16} />
            <Text style={[t.footnote, { color: c.accent, fontWeight: '700' }]}>查看片单条目</Text>
          </Pressable>
        ) : null}
        {poll.status === 'open' ? (
          <Pressable
            accessibilityLabel={`提醒投票${poll.title}`}
            accessibilityRole="button"
            onPress={onRemind}
            style={({ pressed }) => [
              styles.reminderButton,
              { backgroundColor: pressed ? c.tintSoft : c.fill },
            ]}
          >
            <BellPlus color={c.tint} size={16} />
            <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>设置提醒</Text>
          </Pressable>
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
                accessibilityRole={poll.voteMode === 'single' ? 'radio' : 'checkbox'}
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
                {option.media?.mediaTitle.posterUrl ? (
                  <Image
                    accessibilityLabel={`${option.label}海报`}
                    contentFit="cover"
                    source={{ uri: option.media.mediaTitle.posterUrl }}
                    style={styles.pollOptionPoster}
                  />
                ) : option.media ? (
                  <View style={[styles.pollOptionPoster, styles.candidatePosterFallback, { backgroundColor: c.fill }]}>
                    <Film color={c.tertiaryLabel} size={16} />
                  </View>
                ) : null}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={2} style={[t.subhead, { color: c.label, fontWeight: '600' }]}>
                    {option.label}
                  </Text>
                  {option.media ? (
                    <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>
                      {option.media.mediaTitle.type === 'movie' ? '电影' : '剧集'}
                      {option.media.mediaTitle.year
                        ? ` · ${option.media.mediaTitle.year}`
                        : ''}
                    </Text>
                  ) : null}
                </View>
                <Text style={[t.footnote, { color: c.secondaryLabel, fontWeight: '700' }]}>
                  {option.voteCount} 票 · {option.percentage}%
                </Text>
              </Pressable>
              {option.media ? (
                <Pressable
                  accessibilityLabel={`查看候选影视${option.label}的片单条目`}
                  accessibilityRole="link"
                  onPress={() => onOpenSource(option.media?.id)}
                  style={({ pressed }) => [
                    styles.optionSourceLink,
                    { backgroundColor: pressed ? c.accentSoft : 'transparent' },
                  ]}
                >
                  <Film color={c.accent} size={14} />
                  <Text style={[t.caption, { color: c.accent, fontWeight: '700' }]}>
                    查看片单
                  </Text>
                </Pressable>
              ) : null}
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

      {feedback ? (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.voteFeedback,
            {
              backgroundColor:
                feedback.type === 'success'
                  ? c.greenSoft
                  : feedback.type === 'warning'
                    ? c.orangeSoft
                    : c.redSoft,
            },
          ]}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 color={c.green} size={18} />
          ) : (
            <TriangleAlert
              color={feedback.type === 'warning' ? c.orange : c.red}
              size={18}
            />
          )}
          <Text
            style={[
              t.footnote,
              {
                color:
                  feedback.type === 'success'
                    ? c.green
                    : feedback.type === 'warning'
                      ? c.orange
                      : c.red,
                flex: 1,
                fontWeight: '600',
              },
            ]}
          >
            {feedback.text}
          </Text>
        </View>
      ) : null}

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
  const router = useRouter();
  const pathname = usePathname();
  const mediaScope = pathname === '/media/polls';
  const params = useLocalSearchParams<{
    create?: string;
    pollId?: string;
    sourceModule?: string;
    sourceId?: string;
    sourceTitle?: string;
    returnTo?: string;
    candidateIds?: string;
  }>();
  const parameterCreate = firstParam(params.create);
  const focusedPollId = firstParam(params.pollId);
  const sourceModule = firstParam(params.sourceModule);
  const sourceId = firstParam(params.sourceId);
  const sourceTitle = firstParam(params.sourceTitle);
  const returnTo = firstParam(params.returnTo);
  const candidateIdsParam = firstParam(params.candidateIds);
  const initialMediaIds = useMemo(
    () =>
      [...new Set((candidateIdsParam ?? '').split(',').filter(Boolean))].slice(
        0,
        12,
      ),
    [candidateIdsParam],
  );
  const source = useMemo(
    () =>
      sourceModule === 'media' && sourceId && sourceTitle
        ? { module: 'media' as const, id: sourceId, title: sourceTitle }
        : null,
    [sourceId, sourceModule, sourceTitle],
  );
  const { data: polls, isLoading, error, refetch } = usePolls();
  const { data: householdMedia } = useMedia(
    'all',
    '',
    initialMediaIds.length > 0,
  );
  const mediaCandidates = useMemo(
    () =>
      [...(householdMedia ?? [])].sort((left, right) => {
        const leftSelected = initialMediaIds.indexOf(left.id);
        const rightSelected = initialMediaIds.indexOf(right.id);
        if (leftSelected >= 0 && rightSelected >= 0) {
          return leftSelected - rightSelected;
        }
        if (leftSelected >= 0) return -1;
        if (rightSelected >= 0) return 1;
        return left.mediaTitle.title.localeCompare(
          right.mediaTitle.title,
          'zh-CN',
        );
      }),
    [householdMedia, initialMediaIds],
  );
  const [filter, setFilter] = useState<PollFilter>('open');
  const [formOpen, setFormOpen] = useState(false);
  const [editingPoll, setEditingPoll] = useState<HouseholdPoll | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const openedSource = React.useRef<string | null>(null);
  const setStatus = useSetPollStatus();
  const archive = useArchivePoll();

  useEffect(() => {
    if (focusedPollId && polls?.some((poll) => poll.id === focusedPollId)) {
      const focused = polls.find((poll) => poll.id === focusedPollId);
      if (focused?.status === 'closed') setFilter('all');
    }
  }, [focusedPollId, polls]);

  useEffect(() => {
    if (!source && !initialMediaIds.length && parameterCreate !== '1') return;
    const key = source
      ? `${source.module}:${source.id}`
      : initialMediaIds.length
        ? `media-candidates:${initialMediaIds.join(',')}`
        : 'create';
    if (openedSource.current === key) return;
    openedSource.current = key;
    setEditingPoll(null);
    setFormOpen(true);
  }, [initialMediaIds, parameterCreate, source]);

  useEffect(() => {
    if (parameterCreate !== '1' && openedSource.current === 'create') {
      openedSource.current = null;
    }
  }, [parameterCreate]);

  const closePollForm = () => {
    setFormOpen(false);
    if (parameterCreate === '1') router.replace('/polls');
  };

  const scopedPolls = useMemo(
    () =>
      mediaScope
        ? (polls ?? []).filter(
            (poll) =>
              poll.category === 'movie' ||
              poll.sourceModule === 'media' ||
              poll.options.some((option) => Boolean(option.mediaId)),
          )
        : polls ?? [],
    [mediaScope, polls],
  );
  const visiblePolls = useMemo(
    () =>
      filter === 'all'
        ? scopedPolls
        : scopedPolls.filter((poll) => poll.status === filter),
    [filter, scopedPolls],
  );
  const openCount = scopedPolls.filter((poll) => poll.status === 'open').length;
  const closedCount = scopedPolls.filter((poll) => poll.status === 'closed').length;

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
        {mediaScope ? (
          <ModuleBackButton
            href={returnTo === 'watchlist' ? '/media/watchlist' : '/media'}
            label={returnTo === 'watchlist' ? '家庭片单' : '家庭观影'}
            showOnDesktop
          />
        ) : null}
        <PageHeader
          action={(
            <PressableScale
              accessibilityLabel="发起投票"
              haptic
              onPress={() => {
                setEditingPoll(null);
                setFormOpen(true);
              }}
              style={[styles.addButton, { backgroundColor: c.tint }]}
            >
              <Plus color="#FFFFFF" size={18} />
              <Text style={[t.subhead, { color: '#FFFFFF', fontWeight: '700' }]}>发起投票</Text>
            </PressableScale>
          )}
          subtitle={`${openCount} 项进行中 · ${closedCount} 项已结束`}
          title={mediaScope ? '观影投票' : '家庭投票'}
        />

        <PressableScale
          accessibilityLabel="向小管家询问家庭投票"
          haptic={false}
          onPress={() =>
            router.push({
              pathname: '/assistant',
              params: { route: '/polls' },
            })
          }
          style={[styles.assistantEntry, { backgroundColor: c.tintSoft }]}
          testID="poll-ask-assistant"
        >
          <View style={[styles.assistantEntryIcon, { backgroundColor: c.card }]}>
            <Sparkles color={c.tint} size={18} />
          </View>
          <Text style={[t.subhead, styles.assistantEntryText, { color: c.tint }]}>问小管家家庭投票</Text>
          <ChevronRight color={c.tint} size={18} />
        </PressableScale>

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
            <Card style={styles.loadErrorCard}>
              <EmptyState icon={Vote} title="投票加载失败" hint="请检查 API 服务" />
              <Pressable
                accessibilityRole="button"
                onPress={() => void refetch()}
                style={({ pressed }) => [
                  styles.retryButton,
                  { backgroundColor: pressed ? c.tintSoft : c.fill },
                ]}
              >
                <RotateCcw color={c.tint} size={17} />
                <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]}>重新加载</Text>
              </Pressable>
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
                  onOpenSource={(mediaId) => {
                    const targetMediaId = mediaId ?? poll.sourceId;
                    if (!targetMediaId) return;
                    router.push({
                      pathname: '/media/watchlist',
                      params: { mediaId: targetMediaId },
                    });
                  }}
                  onReopen={() => reopen(poll)}
                  onRemind={() =>
                    router.push({
                      pathname: '/reminders',
                      params: { sourceModule: 'poll', sourceId: poll.id },
                    })
                  }
                  poll={poll}
                />
              ))
            : null}
          {!isLoading && !error && !visiblePolls.length ? (
            <Card>
              <EmptyState
                icon={Vote}
                title={filter === 'open' ? '暂无进行中的投票' : '没有匹配的投票'}
                hint="需要全家一起决定的事情可以放在这里"
              />
            </Card>
          ) : null}
        </ScrollView>
      </PageContainer>

      <PollForm
        onClose={closePollForm}
        onSaved={(saved) => {
          closePollForm();
          if (source || initialMediaIds.length) {
            if (returnTo === 'watchlist') {
              router.replace({
                pathname: '/media/watchlist',
                params: {
                  ...(source ? { mediaId: source.id } : {}),
                  filter: 'voting',
                },
              });
            } else {
              router.replace({ pathname: '/polls', params: { pollId: saved.id } });
            }
          }
        }}
        poll={editingPoll}
        source={!editingPoll ? source : null}
        mediaCandidates={mediaCandidates}
        initialMediaIds={!editingPoll ? initialMediaIds : []}
        mediaScope={mediaScope}
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
  addButton: {
    minHeight: 44,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  assistantEntry: { minHeight: 52, marginTop: 16, borderRadius: radius.md, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  assistantEntryIcon: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  assistantEntryText: { flex: 1, minWidth: 0, fontWeight: '700' },
  filterWrap: { width: 310, maxWidth: '100%', marginTop: 20 },
  scrollContent: { paddingTop: 18, paddingBottom: 44, gap: 14 },
  loader: { marginTop: 100 },
  loadErrorCard: { paddingBottom: 20 },
  retryButton: {
    minHeight: 44,
    alignSelf: 'center',
    borderRadius: radius.md,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
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
  pollTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  statusPill: { minHeight: 24, borderRadius: radius.sm, paddingHorizontal: 8, justifyContent: 'center' },
  pollMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: 5 },
  managementActions: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    gap: 8,
  },
  managementButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  managementDialog: { padding: 20, paddingBottom: 24 },
  managementDialogHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  managementDialogClose: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  managementDialogActions: { gap: 10, marginTop: 18 },
  managementDialogAction: {
    minHeight: 68,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  reminderButton: {
    minHeight: 44,
    borderRadius: radius.sm,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  utilityActions: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
  pollOptionPoster: { width: 36, height: 52, borderRadius: 4 },
  optionSourceLink: {
    alignSelf: 'flex-start',
    minHeight: 44,
    borderRadius: radius.sm,
    paddingHorizontal: 7,
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  progressTrack: { height: 5, borderRadius: 3, marginTop: 6, overflow: 'hidden' },
  progressFill: { height: 5, borderRadius: 3 },
  voteFeedback: {
    minHeight: 44,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
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
    minHeight: 44,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
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
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formContent: { paddingHorizontal: 20, paddingBottom: 24, gap: 16 },
  formFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 10,
  },
  formMessage: {
    minHeight: 44,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  field: { gap: 7 },
  fieldLabel: { fontWeight: '600' },
  categoryChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryChoice: {
    minWidth: 94,
    flexGrow: 1,
    minHeight: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceNotice: {
    minHeight: 46,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
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
  numberInput: { width: 64, height: 44, borderRadius: radius.sm, textAlign: 'center' },
  optionsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  addOptionButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  optionInputs: { gap: 8 },
  candidateInputs: { gap: 8 },
  candidateInput: {
    minHeight: 64,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  candidatePoster: { width: 34, height: 48, borderRadius: 4 },
  candidatePosterFallback: { alignItems: 'center', justifyContent: 'center' },
  optionInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  optionInput: { flex: 1, minWidth: 0, height: 44, borderRadius: radius.sm, paddingHorizontal: 12 },
  removeOptionButton: {
    width: 44,
    height: 44,
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
