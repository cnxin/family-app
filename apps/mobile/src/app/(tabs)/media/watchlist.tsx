import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Download,
  Eye,
  Film,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Vote,
  X,
} from 'lucide-react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
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
import { ModuleBackButton, PageContainer, useDesktopLayout } from '../../../components/app-shell';
import {
  CalendarMonth,
  startOfMonth,
} from '../../../components/calendar-month';
import {
  MediaDetailDialog,
  type MediaDetailAction,
} from '../../../components/media-detail-dialog';
import {
  ConfirmDialog,
  EmptyState,
  PrimaryButton,
  Segmented,
} from '../../../components/ui';
import { parseDate, todayStr } from '../../../lib/date';
import {
  useCreateMedia,
  useCreateMediaRequest,
  useCancelMediaRequest,
  useDeleteMedia,
  useMedia,
  useMediaConnectors,
  useMediaLibraryAvailability,
  useMediaRequests,
  useMediaSearch,
  usePolls,
  useRefreshMediaRequest,
  useUpdateMedia,
} from '../../../lib/queries';
import { radius, type as t, useTheme } from '../../../lib/theme';
import type {
  HouseholdMedia,
  HouseholdMediaStatus,
  HouseholdPoll,
  MediaConnectorSummary,
  MediaLibraryMatch,
  MediaMetadataSource,
  MediaRequest,
  MediaRequestStatus,
  MediaSearchResult,
  MediaSourceSearchStatus,
  MediaType,
} from '../../../lib/types';

type MediaFilter = HouseholdMediaStatus | 'all';

const STATUS_OPTIONS: { label: string; value: HouseholdMediaStatus }[] = [
  { label: '想看', value: 'watchlist' },
  { label: '投票中', value: 'voting' },
  { label: '已排期', value: 'scheduled' },
  { label: '观看中', value: 'watching' },
  { label: '已看完', value: 'completed' },
  { label: '不再观看', value: 'dropped' },
];

const FILTER_OPTIONS: { label: string; value: MediaFilter }[] = [
  { label: '全部', value: 'all' },
  ...STATUS_OPTIONS,
];

const STATUS_TRANSITIONS: Record<
  HouseholdMediaStatus,
  HouseholdMediaStatus[]
> = {
  watchlist: ['voting', 'scheduled', 'watching', 'completed', 'dropped'],
  voting: ['watchlist', 'scheduled', 'dropped'],
  scheduled: ['watchlist', 'watching', 'completed', 'dropped'],
  watching: ['completed', 'dropped', 'watchlist'],
  completed: ['watchlist', 'watching'],
  dropped: ['watchlist'],
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function statusLabel(status: HouseholdMediaStatus) {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function formatSchedule(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(parseDate(value));
}

function formatMediaDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function statusColors(
  status: HouseholdMediaStatus,
  c: ReturnType<typeof useTheme>,
) {
  if (status === 'scheduled') return { color: c.orange, background: c.orangeSoft };
  if (status === 'watching') return { color: c.blue, background: c.blueSoft };
  if (status === 'completed') return { color: c.green, background: c.greenSoft };
  if (status === 'dropped') return { color: c.secondaryLabel, background: c.fill };
  if (status === 'voting') return { color: c.accent, background: c.accentSoft };
  return { color: c.tint, background: c.tintSoft };
}

const REQUEST_STATUS_LABELS: Record<MediaRequestStatus, string> = {
  pending: '等待处理',
  processing: '订阅处理中',
  completed: '订阅完成',
  failed: '订阅失败',
  cancelled: '已取消',
};

function requestStatusColors(
  status: MediaRequestStatus,
  c: ReturnType<typeof useTheme>,
) {
  if (status === 'completed') return { color: c.green, background: c.greenSoft };
  if (status === 'failed') return { color: c.red, background: c.redSoft };
  if (status === 'cancelled') {
    return { color: c.secondaryLabel, background: c.fill };
  }
  if (status === 'processing') return { color: c.blue, background: c.blueSoft };
  return { color: c.orange, background: c.orangeSoft };
}

function Poster({ entry }: { entry: HouseholdMedia }) {
  const c = useTheme();
  const [failed, setFailed] = useState(false);
  const posterUrl = entry.mediaTitle.posterUrl;

  useEffect(() => setFailed(false), [posterUrl]);

  if (!posterUrl || failed) {
    return (
      <View style={[styles.poster, styles.posterFallback, { backgroundColor: c.fill }]}> 
        <Film color={c.tertiaryLabel} size={31} />
        <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 8 }]}>暂无海报</Text>
      </View>
    );
  }

  return (
    <Image
      accessibilityLabel={`${entry.mediaTitle.title}海报`}
      contentFit="cover"
      onError={() => setFailed(true)}
      source={{ uri: posterUrl }}
      style={styles.poster}
      transition={160}
    />
  );
}

function MediaCard({
  entry,
  moviePilot,
  request,
  requestBusy,
  onCancelRequest,
  onDelete,
  onDetails,
  onEdit,
  onPlay,
  onPoll,
  onRefreshRequest,
  onSubscribe,
  libraries,
  poll,
  pollSelectable,
  pollSelected,
  pollSelectionActive,
  onTogglePollCandidate,
}: {
  entry: HouseholdMedia;
  moviePilot: MediaConnectorSummary | null;
  request: MediaRequest | null;
  requestBusy: boolean;
  onCancelRequest: () => void;
  onDelete: () => void;
  onDetails: () => void;
  onEdit: () => void;
  onPlay: (match: MediaLibraryMatch) => void;
  onPoll: () => void;
  onRefreshRequest: () => void;
  onSubscribe: () => void;
  libraries: MediaLibraryMatch[];
  poll: HouseholdPoll | null;
  pollSelectable: boolean;
  pollSelected: boolean;
  pollSelectionActive: boolean;
  onTogglePollCandidate: () => void;
}) {
  const c = useTheme();
  const colors = statusColors(entry.status, c);
  const requestColors = request ? requestStatusColors(request.status, c) : null;
  const refs = entry.mediaTitle.externalRefs.filter(
    (ref) => ref.provider === 'tmdb' || ref.provider === 'imdb',
  );
  const hasTmdb = refs.some(
    (ref) => ref.provider === 'tmdb' && /^\d+$/.test(ref.externalId),
  );
  const canStartRequest =
    moviePilot?.available === true &&
    hasTmdb &&
    (!request || request.status === 'failed' || request.status === 'cancelled');

  return (
    <View style={[styles.mediaCard, { backgroundColor: c.card, borderColor: c.separator }]}> 
      <Pressable
        accessibilityLabel={`通过海报查看${entry.mediaTitle.title}详情`}
        accessibilityRole="button"
        onPress={onDetails}
        style={({ pressed }) => [styles.posterTrigger, pressed && styles.detailPressed]}
      >
        <Poster entry={entry} />
      </Pressable>
      <View style={styles.mediaBody}>
        <Pressable
          accessibilityLabel={`通过片名查看${entry.mediaTitle.title}详情`}
          accessibilityRole="button"
          onPress={onDetails}
          style={({ pressed }) => pressed && styles.detailPressed}
        >
          <View style={styles.mediaTitleRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={2} style={[t.headline, { color: c.label }]}>
                {entry.mediaTitle.title}
              </Text>
              <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 4 }]}>
                {entry.mediaTitle.type === 'movie' ? '电影' : '剧集'}
                {entry.mediaTitle.year ? ` · ${entry.mediaTitle.year}` : ''}
              </Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: colors.background }]}>
              <Text style={[t.caption, { color: colors.color, fontWeight: '700' }]}>
                {statusLabel(entry.status)}
              </Text>
            </View>
          </View>
        </Pressable>

        {entry.mediaTitle.overview ? (
          <Text
            numberOfLines={3}
            style={[t.footnote, styles.overview, { color: c.secondaryLabel }]}
          >
            {entry.mediaTitle.overview}
          </Text>
        ) : null}

        {entry.scheduledFor ? (
          <View style={[styles.scheduleBadge, { backgroundColor: c.orangeSoft }]}> 
            <CalendarDays color={c.orange} size={14} />
            <Text style={[t.caption, { color: c.orange, fontWeight: '700' }]}> 
              {formatSchedule(entry.scheduledFor)}
            </Text>
          </View>
        ) : null}

        {entry.note ? (
          <Text numberOfLines={2} style={[t.caption, { color: c.secondaryLabel }]}> 
            {entry.note}
          </Text>
        ) : null}

        {libraries.length ? (
          <View style={styles.playbackActions}>
            {libraries.map((match) => (
              <Pressable
                accessibilityLabel={`用${match.name}播放${entry.mediaTitle.title}`}
                accessibilityRole="link"
                disabled={!match.playbackUrl}
                key={`${match.connectorKey}:${match.libraryItemId}`}
                onPress={() => onPlay(match)}
                style={({ pressed }) => [
                  styles.playbackButton,
                  {
                    backgroundColor: pressed ? c.green : c.tint,
                    opacity: match.playbackUrl ? 1 : 0.45,
                  },
                ]}
              >
                <Play color="#FFFFFF" fill="#FFFFFF" size={13} />
                <Text
                  numberOfLines={1}
                  style={[t.caption, { color: '#FFFFFF', fontWeight: '700' }]}
                >
                  {match.name}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {request ? (
          <View
            style={[
              styles.requestPanel,
              { backgroundColor: c.fill, borderColor: c.separator },
            ]}
          >
            <View style={styles.requestHeader}>
              <Download color={requestColors?.color ?? c.secondaryLabel} size={16} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  numberOfLines={1}
                  style={[t.footnote, { color: c.label, fontWeight: '700' }]}
                >
                  MoviePilot{request.season ? ` · 第 ${request.season} 季` : ''}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}
                >
                  {request.requestedBy.avatarEmoji} {request.requestedBy.name}
                </Text>
              </View>
              <View
                style={[
                  styles.requestStatusBadge,
                  { backgroundColor: requestColors?.background ?? c.fillStrong },
                ]}
              >
                <Text
                  style={[
                    t.caption,
                    { color: requestColors?.color ?? c.label, fontWeight: '700' },
                  ]}
                >
                  {REQUEST_STATUS_LABELS[request.status]}
                </Text>
              </View>
            </View>
            {request.message ? (
              <Text
                numberOfLines={2}
                style={[
                  t.caption,
                  styles.requestMessage,
                  { color: request.status === 'failed' ? c.red : c.secondaryLabel },
                ]}
              >
                {request.message}
              </Text>
            ) : null}
            <View style={styles.requestActions}>
              {request.status !== 'completed' && request.status !== 'cancelled' ? (
                <Pressable
                  accessibilityLabel={`刷新${entry.mediaTitle.title}的MoviePilot订阅状态`}
                  accessibilityRole="button"
                  disabled={requestBusy || !request.externalRequestId}
                  onPress={onRefreshRequest}
                  style={({ pressed }) => [
                    styles.requestActionButton,
                    {
                      backgroundColor: pressed ? c.tintSoft : c.card,
                      opacity: requestBusy || !request.externalRequestId ? 0.45 : 1,
                    },
                  ]}
                >
                  <RefreshCw color={c.tint} size={15} />
                  <Text style={[t.caption, { color: c.tint, fontWeight: '700' }]}>
                    刷新
                  </Text>
                </Pressable>
              ) : null}
              {request.canCancel ? (
                <Pressable
                  accessibilityLabel={`取消${entry.mediaTitle.title}的MoviePilot订阅`}
                  accessibilityRole="button"
                  disabled={requestBusy}
                  onPress={onCancelRequest}
                  style={({ pressed }) => [
                    styles.requestActionButton,
                    {
                      backgroundColor: pressed ? c.redSoft : c.card,
                      opacity: requestBusy ? 0.45 : 1,
                    },
                  ]}
                >
                  <X color={c.red} size={15} />
                  <Text style={[t.caption, { color: c.red, fontWeight: '700' }]}>
                    取消
                  </Text>
                </Pressable>
              ) : null}
              {canStartRequest ? (
                <Pressable
                  accessibilityLabel={`重新订阅${entry.mediaTitle.title}`}
                  accessibilityRole="button"
                  disabled={requestBusy}
                  onPress={onSubscribe}
                  style={({ pressed }) => [
                    styles.requestActionButton,
                    {
                      backgroundColor: pressed ? c.greenSoft : c.card,
                      opacity: requestBusy ? 0.45 : 1,
                    },
                  ]}
                >
                  <Download color={c.green} size={15} />
                  <Text style={[t.caption, { color: c.green, fontWeight: '700' }]}>
                    重新订阅
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : (
          <Pressable
            accessibilityLabel={
              !hasTmdb
                ? `${entry.mediaTitle.title}缺少TMDB ID，不能订阅`
                : !moviePilot?.available
                  ? 'MoviePilot当前不可用'
                  : `订阅${entry.mediaTitle.title}`
            }
            accessibilityRole="button"
            disabled={!canStartRequest}
            onPress={onSubscribe}
            style={({ pressed }) => [
              styles.subscribeButton,
              {
                backgroundColor: pressed ? c.greenSoft : c.fill,
                opacity: canStartRequest ? 1 : 0.58,
              },
            ]}
          >
            <Download color={canStartRequest ? c.green : c.tertiaryLabel} size={16} />
            <Text
              numberOfLines={1}
              style={[
                t.caption,
                {
                  color: canStartRequest ? c.green : c.secondaryLabel,
                  fontWeight: '700',
                },
              ]}
            >
              {!hasTmdb
                ? '缺少 TMDB ID'
                : !moviePilot?.available
                  ? 'MoviePilot 不可用'
                  : '提交订阅'}
            </Text>
          </Pressable>
        )}

        <View style={styles.mediaFooter}>
          <View style={styles.externalRefs}>
            {refs.map((ref) => (
              <Text key={ref.id} style={[t.caption, { color: c.tertiaryLabel }]}> 
                {ref.provider.toUpperCase()} {ref.externalId}
              </Text>
            ))}
          </View>
          <View style={styles.cardActions}>
            {!pollSelectionActive ? (
              <Pressable
                accessibilityLabel={`查看${entry.mediaTitle.title}详情`}
                accessibilityRole="button"
                onPress={onDetails}
                style={({ pressed }) => [
                  styles.iconButton,
                  { backgroundColor: pressed ? c.blueSoft : c.fill },
                ]}
              >
                <Eye color={c.blue} size={17} />
              </Pressable>
            ) : null}
            {pollSelectionActive ? (
              <Pressable
                accessibilityLabel={`${pollSelected ? '移除' : '选择'}候选影视${entry.mediaTitle.title}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: pollSelected, disabled: !pollSelectable }}
                aria-checked={pollSelected}
                disabled={!pollSelectable}
                onPress={onTogglePollCandidate}
                style={({ pressed }) => [
                  styles.iconButton,
                  {
                    backgroundColor: pollSelected
                      ? c.tint
                      : pressed
                        ? c.tintSoft
                        : c.fill,
                    opacity: pollSelectable ? 1 : 0.4,
                  },
                ]}
              >
                {pollSelected ? (
                  <Check color="#FFFFFF" size={17} strokeWidth={3} />
                ) : (
                  <Plus color={c.tint} size={17} />
                )}
              </Pressable>
            ) : poll || entry.status === 'watchlist' || entry.status === 'voting' ? (
              <Pressable
                accessibilityLabel={`${poll ? '查看' : '发起'}${entry.mediaTitle.title}的家庭投票`}
                accessibilityRole="button"
                onPress={onPoll}
                style={({ pressed }) => [
                  styles.iconButton,
                  { backgroundColor: pressed ? c.accentSoft : c.fill },
                ]}
              >
                <Vote color={c.accent} size={17} />
              </Pressable>
            ) : null}
            {!pollSelectionActive ? <Pressable
              accessibilityLabel={`编辑${entry.mediaTitle.title}`}
              accessibilityRole="button"
              onPress={onEdit}
              style={({ pressed }) => [
                styles.iconButton,
                { backgroundColor: pressed ? c.tintSoft : c.fill },
              ]}
            >
              <Pencil color={c.tint} size={17} />
            </Pressable> : null}
            {!pollSelectionActive ? <Pressable
              accessibilityLabel={`移除${entry.mediaTitle.title}`}
              accessibilityRole="button"
              onPress={onDelete}
              style={({ pressed }) => [
                styles.iconButton,
                { backgroundColor: pressed ? c.redSoft : c.fill },
              ]}
            >
              <Trash2 color={c.red} size={17} />
            </Pressable> : null}
          </View>
        </View>
      </View>
    </View>
  );
}

function MediaForm({
  entry,
  onClose,
  onSaved,
  visible,
}: {
  entry: HouseholdMedia | null;
  onClose: () => void;
  onSaved: () => void;
  visible: boolean;
}) {
  const c = useTheme();
  const create = useCreateMedia();
  const update = useUpdateMedia();
  const [formStep, setFormStep] = useState<'search' | 'details'>('search');
  const [selectedSources, setSelectedSources] = useState<MediaMetadataSource[]>([]);
  const [mediaType, setMediaType] = useState<MediaType>('movie');
  const [title, setTitle] = useState('');
  const [originalTitle, setOriginalTitle] = useState('');
  const [year, setYear] = useState('');
  const [overview, setOverview] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [tmdbId, setTmdbId] = useState('');
  const [imdbId, setImdbId] = useState('');
  const [doubanId, setDoubanId] = useState('');
  const [bangumiId, setBangumiId] = useState('');
  const [status, setStatus] = useState<HouseholdMediaStatus>('watchlist');
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledFor, setScheduledFor] = useState(todayStr());
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(parseDate(todayStr())),
  );
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const loading = create.isPending || update.isPending;

  useEffect(() => {
    if (!visible) return;
    const date = entry?.scheduledFor ?? todayStr();
    setFormStep(entry ? 'details' : 'search');
    setSelectedSources([]);
    setMediaType(entry?.mediaTitle.type ?? 'movie');
    setTitle(entry?.mediaTitle.title ?? '');
    setOriginalTitle(entry?.mediaTitle.originalTitle ?? '');
    setYear(entry?.mediaTitle.year ? String(entry.mediaTitle.year) : '');
    setOverview(entry?.mediaTitle.overview ?? '');
    setPosterUrl(entry?.mediaTitle.posterUrl ?? '');
    setTmdbId(
      entry?.mediaTitle.externalRefs.find((ref) => ref.provider === 'tmdb')
        ?.externalId ?? '',
    );
    setImdbId(
      entry?.mediaTitle.externalRefs.find((ref) => ref.provider === 'imdb')
        ?.externalId ?? '',
    );
    setDoubanId(
      entry?.mediaTitle.externalRefs.find((ref) => ref.provider === 'douban')
        ?.externalId ?? '',
    );
    setBangumiId(
      entry?.mediaTitle.externalRefs.find((ref) => ref.provider === 'bangumi')
        ?.externalId ?? '',
    );
    setStatus(entry?.status ?? 'watchlist');
    setScheduleEnabled(Boolean(entry?.scheduledFor));
    setScheduledFor(date);
    setVisibleMonth(startOfMonth(parseDate(date)));
    setNote(entry?.note ?? '');
    setMessage(null);
  }, [entry, visible]);

  const selectSearchResult = (result: MediaSearchResult) => {
    const externalId = (provider: string) =>
      result.externalRefs.find((ref) => ref.provider === provider)?.externalId ?? '';
    setMediaType(result.type);
    setTitle(result.title);
    setOriginalTitle(result.originalTitle ?? '');
    setYear(result.year ? String(result.year) : '');
    setOverview(result.overview ?? '');
    setPosterUrl(result.posterUrl ?? '');
    setTmdbId(externalId('tmdb'));
    setImdbId(externalId('imdb'));
    setDoubanId(externalId('douban'));
    setBangumiId(externalId('bangumi'));
    setSelectedSources(result.sources);
    setMessage(null);
    setFormStep('details');
  };

  const startManualEntry = () => {
    setTitle('');
    setOriginalTitle('');
    setYear('');
    setOverview('');
    setPosterUrl('');
    setTmdbId('');
    setImdbId('');
    setDoubanId('');
    setBangumiId('');
    setSelectedSources([]);
    setMessage(null);
    setFormStep('details');
  };

  const allowedStatuses = entry
    ? new Set([entry.status, ...STATUS_TRANSITIONS[entry.status]])
    : null;

  const selectStatus = (value: HouseholdMediaStatus) => {
    setStatus(value);
    if (value === 'scheduled') setScheduleEnabled(true);
    if (['watchlist', 'voting', 'dropped'].includes(value)) {
      setScheduleEnabled(false);
    }
  };

  const toggleSchedule = (enabled: boolean) => {
    setScheduleEnabled(enabled);
    if (enabled && (status === 'watchlist' || status === 'voting')) {
      setStatus('scheduled');
    } else if (!enabled && status === 'scheduled') {
      setStatus('watchlist');
    }
  };

  const submit = async () => {
    const normalizedTitle = title.trim();
    const parsedYear = year.trim() ? Number(year) : null;
    if (!entry && !normalizedTitle) {
      setMessage('请填写影视名称');
      return;
    }
    if (
      !entry &&
      parsedYear != null &&
      (!Number.isInteger(parsedYear) || parsedYear < 1878 || parsedYear > 2199)
    ) {
      setMessage('年份需要在 1878 到 2199 之间');
      return;
    }
    if (!entry && posterUrl.trim() && !/^https?:\/\//i.test(posterUrl.trim())) {
      setMessage('海报链接需要以 http:// 或 https:// 开头');
      return;
    }
    if (status === 'scheduled' && !scheduleEnabled) {
      setMessage('已排期状态必须选择观影日期');
      return;
    }

    setMessage(null);
    try {
      if (entry) {
        await update.mutateAsync({
          id: entry.id,
          status,
          scheduledFor: scheduleEnabled ? scheduledFor : null,
          note: note.trim() || null,
        });
      } else {
        const externalRefs = [
          ...(tmdbId.trim()
            ? [{ provider: 'tmdb' as const, externalId: tmdbId.trim() }]
            : []),
          ...(imdbId.trim()
            ? [{ provider: 'imdb' as const, externalId: imdbId.trim() }]
            : []),
          ...(doubanId.trim()
            ? [{ provider: 'douban' as const, externalId: doubanId.trim() }]
            : []),
          ...(bangumiId.trim()
            ? [{ provider: 'bangumi' as const, externalId: bangumiId.trim() }]
            : []),
        ];
        await create.mutateAsync({
          type: mediaType,
          title: normalizedTitle,
          originalTitle: originalTitle.trim() || null,
          year: parsedYear,
          overview: overview.trim() || null,
          posterUrl: posterUrl.trim() || null,
          status,
          scheduledFor: scheduleEnabled ? scheduledFor : null,
          note: note.trim() || null,
          externalRefs,
        });
      }
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
          accessibilityLabel="关闭观影编辑"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.formSheet, { backgroundColor: c.card, borderColor: c.separator }]}> 
          <View style={styles.formHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.title2, { color: c.label }]}> 
                {entry ? '编辑观影安排' : '加入家庭片单'}
              </Text>
              {entry ? (
                <Text
                  numberOfLines={1}
                  style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}
                >
                  {entry.mediaTitle.title}
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityLabel="关闭"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
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
            {!entry && formStep === 'search' ? (
              <MetadataSearchPanel
                mediaType={mediaType}
                onManual={startManualEntry}
                onSelect={selectSearchResult}
                onTypeChange={setMediaType}
                visible={visible}
              />
            ) : (
              <>
                {!entry ? (
                  <View style={styles.selectionToolbar}>
                    <Pressable
                      accessibilityLabel="返回影视搜索"
                      accessibilityRole="button"
                      onPress={() => setFormStep('search')}
                      style={({ pressed }) => [
                        styles.backToSearch,
                        { backgroundColor: pressed ? c.fillStrong : c.fill },
                      ]}
                    >
                      <ArrowLeft color={c.tint} size={17} />
                      <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>
                        返回搜索
                      </Text>
                    </Pressable>
                    {selectedSources.length ? (
                      <View style={styles.selectedSources}>
                        {selectedSources.map((source) => (
                          <MediaSourceBadge key={source} source={source} />
                        ))}
                      </View>
                    ) : (
                      <Text style={[t.footnote, { color: c.secondaryLabel }]}>手动录入</Text>
                    )}
                  </View>
                ) : null}
                {!entry ? (
                  <>
                <Field label="类型">
                  <Segmented<MediaType>
                    onChange={setMediaType}
                    options={[
                      { label: '电影', value: 'movie' },
                      { label: '剧集', value: 'series' },
                    ]}
                    value={mediaType}
                  />
                </Field>
                <Field label="影视名称">
                  <FormInput
                    accessibilityLabel="影视名称"
                    onChangeText={setTitle}
                    placeholder="名称"
                    value={title}
                  />
                </Field>
                <View style={styles.twoColumns}>
                  <Field label="原名" style={styles.columnField}>
                    <FormInput
                      accessibilityLabel="影视原名"
                      onChangeText={setOriginalTitle}
                      placeholder="可不填"
                      value={originalTitle}
                    />
                  </Field>
                  <Field label="年份" style={styles.yearField}>
                    <FormInput
                      accessibilityLabel="上映年份"
                      inputMode="numeric"
                      maxLength={4}
                      onChangeText={setYear}
                      placeholder="例如 2026"
                      value={year}
                    />
                  </Field>
                </View>
                <Field label="简介">
                  <FormInput
                    accessibilityLabel="影视简介"
                    multiline
                    onChangeText={setOverview}
                    placeholder="剧情简介"
                    style={styles.multilineInput}
                    textAlignVertical="top"
                    value={overview}
                  />
                </Field>
                <Field label="海报链接">
                  <FormInput
                    accessibilityLabel="海报链接"
                    autoCapitalize="none"
                    onChangeText={setPosterUrl}
                    placeholder="https://..."
                    value={posterUrl}
                  />
                </Field>
                <View style={styles.twoColumns}>
                  <Field label="TMDB ID" style={styles.columnField}>
                    <FormInput
                      accessibilityLabel="TMDB ID"
                      autoCapitalize="none"
                      onChangeText={setTmdbId}
                      placeholder="可不填"
                      value={tmdbId}
                    />
                  </Field>
                  <Field label="IMDb ID" style={styles.columnField}>
                    <FormInput
                      accessibilityLabel="IMDb ID"
                      autoCapitalize="none"
                      onChangeText={setImdbId}
                      placeholder="例如 tt..."
                      value={imdbId}
                    />
                  </Field>
                </View>
                <View style={styles.twoColumns}>
                  <Field label="豆瓣 ID" style={styles.columnField}>
                    <FormInput
                      accessibilityLabel="豆瓣 ID"
                      autoCapitalize="none"
                      onChangeText={setDoubanId}
                      placeholder="可不填"
                      value={doubanId}
                    />
                  </Field>
                  <Field label="Bangumi ID" style={styles.columnField}>
                    <FormInput
                      accessibilityLabel="Bangumi ID"
                      autoCapitalize="none"
                      onChangeText={setBangumiId}
                      placeholder="可不填"
                      value={bangumiId}
                    />
                  </Field>
                </View>
                  </>
                ) : null}

            <Field label="状态">
              <View style={styles.statusOptions}>
                {STATUS_OPTIONS.filter(
                  (option) => !allowedStatuses || allowedStatuses.has(option.value),
                ).map((option) => {
                  const active = option.value === status;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      key={option.value}
                      onPress={() => selectStatus(option.value)}
                      style={[
                        styles.statusOption,
                        {
                          backgroundColor: active ? c.tintSoft : c.fill,
                          borderColor: active ? c.tint : 'transparent',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          t.footnote,
                          {
                            color: active ? c.tint : c.label,
                            fontWeight: active ? '700' : '500',
                          },
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Field>

            <Field label="观影日期">
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[t.subhead, { color: c.label }]}>安排观影</Text>
                  {scheduleEnabled ? (
                    <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}> 
                      {formatSchedule(scheduledFor)}
                    </Text>
                  ) : null}
                </View>
                <Switch
                  accessibilityLabel="安排观影日期"
                  onValueChange={toggleSchedule}
                  trackColor={{ false: c.fillStrong, true: c.tint }}
                  value={scheduleEnabled}
                />
              </View>
              {scheduleEnabled ? (
                <View style={[styles.calendarPicker, { borderColor: c.separator }]}> 
                  <CalendarMonth
                    onMonthChange={setVisibleMonth}
                    onSelect={(date) => {
                      setScheduledFor(date);
                      setVisibleMonth(startOfMonth(parseDate(date)));
                    }}
                    selectedDate={scheduledFor}
                    visibleMonth={visibleMonth}
                  />
                </View>
              ) : null}
            </Field>

            <Field label="家庭备注">
              <FormInput
                accessibilityLabel="家庭观影备注"
                multiline
                onChangeText={setNote}
                placeholder="例如版本偏好、准备事项"
                style={styles.noteInput}
                textAlignVertical="top"
                value={note}
              />
            </Field>

            {message ? (
              <Text style={[t.footnote, styles.formMessage, { color: c.red }]}>
                {message}
              </Text>
            ) : null}
            <PrimaryButton
              loading={loading}
              onPress={() => void submit()}
              title={entry ? '保存安排' : '加入片单'}
            />
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function SubscriptionDialog({
  entry,
  onClose,
  onSubmitted,
}: {
  entry: HouseholdMedia | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const c = useTheme();
  const create = useCreateMediaRequest();
  const [season, setSeason] = useState('1');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    setSeason('1');
    setMessage(null);
  }, [entry]);

  const submit = async () => {
    if (!entry) return;
    const parsedSeason = Number(season);
    if (
      entry.mediaTitle.type === 'series' &&
      (!Number.isInteger(parsedSeason) || parsedSeason < 1 || parsedSeason > 999)
    ) {
      setMessage('季数需要是 1 到 999 之间的整数');
      return;
    }
    setMessage(null);
    try {
      await create.mutateAsync({
        mediaId: entry.id,
        ...(entry.mediaTitle.type === 'series' ? { season: parsedSeason } : {}),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSubmitted();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '订阅失败，请稍后再试');
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={Boolean(entry)}
    >
      <View style={styles.modalOverlay}>
        <Pressable
          accessibilityLabel="关闭订阅窗口"
          accessibilityRole="button"
          disabled={create.isPending}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            styles.subscriptionSheet,
            { backgroundColor: c.card, borderColor: c.separator },
          ]}
        >
          <View style={styles.formHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.title2, { color: c.label }]}>提交 MoviePilot 订阅</Text>
              <Text
                numberOfLines={1}
                style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}
              >
                {entry?.mediaTitle.title}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="关闭"
              accessibilityRole="button"
              disabled={create.isPending}
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                { backgroundColor: pressed ? c.fill : 'transparent' },
              ]}
            >
              <X color={c.secondaryLabel} size={20} />
            </Pressable>
          </View>
          <View style={styles.subscriptionContent}>
            {entry?.mediaTitle.type === 'series' ? (
              <Field label="季数">
                <FormInput
                  accessibilityLabel="订阅季数"
                  inputMode="numeric"
                  maxLength={3}
                  onChangeText={setSeason}
                  value={season}
                />
              </Field>
            ) : null}
            {message ? (
              <Text style={[t.footnote, styles.formMessage, { color: c.red }]}>
                {message}
              </Text>
            ) : null}
            <PrimaryButton
              loading={create.isPending}
              onPress={() => void submit()}
              title="提交订阅"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Field({
  children,
  label,
  style,
}: {
  children: React.ReactNode;
  label: string;
  style?: object;
}) {
  const c = useTheme();
  return (
    <View style={[styles.field, style]}>
      <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}> 
        {label}
      </Text>
      {children}
    </View>
  );
}

function FormInput(props: React.ComponentProps<typeof TextInput>) {
  const c = useTheme();
  return (
    <TextInput
      placeholderTextColor={c.tertiaryLabel}
      {...props}
      style={[
        t.body,
        styles.input,
        { backgroundColor: c.fill, color: c.label },
        props.style,
      ]}
    />
  );
}

const MEDIA_SOURCE_LABELS: Record<MediaMetadataSource, string> = {
  douban: '豆瓣',
  tmdb: 'TMDB',
  bangumi: 'Bangumi',
};

function sourceColors(
  source: MediaMetadataSource,
  c: ReturnType<typeof useTheme>,
) {
  if (source === 'tmdb') return { color: c.blue, backgroundColor: c.blueSoft };
  if (source === 'bangumi') {
    return { color: c.orange, backgroundColor: c.orangeSoft };
  }
  return { color: c.green, backgroundColor: c.greenSoft };
}

function MediaSourceBadge({ source }: { source: MediaMetadataSource }) {
  const c = useTheme();
  const colors = sourceColors(source, c);
  return (
    <View style={[styles.sourceBadge, { backgroundColor: colors.backgroundColor }]}>
      <Text style={[t.caption, { color: colors.color, fontWeight: '700' }]}>
        {MEDIA_SOURCE_LABELS[source]}
      </Text>
    </View>
  );
}

function SourceSearchStatus({ status }: { status: MediaSourceSearchStatus }) {
  const c = useTheme();
  const source = sourceColors(status.provider, c);
  const available = status.state === 'online';
  const color = available ? source.color : c.secondaryLabel;
  const backgroundColor = available ? source.backgroundColor : c.fill;
  const stateLabel =
    status.state === 'online'
      ? String(status.resultCount)
      : status.state === 'not_configured'
        ? '未配置'
        : '不可用';
  return (
    <View
      accessibilityLabel={`${status.name}${stateLabel}，${status.message}`}
      style={[styles.sourceStatus, { backgroundColor }]}
    >
      <View style={[styles.sourceStatusDot, { backgroundColor: color }]} />
      <Text style={[t.caption, { color, fontWeight: '700' }]}>
        {status.name} {stateLabel}
      </Text>
    </View>
  );
}

function SearchResultPoster({ result }: { result: MediaSearchResult }) {
  const c = useTheme();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [result.posterUrl]);
  if (!result.posterUrl || failed) {
    return (
      <View
        style={[
          styles.searchResultPoster,
          styles.posterFallback,
          { backgroundColor: c.fill },
        ]}
      >
        <Film color={c.tertiaryLabel} size={25} />
      </View>
    );
  }
  return (
    <Image
      accessibilityLabel={`${result.title}海报`}
      contentFit="cover"
      onError={() => setFailed(true)}
      source={{ uri: result.posterUrl }}
      style={styles.searchResultPoster}
      transition={120}
    />
  );
}

function MetadataSearchPanel({
  mediaType,
  onManual,
  onSelect,
  onTypeChange,
  visible,
}: {
  mediaType: MediaType;
  onManual: () => void;
  onSelect: (result: MediaSearchResult) => void;
  onTypeChange: (type: MediaType) => void;
  visible: boolean;
}) {
  const c = useTheme();
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const searchResult = useMediaSearch(
    submittedQuery,
    mediaType,
    visible && Boolean(submittedQuery),
  );

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setSubmittedQuery('');
    setMessage(null);
  }, [visible]);

  const submitSearch = () => {
    const normalized = query.trim();
    if (!normalized) {
      setMessage('请输入影视名称');
      return;
    }
    setMessage(null);
    if (normalized === submittedQuery) {
      void searchResult.refetch();
    } else {
      setSubmittedQuery(normalized);
    }
  };

  return (
    <View style={styles.metadataSearchPanel}>
      <Segmented<MediaType>
        onChange={onTypeChange}
        options={[
          { label: '电影', value: 'movie' },
          { label: '剧集', value: 'series' },
        ]}
        value={mediaType}
      />

      <View style={styles.metadataSearchRow}>
        <View
          style={[
            styles.metadataSearchInput,
            { backgroundColor: c.fill, borderColor: c.separator },
          ]}
        >
          <Search color={c.tertiaryLabel} size={18} />
          <TextInput
            accessibilityLabel="搜索在线影视"
            autoCapitalize="none"
            onChangeText={setQuery}
            onSubmitEditing={submitSearch}
            placeholder="输入电影或剧集名称"
            placeholderTextColor={c.tertiaryLabel}
            returnKeyType="search"
            style={[t.body, styles.metadataSearchText, { color: c.label }]}
            value={query}
          />
          {query ? (
            <Pressable
              accessibilityLabel="清除在线搜索"
              accessibilityRole="button"
              onPress={() => setQuery('')}
              style={styles.clearSearch}
            >
              <X color={c.secondaryLabel} size={17} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={searchResult.isFetching}
          onPress={submitSearch}
          style={({ pressed }) => [
            styles.metadataSearchButton,
            { backgroundColor: pressed ? c.green : c.tint },
          ]}
        >
          {searchResult.isFetching ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Search color="#FFFFFF" size={18} />
          )}
          <Text style={[t.subhead, { color: '#FFFFFF', fontWeight: '700' }]}>搜索</Text>
        </Pressable>
      </View>

      {searchResult.data ? (
        <View style={styles.sourceStatuses}>
          {searchResult.data.sources.map((status) => (
            <SourceSearchStatus key={status.provider} status={status} />
          ))}
        </View>
      ) : null}

      {message || searchResult.error ? (
        <Text style={[t.footnote, { color: c.red, textAlign: 'center' }]}>
          {message ?? searchResult.error?.message}
        </Text>
      ) : null}

      {searchResult.data?.results.length ? (
        <View style={[styles.searchResults, { borderColor: c.separator }]}>
          {searchResult.data.results.map((result, index) => (
            <Pressable
              accessibilityLabel={`选择${result.title}`}
              accessibilityRole="button"
              key={result.key}
              onPress={() => onSelect(result)}
              style={({ pressed }) => [
                styles.searchResult,
                index > 0 && { borderTopColor: c.separator, borderTopWidth: 1 },
                { backgroundColor: pressed ? c.cardPressed : c.card },
              ]}
            >
              <SearchResultPoster result={result} />
              <View style={styles.searchResultBody}>
                <View style={styles.searchResultTitleRow}>
                  <Text
                    numberOfLines={2}
                    style={[t.headline, { color: c.label, flex: 1 }]}
                  >
                    {result.title}
                  </Text>
                  <View style={styles.selectedSources}>
                    {result.sources.map((source) => (
                      <MediaSourceBadge key={source} source={source} />
                    ))}
                  </View>
                </View>
                <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 4 }]}>
                  {result.type === 'movie' ? '电影' : '剧集'}
                  {result.year ? ` · ${result.year}` : ''}
                  {result.originalTitle ? ` · ${result.originalTitle}` : ''}
                </Text>
                {result.overview ? (
                  <Text
                    numberOfLines={3}
                    style={[t.footnote, styles.searchResultOverview, { color: c.secondaryLabel }]}
                  >
                    {result.overview}
                  </Text>
                ) : null}
                <View style={styles.selectResultCue}>
                  <Plus color={c.tint} size={15} />
                  <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>选择</Text>
                </View>
              </View>
            </Pressable>
          ))}
        </View>
      ) : searchResult.data && !searchResult.isFetching ? (
        <EmptyState emoji="?" title="没有找到匹配条目" />
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={onManual}
        style={({ pressed }) => [
          styles.manualEntryButton,
          {
            backgroundColor: pressed ? c.fill : c.card,
            borderColor: c.separator,
          },
        ]}
      >
        <Pencil color={c.tint} size={17} />
        <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]}>手动录入</Text>
      </Pressable>
    </View>
  );
}

export default function MediaScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const params = useLocalSearchParams<{
    mediaId?: string;
    filter?: string;
    view?: string;
  }>();
  const parameterMediaId = firstParam(params.mediaId);
  const parameterFilter = firstParam(params.filter);
  const parameterView = firstParam(params.view);
  const initialFilter = FILTER_OPTIONS.some(
    (option) => option.value === parameterFilter,
  )
    ? (parameterFilter as MediaFilter)
    : 'all';
  const [filter, setFilter] = useState<MediaFilter>(initialFilter);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<HouseholdMedia | null>(null);
  const [detailEntry, setDetailEntry] = useState<HouseholdMedia | null>(null);
  const [subscriptionEntry, setSubscriptionEntry] =
    useState<HouseholdMedia | null>(null);
  const [pendingCancel, setPendingCancel] = useState<{
    entry: HouseholdMedia;
    request: MediaRequest;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<HouseholdMedia | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [pollSelectionActive, setPollSelectionActive] = useState(false);
  const [selectedPollCandidates, setSelectedPollCandidates] = useState<string[]>([]);
  const openedParameter = useRef<string | null>(null);
  const { data: entries, error, isLoading } = useMedia(filter, debouncedSearch);
  const { data: connectors } = useMediaConnectors();
  const { data: mediaRequests } = useMediaRequests();
  const mediaIds = useMemo(() => (entries ?? []).map((entry) => entry.id), [entries]);
  const { data: availability } = useMediaLibraryAvailability(mediaIds);
  const { data: polls } = usePolls();
  const refreshRequest = useRefreshMediaRequest();
  const cancelRequest = useCancelMediaRequest();
  const remove = useDeleteMedia();

  const moviePilot =
    connectors?.find((connector) => connector.kind === 'moviepilot') ?? null;

  const requestByMediaId = useMemo(() => {
    const result = new Map<string, MediaRequest>();
    for (const request of mediaRequests ?? []) {
      if (!result.has(request.householdMediaId)) {
        result.set(request.householdMediaId, request);
      }
    }
    return result;
  }, [mediaRequests]);

  const pollByMediaId = useMemo(() => {
    const result = new Map<string, HouseholdPoll>();
    for (const poll of polls ?? []) {
      if (poll.status !== 'open') continue;
      if (poll.sourceModule === 'media' && poll.sourceId) {
        result.set(poll.sourceId, poll);
      }
      for (const option of poll.options) {
        if (option.mediaId) result.set(option.mediaId, poll);
      }
    }
    return result;
  }, [polls]);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    if (
      parameterFilter &&
      FILTER_OPTIONS.some((option) => option.value === parameterFilter)
    ) {
      setFilter(parameterFilter as MediaFilter);
    }
  }, [parameterFilter]);

  useEffect(() => {
    if (!parameterMediaId) return;
    const parameterKey = `${parameterMediaId}:${parameterView ?? 'edit'}`;
    if (openedParameter.current === parameterKey) return;
    const target = entries?.find((entry) => entry.id === parameterMediaId);
    if (!target) {
      if (!isLoading && filter !== 'all') setFilter('all');
      return;
    }
    openedParameter.current = parameterKey;
    if (parameterView === 'detail') {
      setDetailEntry(target);
      return;
    }
    setEditingEntry(target);
    setFormOpen(true);
  }, [entries, filter, isLoading, parameterMediaId, parameterView]);

  const counts = useMemo(() => {
    const result = new Map<HouseholdMediaStatus, number>();
    for (const entry of entries ?? []) {
      result.set(entry.status, (result.get(entry.status) ?? 0) + 1);
    }
    return result;
  }, [entries]);

  const detailLibraries = detailEntry ? availability?.[detailEntry.id] ?? [] : [];
  const detailRequest = detailEntry ? requestByMediaId.get(detailEntry.id) ?? null : null;
  const detailPoll = detailEntry ? pollByMediaId.get(detailEntry.id) ?? null : null;
  const detailActions: MediaDetailAction[] = detailEntry
    ? [
        ...detailLibraries
          .filter((match) => Boolean(match.playbackUrl))
          .map((match) => ({
            label: `${match.name} 播放`,
            accessibilityLabel: `在详情中用${match.name}播放${detailEntry.mediaTitle.title}`,
            icon: Play,
            onPress: () => {
              if (!match.playbackUrl) return;
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              void Linking.openURL(match.playbackUrl);
            },
            role: 'link' as const,
            tone: 'primary' as const,
          })),
        {
          label: '编辑片单',
          accessibilityLabel: `从详情编辑${detailEntry.mediaTitle.title}`,
          icon: Pencil,
          onPress: () => {
            setDetailEntry(null);
            setEditingEntry(detailEntry);
            setFormOpen(true);
          },
          tone: 'neutral',
        },
        ...(
          detailPoll ||
          detailEntry.status === 'watchlist' ||
          detailEntry.status === 'voting'
            ? [
                {
                  label: detailPoll ? '查看投票' : '发起投票',
                  accessibilityLabel: `从详情${detailPoll ? '查看' : '发起'}${detailEntry.mediaTitle.title}的家庭投票`,
                  icon: Vote,
                  onPress: () => {
                    setDetailEntry(null);
                    router.push(
                      detailPoll
                        ? { pathname: '/polls', params: { pollId: detailPoll.id } }
                        : {
                            pathname: '/polls',
                            params: {
                              sourceModule: 'media',
                              sourceId: detailEntry.id,
                              sourceTitle: detailEntry.mediaTitle.title,
                              returnTo: 'watchlist',
                            },
                          },
                    );
                  },
                  tone: 'accent' as const,
                },
              ]
            : []
        ),
      ]
    : [];

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.pageScrollContent}
        showsVerticalScrollIndicator={false}
        style={styles.pageScroll}
      >
        <PageContainer maxWidth={1180} style={[styles.page, desktop && styles.pageDesktop]}>
        <View style={styles.pageHeader}>
          <ModuleBackButton href="/media" label="家庭观影" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              accessibilityRole="header"
              style={[desktop ? t.largeTitle : t.title1, { color: c.label }]}
            >
              家庭片单
            </Text>
            <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}> 
              {entries?.length ?? 0} 部影视
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
            <Text style={[t.subhead, { color: '#FFFFFF', fontWeight: '700' }]}> 
              加入片单
            </Text>
          </Pressable>
        </View>

        <View style={styles.toolbar}>
          <View style={[styles.searchBox, { backgroundColor: c.card, borderColor: c.separator }]}> 
            <Search color={c.tertiaryLabel} size={18} />
            <TextInput
              accessibilityLabel="搜索家庭片单"
              autoCapitalize="none"
              onChangeText={setSearch}
              placeholder="搜索片单"
              placeholderTextColor={c.tertiaryLabel}
              style={[t.subhead, styles.searchInput, { color: c.label }]}
              value={search}
            />
            {search ? (
              <Pressable
                accessibilityLabel="清除搜索"
                accessibilityRole="button"
                onPress={() => setSearch('')}
                style={styles.clearSearch}
              >
                <X color={c.secondaryLabel} size={17} />
              </Pressable>
            ) : null}
          </View>

          <ScrollView
            contentContainerStyle={styles.filters}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {FILTER_OPTIONS.map((option) => {
              const active = option.value === filter;
              const count = option.value === 'all' ? null : counts.get(option.value);
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  key={option.value}
                  onPress={() => setFilter(option.value)}
                  style={[
                    styles.filterButton,
                    {
                      backgroundColor: active ? c.tintSoft : c.card,
                      borderColor: active ? c.tint : c.separator,
                    },
                  ]}
                >
                  <Text
                    style={[
                      t.footnote,
                      { color: active ? c.tint : c.label, fontWeight: '700' },
                    ]}
                  >
                    {option.label}
                    {count ? ` ${count}` : ''}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View
          style={[
            styles.pollComposeBar,
            { backgroundColor: c.card, borderColor: c.separator },
          ]}
        >
          {pollSelectionActive ? (
            <>
              <View style={styles.pollComposeStatus}>
                <Vote color={c.accent} size={18} />
                <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]}>
                  已选 {selectedPollCandidates.length} 部
                </Text>
              </View>
              <View style={styles.pollComposeActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setPollSelectionActive(false);
                    setSelectedPollCandidates([]);
                  }}
                  style={({ pressed }) => [
                    styles.pollComposeSecondary,
                    { backgroundColor: pressed ? c.fillStrong : c.fill },
                  ]}
                >
                  <X color={c.secondaryLabel} size={16} />
                  <Text style={[t.footnote, { color: c.secondaryLabel, fontWeight: '700' }]}>取消</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={selectedPollCandidates.length < 2}
                  onPress={() => {
                    const candidateIds = selectedPollCandidates.join(',');
                    setPollSelectionActive(false);
                    setSelectedPollCandidates([]);
                    router.push({
                      pathname: '/polls',
                      params: {
                        candidateIds,
                        returnTo: 'watchlist',
                      },
                    });
                  }}
                  style={[
                    styles.pollComposePrimary,
                    {
                      backgroundColor:
                        selectedPollCandidates.length >= 2 ? c.accent : c.fillStrong,
                    },
                  ]}
                >
                  <Vote
                    color={
                      selectedPollCandidates.length >= 2
                        ? '#FFFFFF'
                        : c.tertiaryLabel
                    }
                    size={16}
                  />
                  <Text
                    style={[
                      t.footnote,
                      {
                        color:
                          selectedPollCandidates.length >= 2
                            ? '#FFFFFF'
                            : c.tertiaryLabel,
                        fontWeight: '700',
                      },
                    ]}
                  >
                    发起投票
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setFilter('all');
                setSelectedPollCandidates([]);
                setPollSelectionActive(true);
              }}
              style={({ pressed }) => [
                styles.pollComposeCommand,
                { backgroundColor: pressed ? c.accentSoft : 'transparent' },
              ]}
            >
              <Vote color={c.accent} size={18} />
              <Text style={[t.subhead, { color: c.accent, fontWeight: '700' }]}>选片投票</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.listContent}>
          {isLoading ? (
            <ActivityIndicator color={c.tint} style={styles.loader} />
          ) : error ? (
            <EmptyState emoji="!" hint={error.message} title="片单加载失败" />
          ) : entries?.length ? (
            <View style={[styles.mediaGrid, desktop && styles.mediaGridDesktop]}>
              {entries.map((entry) => (
                <View key={entry.id} style={desktop ? styles.desktopCardCell : undefined}>
                  <MediaCard
                    entry={entry}
                    moviePilot={moviePilot}
                    onCancelRequest={() => {
                      const request = requestByMediaId.get(entry.id);
                      if (!request) return;
                      setRequestError(null);
                      setPendingCancel({ entry, request });
                    }}
                    onDelete={() => {
                      setDeleteError(null);
                      setPendingDelete(entry);
                    }}
                    onDetails={() => setDetailEntry(entry)}
                    onEdit={() => {
                      setEditingEntry(entry);
                      setFormOpen(true);
                    }}
                    onPlay={(match) => {
                      if (!match.playbackUrl) return;
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      void Linking.openURL(match.playbackUrl);
                    }}
                    onPoll={() => {
                      const poll = pollByMediaId.get(entry.id);
                      router.push(
                        poll
                          ? { pathname: '/polls', params: { pollId: poll.id } }
                          : {
                              pathname: '/polls',
                              params: {
                                sourceModule: 'media',
                                sourceId: entry.id,
                                sourceTitle: entry.mediaTitle.title,
                                returnTo: 'watchlist',
                              },
                            },
                      );
                    }}
                    onRefreshRequest={() => {
                      const request = requestByMediaId.get(entry.id);
                      if (!request) return;
                      setRequestError(null);
                      refreshRequest.mutate(request.id, {
                        onSuccess: () => {
                          void Haptics.notificationAsync(
                            Haptics.NotificationFeedbackType.Success,
                          );
                        },
                        onError: (requestFailure) => {
                          setRequestError(
                            requestFailure instanceof Error
                              ? requestFailure.message
                              : '订阅状态刷新失败',
                          );
                        },
                      });
                    }}
                    onSubscribe={() => {
                      setRequestError(null);
                      setSubscriptionEntry(entry);
                    }}
                    libraries={availability?.[entry.id] ?? []}
                    poll={pollByMediaId.get(entry.id) ?? null}
                    pollSelectable={
                      (entry.status === 'watchlist' || entry.status === 'voting') &&
                      !pollByMediaId.has(entry.id) &&
                      (selectedPollCandidates.includes(entry.id) ||
                        selectedPollCandidates.length < 12)
                    }
                    pollSelected={selectedPollCandidates.includes(entry.id)}
                    pollSelectionActive={pollSelectionActive}
                    onTogglePollCandidate={() =>
                      setSelectedPollCandidates((current) =>
                        current.includes(entry.id)
                          ? current.filter((id) => id !== entry.id)
                          : current.length < 12
                            ? [...current, entry.id]
                            : current,
                      )
                    }
                    request={requestByMediaId.get(entry.id) ?? null}
                    requestBusy={
                      (refreshRequest.isPending &&
                        refreshRequest.variables ===
                          requestByMediaId.get(entry.id)?.id) ||
                      (cancelRequest.isPending &&
                        cancelRequest.variables ===
                          requestByMediaId.get(entry.id)?.id)
                    }
                  />
                </View>
              ))}
            </View>
          ) : (
            <EmptyState
              emoji="🎬"
              hint={search || filter !== 'all' ? '没有符合条件的影视' : undefined}
              title={search || filter !== 'all' ? '没有找到结果' : '家庭片单还是空的'}
            />
          )}
          {deleteError ? (
            <Text style={[t.footnote, styles.deleteError, { color: c.red }]}>
              {deleteError}
            </Text>
          ) : null}
          {requestError ? (
            <Text style={[t.footnote, styles.deleteError, { color: c.red }]}>
              {requestError}
            </Text>
          ) : null}
        </View>
        </PageContainer>
      </ScrollView>

      <MediaDetailDialog
        actions={detailActions}
        badge={
          detailEntry
            ? {
                label: statusLabel(detailEntry.status),
                color: statusColors(detailEntry.status, c).color,
                backgroundColor: statusColors(detailEntry.status, c).background,
              }
            : undefined
        }
        dialogTitle="片单详情"
        facts={
          detailEntry
            ? [
                {
                  label: '加入片单',
                  value: `${detailEntry.createdBy.avatarEmoji} ${detailEntry.createdBy.name}`,
                },
                { label: '加入时间', value: formatMediaDateTime(detailEntry.createdAt) },
                ...(detailEntry.scheduledFor
                  ? [{ label: '观影安排', value: formatSchedule(detailEntry.scheduledFor) }]
                  : []),
                ...(detailLibraries.length
                  ? [
                      {
                        label: '可播放位置',
                        value: detailLibraries.map((library) => library.name).join('、'),
                      },
                    ]
                  : []),
                ...(detailRequest
                  ? [
                      {
                        label: 'MoviePilot',
                        value: `${REQUEST_STATUS_LABELS[detailRequest.status]}${detailRequest.season ? ` · 第 ${detailRequest.season} 季` : ''}`,
                      },
                    ]
                  : []),
              ]
            : []
        }
        mediaType={detailEntry?.mediaTitle.type ?? 'movie'}
        note={detailEntry?.note}
        onClose={() => setDetailEntry(null)}
        originalTitle={detailEntry?.mediaTitle.originalTitle}
        overview={detailEntry?.mediaTitle.overview}
        posterUrl={detailEntry?.mediaTitle.posterUrl}
        references={(detailEntry?.mediaTitle.externalRefs ?? []).map((reference) => ({
          label: reference.provider.toUpperCase(),
          value: reference.externalId,
        }))}
        title={detailEntry?.mediaTitle.title ?? ''}
        visible={Boolean(detailEntry)}
        year={detailEntry?.mediaTitle.year}
      />

      <MediaForm
        entry={editingEntry}
        onClose={() => {
          if (!formOpen) return;
          setFormOpen(false);
        }}
        onSaved={() => setFormOpen(false)}
        visible={formOpen}
      />

      <SubscriptionDialog
        entry={subscriptionEntry}
        onClose={() => {
          if (!subscriptionEntry) return;
          setSubscriptionEntry(null);
        }}
        onSubmitted={() => setSubscriptionEntry(null)}
      />

      <ConfirmDialog
        confirmLabel="取消订阅"
        loading={cancelRequest.isPending}
        message={`取消「${pendingCancel?.entry.mediaTitle.title ?? ''}」${pendingCancel?.request.season ? `第 ${pendingCancel.request.season} 季` : ''}的 MoviePilot 订阅。`}
        onCancel={() => {
          if (!cancelRequest.isPending) setPendingCancel(null);
        }}
        onConfirm={() => {
          if (!pendingCancel) return;
          setRequestError(null);
          cancelRequest.mutate(pendingCancel.request.id, {
            onSuccess: () => {
              setPendingCancel(null);
              void Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              );
            },
            onError: (requestFailure) => {
              setPendingCancel(null);
              setRequestError(
                requestFailure instanceof Error
                  ? requestFailure.message
                  : '取消订阅失败',
              );
            },
          });
        }}
        title="取消 MoviePilot 订阅？"
        visible={Boolean(pendingCancel)}
      />

      <ConfirmDialog
        confirmLabel="移除"
        loading={remove.isPending}
        message={`「${pendingDelete?.mediaTitle.title ?? ''}」将从家庭片单移除。`}
        onCancel={() => {
          if (!remove.isPending) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (!pendingDelete) return;
          remove.mutate(pendingDelete.id, {
            onSuccess: () => {
              setPendingDelete(null);
              void Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              );
            },
            onError: (error) => {
              setPendingDelete(null);
              setDeleteError(
                error instanceof Error ? error.message : '移除失败，请稍后再试',
              );
            },
          });
        }}
        title="移出家庭片单？"
        visible={Boolean(pendingDelete)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pageScroll: { flex: 1 },
  pageScrollContent: { paddingBottom: 36 },
  page: { paddingTop: 8 },
  pageDesktop: { paddingTop: 22 },
  pageHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
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
  toolbar: { gap: 12, marginTop: 16 },
  pollComposeBar: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.md,
    marginTop: 12,
    padding: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  pollComposeStatus: {
    minWidth: 0,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  pollComposeActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  pollComposeCommand: {
    minHeight: 36,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  pollComposeSecondary: {
    minHeight: 36,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  pollComposePrimary: {
    minHeight: 36,
    borderRadius: radius.sm,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  searchBox: {
    height: 44,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: { flex: 1, height: '100%', outlineStyle: 'none' } as never,
  clearSearch: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  filters: { gap: 8, paddingRight: 12 },
  filterButton: {
    minHeight: 34,
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: { paddingTop: 18 },
  mediaGrid: { gap: 12 },
  mediaGridDesktop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch' },
  desktopCardCell: { width: '49%', minWidth: 0 },
  mediaCard: {
    minHeight: 174,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 12,
    flexDirection: 'row',
    gap: 13,
  },
  poster: { width: 100, height: 150, borderRadius: radius.sm },
  posterTrigger: { width: 100, height: 150, borderRadius: radius.sm },
  posterFallback: { alignItems: 'center', justifyContent: 'center' },
  detailPressed: { opacity: 0.72 },
  mediaBody: { flex: 1, minWidth: 0 },
  mediaTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  statusBadge: {
    minHeight: 25,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overview: { lineHeight: 19, marginTop: 9 },
  scheduleBadge: {
    alignSelf: 'flex-start',
    minHeight: 27,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    marginTop: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  playbackActions: {
    marginTop: 9,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  playbackButton: {
    minWidth: 76,
    height: 32,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  requestPanel: {
    marginTop: 9,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: 9,
    gap: 7,
  },
  requestHeader: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  requestStatusBadge: {
    minHeight: 25,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestMessage: { lineHeight: 17 },
  requestActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  requestActionButton: {
    minHeight: 31,
    borderRadius: radius.sm,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  subscribeButton: {
    alignSelf: 'flex-start',
    minHeight: 34,
    marginTop: 9,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  mediaFooter: {
    flex: 1,
    minHeight: 38,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
  },
  externalRefs: { flex: 1, minWidth: 0, gap: 2 },
  cardActions: { flexDirection: 'row', gap: 7 },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loader: { marginTop: 80 },
  deleteError: { textAlign: 'center', marginTop: 12 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  formSheet: {
    width: '100%',
    maxWidth: 720,
    maxHeight: '94%',
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  subscriptionSheet: {
    width: '100%',
    maxWidth: 460,
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  subscriptionContent: { padding: 18, paddingTop: 6, gap: 17 },
  formHeader: {
    minHeight: 68,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formContent: { padding: 18, paddingTop: 6, paddingBottom: 24, gap: 17 },
  metadataSearchPanel: { gap: 16 },
  metadataSearchRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  metadataSearchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 46,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingLeft: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metadataSearchText: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    paddingVertical: 0,
    outlineStyle: 'none',
  } as never,
  metadataSearchButton: {
    width: 92,
    minHeight: 46,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  sourceStatuses: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  sourceStatus: {
    minHeight: 28,
    borderRadius: radius.full,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sourceStatusDot: { width: 7, height: 7, borderRadius: radius.full },
  sourceBadge: {
    minHeight: 23,
    borderRadius: radius.sm,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchResults: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  searchResult: {
    minHeight: 138,
    padding: 11,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
  },
  searchResultPoster: { width: 78, height: 116, borderRadius: radius.sm },
  searchResultBody: { flex: 1, minWidth: 0 },
  searchResultTitleRow: {
    minHeight: 25,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  searchResultOverview: { lineHeight: 18, marginTop: 8 },
  selectResultCue: {
    minHeight: 26,
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  manualEntryButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  selectionToolbar: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  backToSearch: {
    minHeight: 38,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  selectedSources: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 5,
  },
  field: { gap: 7 },
  fieldLabel: { fontWeight: '600' },
  input: {
    minHeight: 44,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multilineInput: { minHeight: 96 },
  noteInput: { minHeight: 76 },
  twoColumns: { flexDirection: 'row', gap: 12 },
  columnField: { flex: 1, minWidth: 0 },
  yearField: { width: 140 },
  statusOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusOption: {
    minWidth: 86,
    height: 36,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  calendarPicker: { borderWidth: 1, borderRadius: radius.md, padding: 10 },
  formMessage: { textAlign: 'center' },
});
