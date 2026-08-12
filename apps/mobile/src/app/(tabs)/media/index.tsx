import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import {
  ArrowRight,
  CalendarDays,
  Film,
  History,
  Library,
  ListVideo,
  Play,
  Server,
  Settings2,
  Vote,
} from 'lucide-react-native';
import React from 'react';
import {
  ActivityIndicator,
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
import {
  GroupedList,
  GroupedNavigationRow,
  SummaryBand,
} from '../../../components/ui';
import { parseDate } from '../../../lib/date';
import {
  useMedia,
  useMediaConnectors,
  usePolls,
  useViewingSessions,
} from '../../../lib/queries';
import { useSession } from '../../../lib/session';
import { radius, type as t, useTheme } from '../../../lib/theme';
import type { MediaConnectorSummary } from '../../../lib/types';

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatSchedule(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(parseDate(value));
}

function SchedulePoster({ posterUrl, title }: { posterUrl: string | null; title: string }) {
  const c = useTheme();
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => setFailed(false), [posterUrl]);

  if (!posterUrl || failed) {
    return (
      <View style={[styles.schedulePoster, styles.schedulePosterFallback, { backgroundColor: c.mediaSoft }]}>
        <Film color={c.mediaAccent} size={22} />
      </View>
    );
  }

  return (
    <Image
      accessibilityLabel={`${title}海报`}
      contentFit="cover"
      onError={() => setFailed(true)}
      source={{ uri: posterUrl }}
      style={styles.schedulePoster}
      transition={160}
    />
  );
}

function Connector({ connector }: { connector: MediaConnectorSummary }) {
  const c = useTheme();
  const status = connector.available
    ? { label: '已连接', color: c.green, background: c.greenSoft }
    : connector.state === 'not_configured'
      ? { label: '未配置', color: c.secondaryLabel, background: c.fill }
      : connector.state === 'needs_credential'
        ? { label: '待授权', color: c.orange, background: c.orangeSoft }
        : { label: '离线', color: c.red, background: c.redSoft };
  return (
    <View style={[styles.connectorRow, { borderBottomColor: c.separator }]}>
      <View style={[styles.connectorIcon, { backgroundColor: c.mediaSoft }]}>
        <Server color={c.mediaAccent} size={18} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]}>{connector.name}</Text>
        <Text numberOfLines={1} style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>
          {connector.role === 'library' ? '媒体库' : '自动化'} · {connector.message}
        </Text>
      </View>
      <View style={[styles.statusBadge, { backgroundColor: status.background }]}>
        <Text style={[t.caption, { color: status.color, fontWeight: '700' }]}>{status.label}</Text>
      </View>
    </View>
  );
}

export default function MediaHomeScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const { member } = useSession();
  const params = useLocalSearchParams<{ mediaId?: string }>();
  const mediaId = firstParam(params.mediaId);
  const { data: entries, isLoading } = useMedia('all', '', !mediaId);
  const { data: connectors } = useMediaConnectors();
  const { data: polls } = usePolls(!mediaId);
  const { data: viewingSessions } = useViewingSessions(!mediaId);

  if (mediaId) {
    return <Redirect href={{ pathname: '/media/watchlist', params: { mediaId } }} />;
  }

  const watchlistCount = entries?.filter((entry) => entry.status === 'watchlist').length ?? 0;
  const scheduled =
    entries
      ?.filter((entry) => entry.status === 'scheduled' && entry.scheduledFor)
      .sort((a, b) => (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? '')) ?? [];
  const watchingCount = entries?.filter((entry) => entry.status === 'watching').length ?? 0;
  const mediaPolls =
    polls?.filter((poll) => poll.status === 'open' && poll.sourceModule === 'media') ?? [];

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <PageContainer maxWidth={1120} style={[styles.page, desktop && styles.pageDesktop]}>
          <ModuleBackButton href="/" label="家庭首页" />
          <View
            style={[
              styles.headerCard,
              { backgroundColor: c.card, borderColor: c.mediaBorder },
              desktop && styles.headerDesktop,
            ]}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={[styles.eyebrowChip, { backgroundColor: c.mediaSoft }]}>
                <Film color={c.mediaAccent} size={14} />
                <Text style={[t.footnote, { color: c.mediaAccent, fontWeight: '700' }]}>今晚看什么</Text>
              </View>
              <Text
                accessibilityRole="header"
                style={[desktop ? t.largeTitle : t.title1, { color: c.label, marginTop: 8 }]}
              >
                家庭观影
              </Text>
              <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 6 }]}>
                家庭片单共 {entries?.length ?? 0} 部 · {scheduled.length ? `近期排期 ${scheduled.length} 部` : '准备一场家庭放映'}
              </Text>
            </View>
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push('/media/watchlist')}
              style={({ pressed }) => [
                styles.primaryAction,
                { backgroundColor: pressed ? c.green : c.mediaAccent },
              ]}
            >
              <ListVideo color="#FFFFFF" size={18} />
              <Text style={[t.subhead, { color: '#FFFFFF', fontWeight: '700' }]}>打开片单</Text>
            </Pressable>
          </View>

          {isLoading ? (
            <ActivityIndicator color={c.mediaAccent} style={styles.loader} />
          ) : (
            <SummaryBand
              items={[
                {
                  color: c.tint,
                  icon: Film,
                  label: '想看',
                  onPress: () => router.push('/media/watchlist'),
                  value: watchlistCount,
                },
                {
                  color: c.orange,
                  icon: CalendarDays,
                  label: '已排期',
                  onPress: () => router.push('/media/watchlist'),
                  value: scheduled.length,
                },
                {
                  color: c.blue,
                  icon: Play,
                  label: '观看中',
                  onPress: () => router.push('/media/watchlist'),
                  value: watchingCount,
                },
              ]}
              style={styles.summaryBand}
              testID="media-summary-band"
            />
          )}

          <View style={styles.navigationSection}>
            <Text style={[t.footnote, styles.groupLabel, { color: c.secondaryLabel }]}>浏览与管理</Text>
            <GroupedList>
              <GroupedNavigationRow
                backgroundColor={c.mediaSoft}
                color={c.mediaAccent}
                icon={ListVideo}
                onPress={() => router.push('/media/watchlist')}
                subtitle={`${entries?.length ?? 0} 部影视`}
                title="家庭片单"
              />
              <GroupedNavigationRow
                backgroundColor={c.blueSoft}
                color={c.blue}
                icon={Library}
                onPress={() => router.push('/media/library')}
                subtitle="Plex 与 Emby"
                title="我的媒体库"
              />
              <GroupedNavigationRow
                backgroundColor={c.tintSoft}
                color={c.tint}
                icon={Vote}
                onPress={() => router.push({ pathname: '/media/polls', params: { returnTo: 'media' } })}
                subtitle={`${mediaPolls.length} 个进行中`}
                title="观影投票"
              />
              <GroupedNavigationRow
                backgroundColor={c.greenSoft}
                color={c.green}
                icon={History}
                last
                onPress={() => router.push('/media/history')}
                subtitle={`${viewingSessions?.length ?? 0} 次播放`}
                title="观看记录"
              />
            </GroupedList>
          </View>

          <View style={[styles.contentGrid, desktop && styles.contentGridDesktop]}>
            <View style={styles.contentColumn}>
              <View style={styles.sectionHeader}>
                <Text style={[t.title2, { color: c.label }]}>近期安排</Text>
                <Pressable accessibilityRole="link" onPress={() => router.push('/media/watchlist')} style={styles.textLink}>
                  <Text style={[t.footnote, { color: c.mediaAccent, fontWeight: '700' }]}>全部片单</Text>
                  <ArrowRight color={c.mediaAccent} size={15} />
                </Pressable>
              </View>
              <GroupedList>
                {scheduled.length ? (
                  scheduled.slice(0, 4).map((entry) => (
                    <Pressable
                      accessibilityRole="link"
                      key={entry.id}
                      onPress={() =>
                        router.push({ pathname: '/media/watchlist', params: { mediaId: entry.id } })
                      }
                      style={[styles.scheduleRow, { borderBottomColor: c.separator }]}
                    >
                      <SchedulePoster
                        posterUrl={entry.mediaTitle.posterUrl}
                        title={entry.mediaTitle.title}
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={[t.subhead, { color: c.label, fontWeight: '700' }]}>
                          {entry.mediaTitle.title}
                        </Text>
                        <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 4 }]}>
                          {formatSchedule(entry.scheduledFor!)}
                        </Text>
                      </View>
                      <ArrowRight color={c.tertiaryLabel} size={16} />
                    </Pressable>
                  ))
                ) : (
                  <View style={styles.emptyRow}>
                    <CalendarDays color={c.tertiaryLabel} size={20} />
                    <Text style={[t.subhead, { color: c.secondaryLabel }]}>暂无观影排期</Text>
                  </View>
                )}
              </GroupedList>
            </View>

            <View style={styles.contentColumn}>
              <View style={styles.sectionHeader}>
                <Text style={[t.title2, { color: c.label }]}>媒体服务</Text>
                {member?.role === 'owner' || member?.role === 'admin' ? (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => router.push('/media/settings')}
                    style={styles.textLink}
                  >
                    <Settings2 color={c.mediaAccent} size={15} />
                    <Text style={[t.footnote, { color: c.mediaAccent, fontWeight: '700' }]}>观影设置</Text>
                  </Pressable>
                ) : null}
              </View>
              <GroupedList>
                {connectors?.length ? (
                  connectors.map((connector) => <Connector connector={connector} key={connector.key} />)
                ) : (
                  <View style={styles.emptyRow}>
                    <Server color={c.tertiaryLabel} size={20} />
                    <Text style={[t.subhead, { color: c.secondaryLabel }]}>暂无媒体服务</Text>
                  </View>
                )}
              </GroupedList>
            </View>
          </View>
        </PageContainer>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { paddingTop: 10, paddingBottom: 40 },
  pageDesktop: { paddingTop: 30 },
  headerCard: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    marginTop: 14,
    gap: 16,
  },
  headerDesktop: { flexDirection: 'row', alignItems: 'center', marginTop: 0 },
  eyebrowChip: {
    alignSelf: 'flex-start',
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  primaryAction: {
    minHeight: 44,
    borderRadius: radius.md,
    paddingHorizontal: 18,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loader: { marginTop: 34 },
  summaryBand: { marginTop: 24 },
  navigationSection: { marginTop: 24 },
  groupLabel: { fontWeight: '600', marginBottom: 8, paddingHorizontal: 4 },
  contentGrid: { gap: 26, marginTop: 32 },
  contentGridDesktop: { flexDirection: 'row', alignItems: 'flex-start' },
  contentColumn: { flex: 1, minWidth: 0 },
  sectionHeader: {
    minHeight: 36,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  textLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  scheduleRow: {
    minHeight: 90,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  schedulePoster: {
    borderRadius: radius.md,
    height: 72,
    width: 50,
  },
  schedulePosterFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectorRow: {
    minHeight: 70,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  connectorIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadge: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  emptyRow: {
    minHeight: 82,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
});
