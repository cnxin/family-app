import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import {
  CheckCircle2,
  Film,
  PauseCircle,
  Play,
  Radio,
  RefreshCw,
  StopCircle,
  UserRound,
} from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ModuleBackButton,
  PageContainer,
  useDesktopLayout,
} from '../../../components/app-shell';
import { Card, EmptyState, Segmented } from '../../../components/ui';
import { photoUri } from '../../../lib/api';
import { useViewingSessions } from '../../../lib/queries';
import { useSession } from '../../../lib/session';
import { radius, type as t, useTheme } from '../../../lib/theme';
import type {
  ViewingSession,
  ViewingSessionStatus,
} from '../../../lib/types';

type HistoryFilter = 'all' | 'active' | 'finished';

const STATUS_LABELS: Record<ViewingSessionStatus, string> = {
  active: '播放中',
  paused: '已暂停',
  stopped: '已停止',
  completed: '已看完',
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDuration(milliseconds: number) {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours} 小时 ${remainder} 分` : `${remainder} 分钟`;
}

function statusAppearance(status: ViewingSessionStatus, c: ReturnType<typeof useTheme>) {
  if (status === 'active') {
    return { color: c.green, background: c.greenSoft, icon: Radio };
  }
  if (status === 'paused') {
    return { color: c.orange, background: c.orangeSoft, icon: PauseCircle };
  }
  if (status === 'completed') {
    return { color: c.blue, background: c.blueSoft, icon: CheckCircle2 };
  }
  return { color: c.secondaryLabel, background: c.fill, icon: StopCircle };
}

function SessionPoster({ session }: { session: ViewingSession }) {
  const c = useTheme();
  const [failed, setFailed] = useState(false);
  const uri = photoUri(session.posterUrl);
  if (!uri || failed) {
    return (
      <View style={[styles.poster, styles.posterFallback, { backgroundColor: c.fill }]}>
        <Film color={c.tertiaryLabel} size={27} />
      </View>
    );
  }
  return (
    <Image
      accessibilityLabel={`${session.title}海报`}
      contentFit="cover"
      onError={() => setFailed(true)}
      source={{ uri }}
      style={styles.poster}
      transition={120}
    />
  );
}

function SessionCard({ session }: { session: ViewingSession }) {
  const c = useTheme();
  const appearance = statusAppearance(session.status, c);
  const StatusIcon = appearance.icon;
  const progress = Math.max(0, Math.min(100, session.percentage));
  const openPlayback = async () => {
    if (!session.playbackUrl) return;
    await Linking.openURL(session.playbackUrl);
  };

  return (
    <Card style={styles.sessionCard}>
      <View style={styles.sessionBody}>
        <SessionPoster session={session} />
        <View style={styles.sessionContent}>
          <View style={styles.titleRow}>
            <Text numberOfLines={2} style={[t.headline, styles.title, { color: c.label }]}>
              {session.title}
            </Text>
            <View style={[styles.statusBadge, { backgroundColor: appearance.background }]}>
              <StatusIcon color={appearance.color} size={14} />
              <Text style={[t.caption, { color: appearance.color, fontWeight: '700' }]}>
                {STATUS_LABELS[session.status]}
              </Text>
            </View>
          </View>

          <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 5 }]}>
            {session.connectorName} · {formatDate(session.lastEventAt)}
          </Text>

          <View style={styles.memberRow}>
            <UserRound color={c.tertiaryLabel} size={14} />
            <Text numberOfLines={1} style={[t.footnote, { color: c.secondaryLabel, flex: 1 }]}>
              {session.participants.map((item) => item.member.name).join('、') || '家庭成员'}
              {session.deviceName ? ` · ${session.deviceName}` : ''}
            </Text>
          </View>

          <View style={[styles.progressTrack, { backgroundColor: c.fill }]}>
            <View
              style={[
                styles.progressValue,
                { backgroundColor: appearance.color, width: `${progress}%` },
              ]}
            />
          </View>
          <View style={styles.progressLabels}>
            <Text style={[t.caption, { color: c.secondaryLabel }]}>
              {formatDuration(session.positionMs)}
            </Text>
            <Text style={[t.caption, { color: c.secondaryLabel }]}>
              {session.durationMs ? formatDuration(session.durationMs) : `${Math.round(progress)}%`}
            </Text>
          </View>
        </View>
      </View>

      {session.playbackUrl ? (
        <Pressable
          accessibilityLabel={`用${session.connectorName}打开${session.title}`}
          accessibilityRole="link"
          onPress={() => void openPlayback()}
          style={({ pressed }) => [
            styles.playButton,
            { backgroundColor: pressed ? c.tintSoft : c.fill },
          ]}
        >
          <Play color={c.tint} fill={c.tint} size={15} />
          <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>在媒体服务中打开</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

export default function ViewingHistoryScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const { member } = useSession();
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const history = useViewingSessions();
  const sessions = useMemo(() => {
    if (!history.data) return [];
    if (filter === 'active') {
      return history.data.filter(
        (session) => session.status === 'active' || session.status === 'paused',
      );
    }
    if (filter === 'finished') {
      return history.data.filter(
        (session) => session.status === 'stopped' || session.status === 'completed',
      );
    }
    return history.data;
  }, [filter, history.data]);
  const myCount =
    history.data?.filter((session) =>
      session.participants.some((participant) => participant.member.id === member?.id),
    ).length ?? 0;

  const refresh = async () => {
    await history.refetch();
    void Haptics.selectionAsync();
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <PageContainer maxWidth={1120} style={[styles.page, desktop && styles.pageDesktop]}>
          <ModuleBackButton href="/media" label="观影首页" />
          <View style={[styles.header, desktop && styles.headerDesktop]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.footnote, { color: c.accent, fontWeight: '700' }]}>家庭播放动态</Text>
              <Text
                accessibilityRole="header"
                style={[desktop ? t.largeTitle : t.title1, { color: c.label, marginTop: 5 }]}
              >
                观看记录
              </Text>
              <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 5 }]}>
                共 {history.data?.length ?? 0} 次 · 我的记录 {myCount} 次
              </Text>
            </View>
            <Pressable
              accessibilityLabel="刷新观看记录"
              accessibilityRole="button"
              disabled={history.isFetching}
              onPress={() => void refresh()}
              style={({ pressed }) => [
                styles.refreshButton,
                { backgroundColor: pressed ? c.tintSoft : c.card, borderColor: c.separator },
                history.isFetching && styles.disabled,
              ]}
            >
              {history.isFetching ? (
                <ActivityIndicator color={c.tint} size="small" />
              ) : (
                <RefreshCw color={c.tint} size={17} />
              )}
              <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>刷新</Text>
            </Pressable>
          </View>

          <View style={styles.filters}>
            <Segmented<HistoryFilter>
              onChange={setFilter}
              options={[
                { label: '全部', value: 'all' },
                { label: '进行中', value: 'active' },
                { label: '已结束', value: 'finished' },
              ]}
              value={filter}
            />
          </View>

          {history.isLoading ? (
            <ActivityIndicator color={c.tint} style={styles.loader} />
          ) : history.error ? (
            <Card style={styles.emptyCard}>
              <EmptyState emoji="!" hint={history.error.message} title="观看记录加载失败" />
            </Card>
          ) : sessions.length ? (
            <View style={styles.grid}>
              {sessions.map((session) => (
                <View key={session.id} style={[styles.gridCell, desktop && styles.gridCellDesktop]}>
                  <SessionCard session={session} />
                </View>
              ))}
            </View>
          ) : (
            <Card style={styles.emptyCard}>
              <EmptyState
                emoji="▶"
                hint={filter === 'all' ? 'Plex 或 Emby 开始播放后会出现在这里' : '当前筛选下没有记录'}
                title={filter === 'all' ? '还没有观看记录' : '没有匹配记录'}
              />
            </Card>
          )}
        </PageContainer>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { paddingTop: 10, paddingBottom: 44 },
  pageDesktop: { paddingTop: 30 },
  header: { gap: 16, marginTop: 18 },
  headerDesktop: { flexDirection: 'row', alignItems: 'center', marginTop: 0 },
  refreshButton: {
    minHeight: 44,
    minWidth: 96,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: 14,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  filters: { width: '100%', maxWidth: 440, marginTop: 24 },
  loader: { marginTop: 48 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 22 },
  gridCell: { width: '100%', minWidth: 0 },
  gridCellDesktop: { width: '48%', flexGrow: 1 },
  sessionCard: { overflow: 'hidden' },
  sessionBody: { minHeight: 152, flexDirection: 'row', padding: 13, gap: 13 },
  poster: { width: 84, height: 126, borderRadius: radius.sm },
  posterFallback: { alignItems: 'center', justifyContent: 'center' },
  sessionContent: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  title: { flex: 1, minWidth: 0 },
  statusBadge: {
    minHeight: 25,
    borderRadius: radius.sm,
    paddingHorizontal: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  memberRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 9 },
  progressValue: { height: 6, borderRadius: 3 },
  progressLabels: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  playButton: {
    minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'transparent',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  emptyCard: { marginTop: 22 },
  disabled: { opacity: 0.5 },
});
