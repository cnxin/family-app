import { Redirect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
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
  type LucideIcon,
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
import { Card } from '../../../components/ui';
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

function Metric({
  icon: Icon,
  label,
  value,
  color,
  background,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  color: string;
  background: string;
}) {
  const c = useTheme();
  return (
    <Card style={styles.metricCard}>
      <View style={[styles.metricIcon, { backgroundColor: background }]}>
        <Icon color={color} size={19} />
      </View>
      <Text style={[styles.metricValue, { color: c.label }]}>{value}</Text>
      <Text style={[t.caption, { color: c.secondaryLabel }]}>{label}</Text>
    </Card>
  );
}

function ActionCard({
  href,
  icon: Icon,
  label,
  status,
  color,
  background,
}: {
  href: Href;
  icon: LucideIcon;
  label: string;
  status: string;
  color: string;
  background: string;
}) {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(href)}
      style={({ pressed }) => [styles.actionCell, { opacity: pressed ? 0.72 : 1 }]}
    >
      <Card style={[styles.actionCard, desktop && styles.actionCardDesktop]}>
        <View style={[styles.actionIcon, { backgroundColor: background }]}>
          <Icon color={color} size={22} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[t.headline, { color: c.label }]}>{label}</Text>
          <Text numberOfLines={1} style={[t.caption, { color: c.secondaryLabel, marginTop: 4 }]}>
            {status}
          </Text>
        </View>
        {desktop ? (
          <ArrowRight color={c.tertiaryLabel} size={17} />
        ) : (
          <View style={styles.actionArrow}>
            <ArrowRight color={c.tertiaryLabel} size={17} />
          </View>
        )}
      </Card>
    </Pressable>
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
      <View style={[styles.connectorIcon, { backgroundColor: c.fill }]}>
        <Server color={c.secondaryLabel} size={17} />
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
          <View style={[styles.header, desktop && styles.headerDesktop]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.footnote, { color: c.accent, fontWeight: '700' }]}>今晚看什么</Text>
              <Text
                accessibilityRole="header"
                style={[desktop ? t.largeTitle : t.title1, { color: c.label, marginTop: 5 }]}
              >
                家庭观影
              </Text>
              <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 5 }]}>
                家庭片单共 {entries?.length ?? 0} 部
              </Text>
            </View>
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push('/media/watchlist')}
              style={({ pressed }) => [
                styles.primaryAction,
                { backgroundColor: pressed ? c.green : c.tint },
              ]}
            >
              <ListVideo color="#FFFFFF" size={18} />
              <Text style={[t.subhead, { color: '#FFFFFF', fontWeight: '700' }]}>打开片单</Text>
            </Pressable>
          </View>

          {isLoading ? (
            <ActivityIndicator color={c.tint} style={styles.loader} />
          ) : (
            <View style={styles.metrics}>
              <View style={styles.metricCell}>
                <Metric background={c.tintSoft} color={c.tint} icon={Film} label="想看" value={watchlistCount} />
              </View>
              <View style={styles.metricCell}>
                <Metric background={c.orangeSoft} color={c.orange} icon={CalendarDays} label="已排期" value={scheduled.length} />
              </View>
              <View style={styles.metricCell}>
                <Metric background={c.blueSoft} color={c.blue} icon={Play} label="观看中" value={watchingCount} />
              </View>
            </View>
          )}

          <View style={styles.actionGrid}>
            <ActionCard
              background={c.accentSoft}
              color={c.accent}
              href="/media/watchlist"
              icon={ListVideo}
              label="家庭片单"
              status={`${entries?.length ?? 0} 部影视`}
            />
            <ActionCard
              background={c.blueSoft}
              color={c.blue}
              href="/media/library"
              icon={Library}
              label="我的媒体库"
              status="Plex 与 Emby"
            />
            <ActionCard
              background={c.blueSoft}
              color={c.blue}
              href={{ pathname: '/media/polls', params: { returnTo: 'media' } }}
              icon={Vote}
              label="观影投票"
              status={`${mediaPolls.length} 个进行中`}
            />
            <ActionCard
              background={c.greenSoft}
              color={c.green}
              href="/media/history"
              icon={History}
              label="观看记录"
              status={`${viewingSessions?.length ?? 0} 次播放`}
            />
          </View>

          <View style={[styles.contentGrid, desktop && styles.contentGridDesktop]}>
            <View style={styles.contentColumn}>
              <View style={styles.sectionHeader}>
                <Text style={[t.title2, { color: c.label }]}>近期安排</Text>
                <Pressable accessibilityRole="link" onPress={() => router.push('/media/watchlist')} style={styles.textLink}>
                  <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>全部片单</Text>
                  <ArrowRight color={c.tint} size={15} />
                </Pressable>
              </View>
              <Card style={styles.listCard}>
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
                      <View style={[styles.scheduleDate, { backgroundColor: c.orangeSoft }]}>
                        <CalendarDays color={c.orange} size={18} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={[t.subhead, { color: c.label, fontWeight: '700' }]}>
                          {entry.mediaTitle.title}
                        </Text>
                        <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>
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
              </Card>
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
                    <Settings2 color={c.tint} size={15} />
                    <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>观影设置</Text>
                  </Pressable>
                ) : null}
              </View>
              <Card style={styles.listCard}>
                {connectors?.length ? (
                  connectors.map((connector) => <Connector connector={connector} key={connector.key} />)
                ) : (
                  <View style={styles.emptyRow}>
                    <Server color={c.tertiaryLabel} size={20} />
                    <Text style={[t.subhead, { color: c.secondaryLabel }]}>暂无媒体服务</Text>
                  </View>
                )}
              </Card>
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
  header: { gap: 16, marginTop: 18 },
  headerDesktop: { flexDirection: 'row', alignItems: 'center', marginTop: 0 },
  primaryAction: {
    height: 44,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loader: { marginTop: 34 },
  metrics: { flexDirection: 'row', gap: 10, marginTop: 26 },
  metricCell: { flex: 1, minWidth: 0 },
  metricCard: { minHeight: 104, padding: 13 },
  metricIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricValue: { fontSize: 24, fontWeight: '700', marginTop: 10 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 18 },
  actionCell: { width: '48%', minWidth: 0, flexGrow: 1 },
  actionCard: {
    minHeight: 122,
    padding: 14,
    alignItems: 'flex-start',
    gap: 10,
  },
  actionCardDesktop: {
    minHeight: 96,
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionArrow: { position: 'absolute', top: 25, right: 13 },
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
  textLink: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 4 },
  listCard: { overflow: 'hidden' },
  scheduleRow: {
    minHeight: 68,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  scheduleDate: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectorRow: {
    minHeight: 68,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  connectorIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadge: { borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 5 },
  emptyRow: {
    minHeight: 82,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
});
