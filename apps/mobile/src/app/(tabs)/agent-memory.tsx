import * as Haptics from 'expo-haptics';
import { useRouter, type Href } from 'expo-router';
import {
  CalendarDays,
  ChefHat,
  ChevronRight,
  Flame,
  Lightbulb,
  MessageCircle,
  Sparkles,
  Trash2,
  Utensils,
  type LucideIcon,
} from 'lucide-react-native';
import React from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  FadeInDown,
  useReducedMotion,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageContainer } from '../../components/app-shell';
import {
  Card,
  ConfirmDialog,
  EmptyState,
  PressableScale,
  Segmented,
  SkeletonRows,
} from '../../components/ui';
import {
  useAgentMemories,
  useAgentProfile,
  useClearAgentMemories,
} from '../../lib/queries';
import { useSession } from '../../lib/session';
import { radius, type as t, useTheme } from '../../lib/theme';
import type {
  AgentMemoryConfidenceSource,
  AgentMemoryItem,
  AgentMemoryKey,
  AgentMemoryKind,
  AgentMemoryScope,
} from '../../lib/types';

const SCOPE_OPTIONS: { label: string; value: AgentMemoryScope }[] = [
  { label: '我的记忆', value: 'member_private' },
  { label: '家庭共享', value: 'household' },
];

const KIND_OPTIONS: { label: string; value: VisibleMemoryKind }[] = [
  { label: '偏好', value: 'preference' },
  { label: '事实', value: 'fact' },
  { label: '对话摘要', value: 'episodic_summary' },
];

type VisibleMemoryKind = Exclude<AgentMemoryKind, 'routine_context'>;

const MEMORY_ICON: Record<AgentMemoryKey, LucideIcon> = {
  diet_restriction: Utensils,
  spice_level: Flame,
  cooking_skill: ChefHat,
  schedule_preference: CalendarDays,
  reply_style: MessageCircle,
  other: Lightbulb,
};

const CONFIDENCE_LABEL: Record<AgentMemoryConfidenceSource, string> = {
  explicit: '您的确认',
  business: '业务记录',
  summary_candidate: '对话推测',
};

const MEMORY_KEY_LABEL: Record<AgentMemoryKey, string> = {
  diet_restriction: '饮食限制',
  spice_level: '口味偏好',
  cooking_skill: '厨艺能力',
  schedule_preference: '日程偏好',
  reply_style: '回复方式',
  other: '其他信息',
};

export default function AgentMemoryScreen() {
  const c = useTheme();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const { member } = useSession();
  const [scope, setScope] = React.useState<AgentMemoryScope>('member_private');
  const [kind, setKind] = React.useState<VisibleMemoryKind>('preference');
  const [clearVisible, setClearVisible] = React.useState(false);
  const [filterTransitioning, setFilterTransitioning] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState('');
  const transitionTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeQuery = useAgentMemories('active', scope);
  const profileQuery = useAgentProfile();
  const candidateQuery = useAgentMemories(
    'candidate',
    'member_private',
    scope === 'member_private',
  );
  const clearMemories = useClearAgentMemories();

  React.useEffect(() => () => {
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
  }, []);

  const transitionFilter = React.useCallback((update: () => void) => {
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    setFilterTransitioning(!reduceMotion);
    update();
    if (reduceMotion) return;
    transitionTimer.current = setTimeout(() => {
      setFilterTransitioning(false);
      transitionTimer.current = null;
    }, 180);
  }, [reduceMotion]);

  const memories = React.useMemo(() => {
    const rows = [
      ...(scope === 'member_private' ? candidateQuery.data ?? [] : []),
      ...(activeQuery.data ?? []),
    ];
    return rows
      .filter((item) => item.kind === kind)
      .sort((left, right) => {
        if (left.status === 'candidate' && right.status !== 'candidate') return -1;
        if (left.status !== 'candidate' && right.status === 'candidate') return 1;
        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      });
  }, [activeQuery.data, candidateQuery.data, kind, scope]);

  const loading = activeQuery.isPending
    || (scope === 'member_private' && candidateQuery.isPending)
    || filterTransitioning;
  const error = activeQuery.error
    ?? (scope === 'member_private' ? candidateQuery.error : null);
  const maxWidth = member?.role === 'member' ? 720 : 1040;

  const retry = () => {
    void activeQuery.refetch();
    if (scope === 'member_private') void candidateQuery.refetch();
  };

  const clearPrivateMemories = () => {
    clearMemories.mutate(undefined, {
      onSuccess: (result) => {
        setClearVisible(false);
        setAnnouncement(
          result.forgottenCount > 0
            ? `已遗忘 ${result.forgottenCount} 条个人记忆`
            : '当前没有需要清空的个人记忆',
        );
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          '已清空',
          result.forgottenCount > 0
            ? `已遗忘 ${result.forgottenCount} 条个人记忆`
            : '当前没有需要清空的个人记忆',
        );
      },
      onError: (mutationError) => {
        Alert.alert(
          '清空失败',
          mutationError instanceof Error ? mutationError.message : '请稍后再试',
        );
      },
    });
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bg }]} edges={['top']}>
      <PageContainer maxWidth={maxWidth} style={styles.page}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[t.largeTitle, { color: c.label }]}>
            小管家记忆
          </Text>
          <Text style={[t.subhead, styles.subtitle, { color: c.secondaryLabel }]}>
            管理您的个人偏好与共享知识
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.filters}>
            <Segmented
              haptic
              onChange={(nextScope) => transitionFilter(() => setScope(nextScope))}
              options={SCOPE_OPTIONS}
              value={scope}
            />
            <Segmented
              haptic
              onChange={(nextKind) => transitionFilter(() => setKind(nextKind))}
              options={KIND_OPTIONS}
              value={kind}
            />
          </View>

          {profileQuery.data?.memoryEnabled === false ? (
            <Card style={[styles.disabledNotice, { backgroundColor: c.orangeSoft }]}>
              <View style={styles.disabledMain}>
                <View style={[styles.disabledIcon, { backgroundColor: c.card }]}>
                  <Sparkles color={c.orange} size={19} />
                </View>
                <View style={styles.disabledCopy}>
                  <Text style={[t.headline, { color: c.label }]}>记忆功能未启用</Text>
                  <Text style={[t.footnote, styles.disabledMessage, { color: c.secondaryLabel }]}>
                    小管家不会记录您的偏好，也无法生成个性化建议。
                  </Text>
                </View>
              </View>
              <PressableScale
                accessibilityLabel="前往设置小管家记忆"
                onPress={() => router.push('/profile')}
                style={[styles.settingsButton, { backgroundColor: c.card }]}
              >
                <Text style={[t.subhead, styles.settingsButtonText, { color: c.tint }]}>前往设置</Text>
              </PressableScale>
            </Card>
          ) : null}

          {loading ? (
            <Card style={styles.loadingCard}>
              <SkeletonRows count={3} />
            </Card>
          ) : error ? (
            <Card style={styles.errorCard}>
              <Text style={[t.headline, { color: c.label }]}>记忆暂时无法加载</Text>
              <Text style={[t.subhead, styles.errorMessage, { color: c.secondaryLabel }]}>
                {error instanceof Error ? error.message : '请稍后再试'}
              </Text>
              <PressableScale
                accessibilityLabel="重新加载小管家记忆"
                onPress={retry}
                style={[styles.retryButton, { backgroundColor: c.fill }]}
              >
                <Text style={[t.headline, { color: c.tint }]}>重新加载</Text>
              </PressableScale>
            </Card>
          ) : memories.length ? (
            <View style={styles.list}>
              {memories.map((memory, index) => (
                <Animated.View
                  entering={reduceMotion
                    ? undefined
                    : FadeInDown.delay(Math.min(index, 6) * 35)
                      .springify()
                      .damping(20)}
                  key={memory.id}
                >
                  <MemoryCard
                    item={memory}
                    onPress={() => router.push(`/agent-memory/${memory.id}` as Href)}
                  />
                </Animated.View>
              ))}
            </View>
          ) : (
            <Card>
              <EmptyState
                hint={scope === 'member_private'
                  ? '与小管家交流后，确认过的偏好会出现在这里'
                  : '家庭成员共享的知识会出现在这里'}
                icon={Sparkles}
                iconBackground={c.tintSoft}
                iconColor={c.tint}
                title="暂无此类记忆"
              />
            </Card>
          )}

          {scope === 'member_private' ? (
            <PressableScale
              accessibilityLabel="清空我的小管家记忆"
              disabled={clearMemories.isPending}
              onPress={() => setClearVisible(true)}
              style={[styles.clearButton, { backgroundColor: c.redSoft }]}
            >
              <Trash2 color={c.red} size={18} />
              <Text style={[t.headline, { color: c.red }]}>清空我的记忆</Text>
            </PressableScale>
          ) : null}
          {announcement ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[t.footnote, styles.announcement, { color: c.green }]}
            >
              {announcement}
            </Text>
          ) : null}
        </ScrollView>
      </PageContainer>

      <ConfirmDialog
        confirmLabel="清空"
        loading={clearMemories.isPending}
        message="将删除您的所有个人记忆（不含家庭共享），此操作不可撤销。"
        onCancel={() => setClearVisible(false)}
        onConfirm={clearPrivateMemories}
        title="确认清空？"
        visible={clearVisible}
      />
    </SafeAreaView>
  );
}

function MemoryCard({ item, onPress }: { item: AgentMemoryItem; onPress: () => void }) {
  const c = useTheme();
  const Icon = MEMORY_ICON[item.memoryKey] ?? Lightbulb;
  const candidate = item.status === 'candidate';
  const timestamp = item.validFrom ?? item.createdAt;
  return (
    <PressableScale
      accessibilityLabel={`${candidate ? '待确认，' : ''}${readableCategory(item.category)}，${item.content ?? '暂无正文'}`}
      accessibilityRole="button"
      onPress={onPress}
    >
      <Card
        style={[
          styles.memoryCard,
          candidate && { backgroundColor: c.tintSoft },
        ]}
      >
        <View style={[styles.memoryIcon, { backgroundColor: c.fill }]}>
          <Icon color={c.secondaryLabel} size={18} />
        </View>
        <View style={styles.memoryBody}>
          <View style={styles.memoryTitleRow}>
            <Text numberOfLines={2} style={[t.subhead, styles.memoryTitle, { color: c.label }]}>
              {readableCategory(item.category)}
            </Text>
            {candidate ? (
              <View style={[styles.statusPill, { backgroundColor: c.orange }]}>
                <Text style={[styles.statusText, { color: c.bg }]}>待确认</Text>
              </View>
            ) : null}
          </View>
          <Text numberOfLines={2} style={[t.subhead, styles.content, { color: c.label }]}>
            {item.content ?? '暂无正文'}
          </Text>
          <Text style={[t.caption, styles.meta, { color: c.secondaryLabel }]}>
            {formatMemoryDate(timestamp)} · {CONFIDENCE_LABEL[item.confidenceSource]}
          </Text>
        </View>
        <ChevronRight color={c.tertiaryLabel} size={20} />
      </Card>
    </PressableScale>
  );
}

function formatMemoryDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function readableCategory(category: string) {
  return MEMORY_KEY_LABEL[category as AgentMemoryKey] ?? category;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  page: { flex: 1, paddingTop: 12 },
  header: { paddingTop: 4, paddingBottom: 18 },
  subtitle: { lineHeight: 22, marginTop: 5 },
  scrollContent: { paddingBottom: 104 },
  filters: { gap: 10, marginBottom: 16 },
  disabledNotice: {
    gap: 12,
    marginBottom: 14,
    padding: 14,
  },
  disabledMain: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  disabledIcon: {
    alignItems: 'center',
    borderRadius: radius.sm,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  disabledCopy: { flex: 1, minWidth: 0 },
  disabledMessage: { lineHeight: 19, marginTop: 3 },
  settingsButton: {
    alignItems: 'center',
    borderRadius: radius.sm,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
    width: '100%',
  },
  settingsButtonText: { fontWeight: '600' },
  loadingCard: { paddingVertical: 6 },
  errorCard: { alignItems: 'center', padding: 24 },
  errorMessage: { lineHeight: 22, marginTop: 6, textAlign: 'center' },
  retryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    minHeight: 44,
    minWidth: 132,
    borderRadius: radius.md,
    paddingHorizontal: 16,
  },
  list: { gap: 10 },
  memoryCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 82,
    padding: 14,
  },
  memoryIcon: {
    alignItems: 'center',
    borderRadius: radius.full,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  memoryBody: { flex: 1, minWidth: 0 },
  memoryTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  memoryTitle: { flex: 1, fontWeight: '600' },
  statusPill: {
    borderRadius: radius.full,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  statusText: { fontSize: 12, fontWeight: '600' },
  content: { lineHeight: 20, marginTop: 4 },
  meta: { marginTop: 6 },
  clearButton: {
    alignItems: 'center',
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 20,
    minHeight: 50,
    paddingHorizontal: 16,
  },
  announcement: { marginTop: 12, textAlign: 'center' },
});
