import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChefHat,
  Clock3,
  Flame,
  Lightbulb,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Share2,
  Sparkles,
  Trash2,
  UserRound,
  UsersRound,
  Utensils,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import React from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageContainer } from '../../../components/app-shell';
import {
  AdaptiveDialog,
  Card,
  ConfirmDialog,
  EmptyState,
  IconButton,
  PressSurface,
  PressableScale,
  PrimaryButton,
  SkeletonRows,
} from '../../../components/ui';
import { ApiError } from '../../../lib/api';
import {
  useAgentMemories,
  useConfirmAgentMemory,
  useCorrectAgentMemory,
  useForgetAgentMemory,
  useShareAgentMemory,
} from '../../../lib/queries';
import { useSession } from '../../../lib/session';
import { radius, type as t, useTheme } from '../../../lib/theme';
import type {
  AgentMemoryConfidenceSource,
  AgentMemoryItem,
  AgentMemoryKey,
  AgentMemoryStatus,
} from '../../../lib/types';

const MEMORY_ICON: Record<AgentMemoryKey, LucideIcon> = {
  diet_restriction: Utensils,
  spice_level: Flame,
  cooking_skill: ChefHat,
  schedule_preference: CalendarDays,
  reply_style: MessageCircle,
  other: Lightbulb,
};

const MEMORY_KEY_LABEL: Record<AgentMemoryKey, string> = {
  diet_restriction: '饮食限制',
  spice_level: '口味偏好',
  cooking_skill: '厨艺能力',
  schedule_preference: '日程偏好',
  reply_style: '回复方式',
  other: '其他信息',
};

const CONFIDENCE_LABEL: Record<AgentMemoryConfidenceSource, string> = {
  explicit: '您的确认',
  business: '业务记录',
  summary_candidate: '对话推测',
};

const STATUS_LABEL: Record<AgentMemoryStatus, string> = {
  active: '生效中',
  candidate: '待确认',
  revoked: '已撤销',
  forgotten: '已遗忘',
  expired: '已过期',
};

type PendingConfirmation = 'share' | 'forget' | 'ignore' | null;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default function AgentMemoryDetailScreen() {
  const c = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { member } = useSession();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = firstParam(params.id);
  const activeQuery = useAgentMemories('active');
  const candidateQuery = useAgentMemories('candidate', 'member_private');
  const confirmMemory = useConfirmAgentMemory();
  const correctMemory = useCorrectAgentMemory();
  const shareMemory = useShareAgentMemory();
  const forgetMemory = useForgetAgentMemory();
  const [localItem, setLocalItem] = React.useState<AgentMemoryItem | null>(null);
  const [menuVisible, setMenuVisible] = React.useState(false);
  const [editVisible, setEditVisible] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [pendingConfirmation, setPendingConfirmation] =
    React.useState<PendingConfirmation>(null);
  const [notice, setNotice] = React.useState<{ message: string; error: boolean } | null>(null);

  const queriedItem = React.useMemo(
    () => [...(candidateQuery.data ?? []), ...(activeQuery.data ?? [])]
      .find((memory) => memory.id === id),
    [activeQuery.data, candidateQuery.data, id],
  );

  React.useEffect(() => {
    if (!queriedItem) return;
    setLocalItem((current) =>
      !current || queriedItem.version >= current.version ? queriedItem : current,
    );
  }, [queriedItem]);

  const item = localItem ?? queriedItem;
  const ownsItem = Boolean(item && item.ownerMemberId === member?.id);
  const loading = activeQuery.isPending || candidateQuery.isPending;
  const queryError = activeQuery.error ?? candidateQuery.error;
  const busy = confirmMemory.isPending
    || correctMemory.isPending
    || shareMemory.isPending
    || forgetMemory.isPending;
  const returnToList = React.useCallback(
    () => router.replace('/agent-memory'),
    [router],
  );

  const openEdit = () => {
    if (!item) return;
    setDraft(item.content ?? '');
    setMenuVisible(false);
    setEditVisible(true);
  };

  const saveCorrection = async () => {
    if (!item || !draft.trim() || draft.trim().length > 500) return;
    try {
      const updated = await correctMemory.mutateAsync({
        id: item.id,
        content: draft.trim(),
        expectedVersion: item.version,
      });
      setLocalItem(updated);
      setDraft(updated.content ?? '');
      setEditVisible(false);
      setNotice({ message: '记忆内容已修改', error: false });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      showError('修改失败', error);
    }
  };

  const confirmCandidate = async () => {
    if (!item) return;
    try {
      await confirmMemory.mutateAsync({
        id: item.id,
        expectedVersion: item.version,
      });
      setNotice({ message: '记忆已确认', error: false });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      finishAndReturn('已确认', '小管家会在需要时使用这条记忆。');
    } catch (error) {
      showError('确认失败', error);
    }
  };

  const shareToHousehold = async () => {
    if (!item) return;
    try {
      await shareMemory.mutateAsync({
        id: item.id,
        expectedVersion: item.version,
      });
      setPendingConfirmation(null);
      setNotice({ message: '记忆已共享到家庭', error: false });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      finishAndReturn('已共享', '家庭成员现在可以看到这条记忆。');
    } catch (error) {
      showError('共享失败', error);
    }
  };

  const forget = async () => {
    if (!item) return;
    const ignored = pendingConfirmation === 'ignore';
    try {
      await forgetMemory.mutateAsync({
        id: item.id,
        expectedVersion: item.version,
      });
      queryClient.setQueriesData<AgentMemoryItem[]>(
        { queryKey: ['agent', 'memories'] },
        (rows) => rows?.filter((memory) => memory.id !== item.id),
      );
      setPendingConfirmation(null);
      setNotice({
        message: ignored ? '记忆建议已忽略' : '记忆已遗忘',
        error: false,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      finishAndReturn(ignored ? '已忽略' : '已遗忘');
    } catch (error) {
      showError(ignored ? '忽略失败' : '遗忘失败', error);
    }
  };

  const finishAndReturn = (title: string, message?: string) => {
    if (Platform.OS === 'web') {
      returnToList();
      return;
    }
    Alert.alert(title, message, [
      { text: '好', onPress: returnToList },
    ]);
  };

  const showError = (title: string, error: unknown) => {
    const message = operationErrorMessage(error);
    setNotice({ message: `${title}：${message}`, error: true });
    Alert.alert(title, message);
  };

  const retry = () => {
    void activeQuery.refetch();
    void candidateQuery.refetch();
  };

  if (loading && !item) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bg }]} edges={['top']}>
        <PageContainer maxWidth={720} style={styles.page}>
          <DetailTopBar onBack={returnToList} />
          <Card style={styles.loadingCard}><SkeletonRows count={4} /></Card>
        </PageContainer>
      </SafeAreaView>
    );
  }

  if (!item) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bg }]} edges={['top']}>
        <PageContainer maxWidth={720} style={styles.page}>
          <DetailTopBar onBack={returnToList} />
          <Card>
            <EmptyState
              hint={queryError instanceof Error
                ? queryError.message
                : '这条记忆可能已被遗忘、过期或不再可见'}
              icon={Sparkles}
              iconBackground={c.fill}
              iconColor={c.secondaryLabel}
              title={queryError ? '记忆暂时无法加载' : '找不到这条记忆'}
            />
            {queryError ? (
              <PressableScale
                accessibilityLabel="重新加载记忆详情"
                onPress={retry}
                style={[styles.retryButton, { backgroundColor: c.fill }]}
              >
                <Text style={[t.headline, { color: c.tint }]}>重新加载</Text>
              </PressableScale>
            ) : null}
          </Card>
        </PageContainer>
      </SafeAreaView>
    );
  }

  const Icon = MEMORY_ICON[item.memoryKey] ?? Lightbulb;
  const statusColor = item.status === 'active' ? c.green : c.orange;
  const statusBackground = item.status === 'active' ? c.greenSoft : c.orangeSoft;
  const confirmationCopy = pendingConfirmation === 'share'
    ? {
      title: '共享到家庭？',
      message: '共享后家庭成员均可见，您的个人版本将被移除。',
      label: '共享',
      destructive: false,
      action: shareToHousehold,
    }
    : pendingConfirmation === 'ignore'
      ? {
        title: '忽略这条建议？',
        message: '忽略后此建议将被移除。',
        label: '忽略',
        destructive: true,
        action: forget,
      }
      : {
        title: '遗忘这条记忆？',
        message: '遗忘后无法恢复，小管家将不再使用此信息。',
        label: '遗忘',
        destructive: true,
        action: forget,
      };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bg }]} edges={['top']}>
      <PageContainer maxWidth={member?.role === 'member' ? 720 : 1040} style={styles.page}>
        <DetailTopBar
          onBack={returnToList}
          onMore={ownsItem ? () => setMenuVisible(true) : undefined}
        />
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Card style={styles.identityCard}>
            <View style={[styles.heroIcon, { backgroundColor: c.tintSoft }]}>
              <Icon color={c.tint} size={24} />
            </View>
            <View style={styles.flexCopy}>
              <Text style={[t.title2, { color: c.label }]}>{readableCategory(item.category)}</Text>
              <Text style={[t.subhead, styles.keyLabel, { color: c.secondaryLabel }]}>
                {MEMORY_KEY_LABEL[item.memoryKey]}
              </Text>
            </View>
          </Card>

          <Card style={styles.contentCard}>
            <View style={[styles.contentRule, { backgroundColor: c.tint }]} />
            <Text style={[t.body, styles.contentText, { color: c.label }]}>
              {item.content ?? '正文已清除'}
            </Text>
          </Card>

          <Card style={styles.metadataCard}>
            <MetadataRow
              icon={item.scope === 'member_private' ? UserRound : UsersRound}
              label="范围"
              value={item.scope === 'member_private' ? '仅自己可见' : '家庭共享'}
            />
            <MetadataDivider />
            <MetadataRow
              icon={Sparkles}
              label="来源"
              value={CONFIDENCE_LABEL[item.confidenceSource]}
              detail={item.source.conversationId
                ? `对话 ${item.source.conversationId.slice(0, 8)}`
                : undefined}
            />
            <MetadataDivider />
            <MetadataRow
              icon={Clock3}
              label="时间"
              value={item.validFrom
                ? `生效于 ${formatDate(item.validFrom)}`
                : `建议于 ${formatDate(item.createdAt)}`}
              detail={item.expiresAt
                ? `有效期至 ${formatDate(item.expiresAt)}`
                : '永久有效'}
            />
            <MetadataDivider />
            <View style={styles.metadataRow}>
              <View style={[styles.metadataIcon, { backgroundColor: statusBackground }]}>
                <Check color={statusColor} size={17} />
              </View>
              <View style={styles.flexCopy}>
                <Text style={[t.caption, { color: c.secondaryLabel }]}>状态</Text>
                <Text style={[t.subhead, styles.metadataValue, { color: statusColor }]}>
                  {STATUS_LABEL[item.status]}
                </Text>
              </View>
            </View>
          </Card>

          {!ownsItem && item.scope === 'household' ? (
            <View style={[styles.sharedNotice, { backgroundColor: c.fill }]}>
              <UsersRound color={c.secondaryLabel} size={18} />
              <Text style={[t.footnote, styles.flexCopy, { color: c.secondaryLabel }]}>
                这条记忆由家庭成员共享，仅创建者可以修改或遗忘。
              </Text>
            </View>
          ) : null}

          {item.status === 'candidate' && ownsItem ? (
            <View style={styles.candidateActions}>
              <PrimaryButton
                disabled={busy}
                icon={<Check color={c.bg} size={18} />}
                loading={confirmMemory.isPending}
                onPress={() => void confirmCandidate()}
                title="确认"
              />
              <PressableScale
                accessibilityLabel="忽略这条记忆建议"
                disabled={busy}
                onPress={() => setPendingConfirmation('ignore')}
                style={[styles.secondaryButton, { backgroundColor: c.fill }]}
              >
                <Text style={[t.headline, { color: c.label }]}>忽略</Text>
              </PressableScale>
            </View>
          ) : null}

          {notice ? (
            <Text
              accessibilityLiveRegion="polite"
              role={notice.error ? 'alert' : undefined}
              style={[
                t.footnote,
                styles.announcement,
                { color: notice.error ? c.red : c.green },
              ]}
            >
              {notice.message}
            </Text>
          ) : null}
        </ScrollView>
      </PageContainer>

      <AdaptiveDialog
        accessibilityLabel="记忆操作"
        maxWidth={440}
        onClose={() => setMenuVisible(false)}
        visible={menuVisible}
      >
        <View style={styles.dialogContent}>
          <View style={styles.dialogHeader}>
            <Text style={[t.title2, { color: c.label }]}>记忆操作</Text>
            <IconButton
              accessibilityLabel="关闭记忆操作"
              backgroundColor={c.fill}
              icon={X}
              onPress={() => setMenuVisible(false)}
            />
          </View>
          <ActionRow
            icon={Pencil}
            label="修改内容"
            onPress={openEdit}
          />
          {item.scope === 'member_private' && item.status === 'active' ? (
            <ActionRow
              icon={Share2}
              label="共享到家庭"
              onPress={() => {
                setMenuVisible(false);
                setPendingConfirmation('share');
              }}
            />
          ) : null}
          <ActionRow
            destructive
            icon={Trash2}
            label="遗忘"
            onPress={() => {
              setMenuVisible(false);
              setPendingConfirmation(item.status === 'candidate' ? 'ignore' : 'forget');
            }}
          />
        </View>
      </AdaptiveDialog>

      <AdaptiveDialog
        accessibilityLabel="修改记忆内容"
        maxWidth={520}
        onClose={() => setEditVisible(false)}
        visible={editVisible}
      >
        <View style={styles.dialogContent}>
          <View style={styles.dialogHeader}>
            <Text style={[t.title2, { color: c.label }]}>修改内容</Text>
            <IconButton
              accessibilityLabel="关闭修改记忆内容"
              backgroundColor={c.fill}
              icon={X}
              onPress={() => setEditVisible(false)}
            />
          </View>
          <Text style={[t.footnote, { color: c.secondaryLabel }]}>记忆内容</Text>
          <TextInput
            accessibilityLabel="记忆内容"
            editable={!correctMemory.isPending}
            maxLength={500}
            multiline
            onChangeText={setDraft}
            placeholder="输入需要小管家记住的内容"
            placeholderTextColor={c.tertiaryLabel}
            style={[
              t.body,
              styles.editor,
              { backgroundColor: c.fill, borderColor: c.separator, color: c.label },
            ]}
            textAlignVertical="top"
            value={draft}
          />
          <Text style={[t.caption, styles.characterCount, { color: c.secondaryLabel }]}>
            {draft.length}/500
          </Text>
          <PrimaryButton
            disabled={!draft.trim() || draft.trim().length > 500}
            loading={correctMemory.isPending}
            onPress={() => void saveCorrection()}
            title="保存修改"
          />
        </View>
      </AdaptiveDialog>

      <ConfirmDialog
        confirmLabel={confirmationCopy.label}
        destructive={confirmationCopy.destructive}
        loading={shareMemory.isPending || forgetMemory.isPending}
        message={confirmationCopy.message}
        onCancel={() => setPendingConfirmation(null)}
        onConfirm={() => void confirmationCopy.action()}
        title={confirmationCopy.title}
        visible={pendingConfirmation != null}
      />
    </SafeAreaView>
  );
}

function DetailTopBar({
  onBack,
  onMore,
}: {
  onBack: () => void;
  onMore?: () => void;
}) {
  const c = useTheme();
  return (
    <View style={styles.topBar}>
      <IconButton
        accessibilityLabel="返回记忆列表"
        backgroundColor={c.fill}
        icon={ArrowLeft}
        onPress={onBack}
      />
      <Text style={[t.headline, { color: c.label }]}>记忆详情</Text>
      {onMore ? (
        <IconButton
          accessibilityLabel="更多记忆操作"
          backgroundColor={c.fill}
          icon={MoreHorizontal}
          onPress={onMore}
        />
      ) : <View style={styles.topBarSpacer} />}
    </View>
  );
}

function MetadataRow({
  detail,
  icon: Icon,
  label,
  value,
}: {
  detail?: string;
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  const c = useTheme();
  return (
    <View style={styles.metadataRow}>
      <View style={[styles.metadataIcon, { backgroundColor: c.fill }]}>
        <Icon color={c.secondaryLabel} size={17} />
      </View>
      <View style={styles.flexCopy}>
        <Text style={[t.caption, { color: c.secondaryLabel }]}>{label}</Text>
        <Text style={[t.subhead, styles.metadataValue, { color: c.label }]}>{value}</Text>
        {detail ? (
          <Text style={[t.caption, styles.metadataDetail, { color: c.tertiaryLabel }]}>
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function MetadataDivider() {
  const c = useTheme();
  return <View style={[styles.divider, { backgroundColor: c.separator }]} />;
}

function ActionRow({
  destructive = false,
  icon: Icon,
  label,
  onPress,
}: {
  destructive?: boolean;
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  const c = useTheme();
  const color = destructive ? c.red : c.label;
  return (
    <PressSurface
      accessibilityLabel={label}
      onPress={onPress}
      pressedColor={destructive ? c.redSoft : c.fill}
      style={styles.actionRow}
    >
      <Icon color={color} size={20} />
      <Text style={[t.body, { color }]}>{label}</Text>
    </PressSurface>
  );
}

function readableCategory(category: string) {
  return MEMORY_KEY_LABEL[category as AgentMemoryKey] ?? category;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function operationErrorMessage(error: unknown) {
  return error instanceof ApiError && error.status === 409
    ? '内容已被修改，请刷新后重试'
    : error instanceof Error
      ? error.message
      : '请稍后再试';
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  page: { flex: 1, paddingTop: 8 },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
  },
  topBarSpacer: { height: 44, width: 44 },
  scrollContent: { gap: 12, paddingBottom: 104, paddingTop: 10 },
  loadingCard: { marginTop: 10, paddingVertical: 8 },
  retryButton: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: radius.md,
    justifyContent: 'center',
    marginBottom: 24,
    minHeight: 44,
    minWidth: 132,
    paddingHorizontal: 16,
  },
  identityCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    padding: 16,
  },
  heroIcon: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  flexCopy: { flex: 1, minWidth: 0 },
  keyLabel: { marginTop: 3 },
  contentCard: { flexDirection: 'row', gap: 14, padding: 18 },
  contentRule: { borderRadius: radius.full, width: 2 },
  contentText: { flex: 1, lineHeight: 27 },
  metadataCard: { paddingHorizontal: 16 },
  metadataRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 72,
    paddingVertical: 12,
  },
  metadataIcon: {
    alignItems: 'center',
    borderRadius: radius.sm,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  metadataValue: { fontWeight: '600', marginTop: 3 },
  metadataDetail: { marginTop: 3 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 48 },
  sharedNotice: {
    alignItems: 'center',
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: 10,
    padding: 14,
  },
  candidateActions: { gap: 10, marginTop: 8 },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: radius.md,
    justifyContent: 'center',
    minHeight: 50,
  },
  announcement: { marginTop: 4, textAlign: 'center' },
  dialogContent: { gap: 12, padding: 20, paddingTop: 8 },
  dialogHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  actionRow: {
    alignItems: 'center',
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 12,
  },
  editor: {
    borderRadius: radius.sm,
    borderWidth: 1,
    lineHeight: 24,
    minHeight: 150,
    padding: 12,
  },
  characterCount: { textAlign: 'right' },
});
