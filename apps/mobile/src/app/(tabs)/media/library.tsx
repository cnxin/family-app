import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Film,
  ListPlus,
  Play,
  RefreshCw,
  Search,
  Server,
} from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ModuleBackButton,
  PageContainer,
  useDesktopLayout,
} from '../../../components/app-shell';
import {
  MediaDetailDialog,
  type MediaDetailAction,
} from '../../../components/media-detail-dialog';
import { Card, EmptyState, Segmented } from '../../../components/ui';
import { photoUri } from '../../../lib/api';
import {
  useAddLibraryItemToWatchlist,
  useMediaLibrary,
  useSyncMediaLibrary,
} from '../../../lib/queries';
import { useSession } from '../../../lib/session';
import { radius, type as t, useTheme } from '../../../lib/theme';
import type { MediaLibraryItem, MediaType } from '../../../lib/types';

type LibraryFilter = MediaType | 'all';

function formatSyncedAt(value: string | null) {
  if (!value) return '尚未同步';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function Poster({ item }: { item: MediaLibraryItem }) {
  const c = useTheme();
  const [failed, setFailed] = useState(false);
  const posterUrl = photoUri(item.posterUrl);
  if (!posterUrl || failed) {
    return (
      <View style={[styles.poster, styles.posterFallback, { backgroundColor: c.fill }]}>
        <Film color={c.tertiaryLabel} size={30} />
      </View>
    );
  }
  return (
    <Image
      accessibilityLabel={`${item.title}海报`}
      contentFit="cover"
      onError={() => setFailed(true)}
      source={{ uri: posterUrl }}
      style={styles.poster}
      transition={120}
    />
  );
}

function LibraryCard({
  item,
  busy,
  onAdd,
  onDetails,
  onOpenWatchlist,
  onPlay,
}: {
  item: MediaLibraryItem;
  busy: boolean;
  onAdd: () => void;
  onDetails: () => void;
  onOpenWatchlist: () => void;
  onPlay: () => void;
}) {
  const c = useTheme();
  return (
    <Card style={styles.itemCard}>
      <Pressable
        accessibilityLabel={`打开${item.title}详情`}
        accessibilityRole="button"
        onPress={onDetails}
        style={({ pressed }) => [
          styles.itemTop,
          pressed && { backgroundColor: c.fill },
        ]}
      >
        <Poster item={item} />
        <View style={styles.itemContent}>
          <View style={styles.titleRow}>
            <Text numberOfLines={2} style={[t.headline, { color: c.label, flex: 1 }]}>
              {item.title}
            </Text>
            <View style={[styles.providerBadge, { backgroundColor: c.blueSoft }]}>
              <Text style={[t.caption, { color: c.blue, fontWeight: '700' }]}>
                {item.connectorName}
              </Text>
            </View>
          </View>
          <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 5 }]}>
            {item.type === 'movie' ? '电影' : '剧集'}
            {item.year ? ` · ${item.year}` : ''}
          </Text>
          {item.overview ? (
            <Text
              numberOfLines={3}
              style={[t.footnote, styles.overview, { color: c.secondaryLabel }]}
            >
              {item.overview}
            </Text>
          ) : null}
          <View style={styles.referenceRow}>
            {item.externalRefs.map((ref) => (
              <Text
                key={`${ref.provider}:${ref.externalId}`}
                style={[t.caption, { color: c.tertiaryLabel }]}
              >
                {ref.provider.toUpperCase()} {ref.externalId}
              </Text>
            ))}
          </View>
        </View>
      </Pressable>
      <View style={[styles.actions, { borderTopColor: c.separator }]}>
        <Pressable
          accessibilityLabel={`查看${item.title}详情`}
          accessibilityRole="button"
          onPress={onDetails}
          style={({ pressed }) => [
            styles.actionButton,
            { backgroundColor: pressed ? c.blueSoft : c.fill },
          ]}
        >
          <Eye color={c.blue} size={16} />
          <Text style={[t.footnote, { color: c.blue, fontWeight: '700' }]}>详情</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`用${item.connectorName}播放${item.title}`}
          accessibilityRole="link"
          disabled={!item.playbackUrl}
          onPress={onPlay}
          style={({ pressed }) => [
            styles.actionButton,
            { backgroundColor: pressed ? c.tintSoft : c.fill },
            !item.playbackUrl && styles.disabled,
          ]}
        >
          <Play color={c.tint} fill={c.tint} size={15} />
          <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>播放</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={
            item.householdMediaId
              ? `打开${item.title}的家庭片单条目`
              : `将${item.title}加入家庭片单`
          }
          accessibilityRole="button"
          disabled={busy}
          onPress={item.householdMediaId ? onOpenWatchlist : onAdd}
          style={({ pressed }) => [
            styles.actionButton,
            {
              backgroundColor: pressed
                ? item.householdMediaId
                  ? c.greenSoft
                  : c.blueSoft
                : c.fill,
            },
            busy && styles.disabled,
          ]}
        >
          {item.householdMediaId ? (
            <Check color={c.green} size={16} />
          ) : (
            <ListPlus color={c.blue} size={16} />
          )}
          <Text
            style={[
              t.footnote,
              {
                color: item.householdMediaId ? c.green : c.blue,
                fontWeight: '700',
              },
            ]}
          >
            {item.householdMediaId ? '已在片单' : '加入片单'}
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}

export default function MediaLibraryScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const { member } = useSession();
  const canManage = member?.role === 'owner' || member?.role === 'admin';
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<MediaLibraryItem | null>(null);
  const library = useMediaLibrary(filter, debouncedSearch, page);
  const sync = useSyncMediaLibrary();
  const add = useAddLibraryItemToWatchlist();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => setPage(1), [filter, debouncedSearch]);

  const syncLibrary = async () => {
    setMessage(null);
    try {
      const response = await sync.mutateAsync();
      const count = response.results.reduce((sum, result) => sum + result.itemCount, 0);
      const matched = response.results.reduce(
        (sum, result) => sum + result.matchedCount,
        0,
      );
      setMessage(`已同步 ${count} 部，关联家庭片单 ${matched} 部`);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '同步失败');
    }
  };

  const addToWatchlist = async (item: MediaLibraryItem) => {
    setMessage(null);
    try {
      const response = await add.mutateAsync(item.id);
      setDetailItem((current) =>
        current?.id === item.id
          ? { ...current, householdMediaId: response.householdMediaId }
          : current,
      );
      setMessage(`「${item.title}」已加入家庭片单`);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加入片单失败');
    }
  };

  const play = async (item: MediaLibraryItem) => {
    if (!item.playbackUrl) return;
    try {
      await Linking.openURL(item.playbackUrl);
    } catch {
      setMessage(`无法打开 ${item.connectorName}`);
    }
  };

  const data = library.data;
  const detailActions: MediaDetailAction[] = detailItem
    ? [
        ...(detailItem.playbackUrl
          ? [
              {
                label: `${detailItem.connectorName} 播放`,
                accessibilityLabel: `在详情中用${detailItem.connectorName}播放${detailItem.title}`,
                icon: Play,
                onPress: () => void play(detailItem),
                role: 'link' as const,
                tone: 'primary' as const,
              },
            ]
          : []),
        {
          label: detailItem.householdMediaId ? '查看家庭片单' : '加入家庭片单',
          accessibilityLabel: detailItem.householdMediaId
            ? `从详情打开${detailItem.title}的家庭片单条目`
            : `从详情将${detailItem.title}加入家庭片单`,
          icon: detailItem.householdMediaId ? Check : ListPlus,
          disabled: add.isPending,
          onPress: () => {
            if (detailItem.householdMediaId) {
              setDetailItem(null);
              router.push({
                pathname: '/media/watchlist',
                params: { mediaId: detailItem.householdMediaId, view: 'detail' },
              });
              return;
            }
            void addToWatchlist(detailItem);
          },
          tone: 'success',
        },
      ]
    : [];

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <PageContainer maxWidth={1120} style={[styles.page, desktop && styles.pageDesktop]}>
          <ModuleBackButton href="/media" label="观影首页" />
          <View style={[styles.header, desktop && styles.headerDesktop]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.footnote, { color: c.blue, fontWeight: '700' }]}>
                {data?.connectors.map((item) => item.name).join(' · ') || '家庭媒体服务'}
              </Text>
              <Text
                accessibilityRole="header"
                style={[desktop ? t.largeTitle : t.title1, { color: c.label, marginTop: 5 }]}
              >
                我的媒体库
              </Text>
              <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 5 }]}>
                {data?.total ?? 0} 部影视 · {formatSyncedAt(data?.lastSyncedAt ?? null)}
              </Text>
            </View>
            {canManage ? (
              <Pressable
                accessibilityLabel="同步媒体库"
                accessibilityRole="button"
                disabled={sync.isPending}
                onPress={() => void syncLibrary()}
                style={({ pressed }) => [
                  styles.syncButton,
                  { backgroundColor: pressed ? c.green : c.tint },
                  sync.isPending && styles.disabled,
                ]}
              >
                {sync.isPending ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <RefreshCw color="#FFFFFF" size={17} />
                )}
                <Text style={[t.subhead, { color: '#FFFFFF', fontWeight: '700' }]}>
                  {sync.isPending ? '同步中' : '同步'}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View style={[styles.toolbar, desktop && styles.toolbarDesktop]}>
            <View
              style={[
                styles.filterControl,
                desktop && styles.filterControlDesktop,
              ]}
            >
              <Segmented
                onChange={setFilter}
                options={[
                  { label: '全部', value: 'all' },
                  { label: '电影', value: 'movie' },
                  { label: '剧集', value: 'series' },
                ]}
                value={filter}
              />
            </View>
            <View style={[styles.searchBox, { backgroundColor: c.card, borderColor: c.separator }]}>
              <Search color={c.tertiaryLabel} size={17} />
              <TextInput
                accessibilityLabel="搜索媒体库"
                onChangeText={setSearch}
                placeholder="搜索媒体库"
                placeholderTextColor={c.tertiaryLabel}
                style={[t.subhead, styles.searchInput, { color: c.label }]}
                value={search}
              />
            </View>
          </View>

          {message ? (
            <View style={[styles.message, { backgroundColor: c.fill }]}>
              <Text style={[t.footnote, { color: c.secondaryLabel }]}>{message}</Text>
            </View>
          ) : null}

          {library.isLoading ? (
            <ActivityIndicator color={c.tint} style={styles.loader} />
          ) : library.error ? (
            <Card style={styles.errorCard}>
              <Server color={c.red} size={21} />
              <Text style={[t.subhead, { color: c.red }]}>
                {library.error instanceof Error ? library.error.message : '媒体库加载失败'}
              </Text>
            </Card>
          ) : data?.items.length ? (
            <>
              <View style={styles.grid}>
                {data.items.map((item) => (
                  <View
                    key={item.id}
                    style={[styles.gridCell, desktop && styles.gridCellDesktop]}
                  >
                    <LibraryCard
                      busy={add.isPending && add.variables === item.id}
                      item={item}
                      onAdd={() => void addToWatchlist(item)}
                      onDetails={() => setDetailItem(item)}
                      onOpenWatchlist={() =>
                        router.push({
                          pathname: '/media/watchlist',
                          params: { mediaId: item.householdMediaId!, view: 'detail' },
                        })
                      }
                      onPlay={() => void play(item)}
                    />
                  </View>
                ))}
              </View>
              {data.pages > 1 ? (
                <View style={styles.pagination}>
                  <Pressable
                    accessibilityLabel="上一页"
                    accessibilityRole="button"
                    disabled={page <= 1}
                    onPress={() => setPage((value) => Math.max(1, value - 1))}
                    style={[styles.pageButton, { backgroundColor: c.fill }, page <= 1 && styles.disabled]}
                  >
                    <ChevronLeft color={c.label} size={18} />
                  </Pressable>
                  <Text style={[t.footnote, { color: c.secondaryLabel }]}>
                    {data.page} / {data.pages}
                  </Text>
                  <Pressable
                    accessibilityLabel="下一页"
                    accessibilityRole="button"
                    disabled={page >= data.pages}
                    onPress={() => setPage((value) => Math.min(data.pages, value + 1))}
                    style={[
                      styles.pageButton,
                      { backgroundColor: c.fill },
                      page >= data.pages && styles.disabled,
                    ]}
                  >
                    <ChevronRight color={c.label} size={18} />
                  </Pressable>
                </View>
              ) : null}
            </>
          ) : (
            <Card style={styles.emptyCard}>
              <EmptyState
                emoji="🎞️"
                hint={
                  data?.lastSyncedAt
                    ? '当前筛选条件下没有影视'
                    : canManage
                      ? '等待首次读取 Plex 或 Emby 媒体库'
                      : '等待家庭管理员完成首次同步'
                }
                title={data?.lastSyncedAt ? '没有匹配结果' : '媒体库尚未同步'}
              />
            </Card>
          )}
        </PageContainer>
      </ScrollView>
      <MediaDetailDialog
        actions={detailActions}
        badge={
          detailItem
            ? {
                label: detailItem.connectorName,
                color: c.blue,
                backgroundColor: c.blueSoft,
              }
            : undefined
        }
        dialogTitle="媒体库详情"
        facts={
          detailItem
            ? [
                { label: '媒体来源', value: detailItem.connectorName },
                { label: '最近同步', value: formatSyncedAt(detailItem.lastSeenAt) },
                {
                  label: '家庭片单',
                  value: detailItem.householdMediaId ? '已加入' : '尚未加入',
                },
              ]
            : []
        }
        mediaType={detailItem?.type ?? 'movie'}
        onClose={() => setDetailItem(null)}
        originalTitle={detailItem?.originalTitle}
        overview={detailItem?.overview}
        posterUrl={photoUri(detailItem?.posterUrl ?? null)}
        references={(detailItem?.externalRefs ?? []).map((reference) => ({
          label: reference.provider.toUpperCase(),
          value: reference.externalId,
        }))}
        title={detailItem?.title ?? ''}
        visible={Boolean(detailItem)}
        year={detailItem?.year}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { paddingTop: 10, paddingBottom: 44 },
  pageDesktop: { paddingTop: 30 },
  header: { gap: 16, marginTop: 18 },
  headerDesktop: { flexDirection: 'row', alignItems: 'center', marginTop: 0 },
  syncButton: {
    height: 44,
    minWidth: 104,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  toolbar: { gap: 12, marginTop: 24 },
  toolbarDesktop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  filterControl: { width: '100%' },
  filterControlDesktop: { width: 300 },
  searchBox: {
    height: 44,
    minWidth: 260,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: { flex: 1, minWidth: 0, height: 44, outlineStyle: 'none' } as never,
  message: { marginTop: 12, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 9 },
  loader: { marginTop: 70 },
  errorCard: { marginTop: 24, minHeight: 90, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 20 },
  gridCell: { width: '100%', minWidth: 0 },
  gridCellDesktop: { width: '49%', flexGrow: 1 },
  itemCard: { overflow: 'hidden' },
  itemTop: { minHeight: 178, padding: 13, flexDirection: 'row', gap: 13 },
  poster: { width: 100, height: 150, borderRadius: radius.sm },
  posterFallback: { alignItems: 'center', justifyContent: 'center' },
  itemContent: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  providerBadge: { borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 4 },
  overview: { marginTop: 10, lineHeight: 18 },
  referenceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 9 },
  actions: { minHeight: 58, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', padding: 7, gap: 7 },
  actionButton: { flex: 1, minHeight: 44, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  disabled: { opacity: 0.42 },
  pagination: { marginTop: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  pageButton: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  emptyCard: { marginTop: 24, minHeight: 270, justifyContent: 'center' },
});
