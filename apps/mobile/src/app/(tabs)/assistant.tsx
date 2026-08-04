import {
  Archive,
  Check,
  CheckCircle2,
  CircleStop,
  CloudOff,
  Clock3,
  Link2,
  ListChecks,
  MessageCircleMore,
  Plus,
  Send,
  Settings2,
  Sparkles,
  TriangleAlert,
  Unlink,
  X,
} from 'lucide-react-native';
import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageContainer, useLayoutMode } from '../../components/app-shell';
import {
  AdaptiveDialog,
  Card,
  IconButton,
  PressSurface,
  Segmented,
  SkeletonRows,
} from '../../components/ui';
import { isHouseholdManager } from '../../lib/member';
import {
  useAgentConversation,
  useAgentChannels,
  useAgentChannelPairings,
  useAgentConversations,
  useAgentSettings,
  useAgentStatus,
  useArchiveAgentConversation,
  useCancelAgentRun,
  useConfirmAgentProposal,
  useCreateAgentConversation,
  useSendAgentMessage,
  useRejectAgentProposal,
  useCreateAgentChannelPairing,
  useRevokeAgentChannel,
  useRevokeAgentChannelPairing,
  useMembers,
  useUpdateAgentSettings,
} from '../../lib/queries';
import { useSession } from '../../lib/session';
import { radius, type as t, useTheme } from '../../lib/theme';
import type {
  AgentActionProposal,
  AgentConversation,
  AgentMessage,
  AgentRuntimeKind,
} from '../../lib/types';

const SUGGESTIONS = [
  '今天家里有什么安排？',
  `创建任务：整理冰箱 ${new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())}`,
  '最近有哪些东西快没了？',
  '家庭片单里有什么可以看？',
  '接下来的行程还缺什么？',
];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请稍后再试';
}

function MessageBubble({ message }: { message: AgentMessage }) {
  const c = useTheme();
  const mine = message.role === 'user';
  return (
    <View style={[styles.messageRow, mine && styles.messageRowMine]}>
      {!mine ? (
        <View style={[styles.messageAvatar, { backgroundColor: c.tintSoft }]}>
          <Sparkles color={c.tint} size={17} />
        </View>
      ) : null}
      <View
        style={[
          styles.messageBubble,
          {
            backgroundColor: mine ? c.tint : c.card,
            borderColor: mine ? c.tint : c.separator,
          },
        ]}
      >
        <Text style={[t.body, styles.messageText, { color: mine ? '#FFFFFF' : c.label }]}>
          {message.content}
        </Text>
      </View>
    </View>
  );
}

const PROPOSAL_STATUS = {
  pending: { label: '需要确认', tone: 'orange' },
  confirmed: { label: '正在执行', tone: 'blue' },
  executed: { label: '已确认并执行', tone: 'green' },
  rejected: { label: '已放弃', tone: 'secondary' },
  expired: { label: '已过期', tone: 'secondary' },
  failed: { label: '执行失败', tone: 'red' },
} as const;

function ProposalCard({
  proposal,
  conversationId,
}: {
  proposal: AgentActionProposal;
  conversationId: string;
}) {
  const c = useTheme();
  const confirm = useConfirmAgentProposal();
  const reject = useRejectAgentProposal();
  const [message, setMessage] = React.useState<string | null>(null);
  const busy = confirm.isPending || reject.isPending;
  const state = PROPOSAL_STATUS[proposal.status];
  const tone =
    state.tone === 'green'
      ? c.green
      : state.tone === 'orange'
        ? c.orange
        : state.tone === 'blue'
          ? c.blue
          : state.tone === 'red'
            ? c.red
            : c.secondaryLabel;
  const soft =
    state.tone === 'green'
      ? c.greenSoft
      : state.tone === 'orange'
        ? c.orangeSoft
        : state.tone === 'blue'
          ? c.blueSoft
          : state.tone === 'red'
            ? c.redSoft
            : c.fill;

  const act = async (action: 'confirm' | 'reject') => {
    setMessage(null);
    try {
      if (action === 'confirm') {
        await confirm.mutateAsync({
          id: proposal.id,
          conversationId,
          expectedVersion: proposal.version,
        });
      } else {
        await reject.mutateAsync({
          id: proposal.id,
          conversationId,
          expectedVersion: proposal.version,
        });
      }
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  return (
    <View
      accessibilityLabel={`${proposal.actionLabel}操作提案`}
      style={[styles.proposal, { backgroundColor: soft, borderLeftColor: tone }]}
      testID={`agent-proposal-${proposal.id}`}
    >
      <View style={styles.proposalHeading}>
        <View style={[styles.proposalIcon, { backgroundColor: c.card }]}>
          {proposal.status === 'executed' ? (
            <CheckCircle2 color={tone} size={19} />
          ) : proposal.status === 'failed' ? (
            <TriangleAlert color={tone} size={19} />
          ) : proposal.status === 'pending' ? (
            <ListChecks color={tone} size={19} />
          ) : (
            <Clock3 color={tone} size={19} />
          )}
        </View>
        <View style={styles.flexCopy}>
          <Text style={[t.caption, { color: tone, fontWeight: '600' }]}>操作提案 · {state.label}</Text>
          <Text style={[t.headline, { color: c.label, marginTop: 3 }]}>{proposal.preview.title}</Text>
        </View>
      </View>

      <Text style={[t.footnote, styles.proposalSummary, { color: c.secondaryLabel }]}>
        {proposal.preview.summary}
      </Text>
      <View style={[styles.proposalChanges, { borderTopColor: c.separator }]}>
        {proposal.preview.changes.map((change) => (
          <View key={`${change.label}:${change.value}`} style={styles.proposalChange}>
            <Text style={[t.caption, styles.proposalChangeLabel, { color: c.secondaryLabel }]}>
              {change.label}
            </Text>
            <Text style={[t.footnote, styles.proposalChangeValue, { color: c.label }]}>
              {change.value}
            </Text>
          </View>
        ))}
      </View>
      {proposal.preview.warning ? (
        <Text style={[t.caption, styles.proposalWarning, { color: c.orange }]}>
          {proposal.preview.warning}
        </Text>
      ) : null}
      {proposal.status === 'failed' && proposal.failureMessage ? (
        <Text accessibilityLiveRegion="polite" style={[t.footnote, { color: c.red }]}>
          {proposal.failureMessage}
        </Text>
      ) : null}
      {message ? (
        <Text accessibilityLiveRegion="polite" role="alert" style={[t.footnote, { color: c.red }]}>
          {message}
        </Text>
      ) : null}
      {proposal.status === 'pending' ? (
        <View style={styles.proposalActions}>
          <PressSurface
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void act('reject')}
            style={[styles.proposalButton, { backgroundColor: c.card, borderColor: c.separator }]}
            testID={`agent-proposal-reject-${proposal.id}`}
          >
            <X color={c.secondaryLabel} size={18} />
            <Text style={[t.footnote, { color: c.label, fontWeight: '600' }]}>放弃</Text>
          </PressSurface>
          <PressSurface
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void act('confirm')}
            style={[styles.proposalButton, { backgroundColor: c.tint, borderColor: c.tint }]}
            testID={`agent-proposal-confirm-${proposal.id}`}
          >
            {confirm.isPending ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Check color="#FFFFFF" size={18} />
            )}
            <Text style={[t.footnote, { color: '#FFFFFF', fontWeight: '600' }]}>确认执行</Text>
          </PressSurface>
        </View>
      ) : null}
    </View>
  );
}

function RuntimeSettings({ embedded = false }: { embedded?: boolean }) {
  const c = useTheme();
  const { data: settings } = useAgentSettings();
  const update = useUpdateAgentSettings();
  const [message, setMessage] = React.useState<string | null>(null);

  const change = async (values: { enabled?: boolean; runtimeKind?: AgentRuntimeKind }) => {
    if (!settings || update.isPending) return;
    setMessage(null);
    try {
      await update.mutateAsync({ ...values, expectedVersion: settings.version });
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  if (!settings) return <SkeletonRows count={2} />;
  return (
    <View
      style={[
        styles.settingsPanel,
        embedded && styles.settingsPanelEmbedded,
        { borderColor: c.separator },
      ]}
      testID="agent-settings-panel"
    >
      <View style={styles.settingsHeading}>
        <View style={[styles.settingsIcon, { backgroundColor: c.fill }]}>
          <Settings2 color={c.secondaryLabel} size={18} />
        </View>
        <View style={styles.flexCopy}>
          <Text style={[t.headline, { color: c.label }]}>运行方式</Text>
          <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>
            Hermes 不可用时会自动回到本地家庭摘要
          </Text>
        </View>
        <Switch
          accessibilityLabel="启用问问小管家"
          disabled={update.isPending}
          onValueChange={(enabled) => void change({ enabled })}
          thumbColor={settings.enabled ? c.tint : c.tertiaryLabel}
          trackColor={{ false: c.fillStrong, true: c.tintSoft }}
          value={settings.enabled}
        />
      </View>
      <Segmented
        options={[
          { label: '本地摘要', value: 'fake' },
          { label: 'Hermes', value: 'hermes' },
        ]}
        value={settings.runtimeKind}
        onChange={(runtimeKind) => void change({ runtimeKind })}
      />
      {message ? <Text style={[t.footnote, { color: c.red, marginTop: 8 }]}>{message}</Text> : null}
    </View>
  );
}

function ChannelBindings({ manager, embedded = false }: { manager: boolean; embedded?: boolean }) {
  const c = useTheme();
  const { data: members } = useMembers(manager);
  const { data: channels } = useAgentChannels();
  const { data: pairings } = useAgentChannelPairings(manager);
  const createPairing = useCreateAgentChannelPairing();
  const revokeChannel = useRevokeAgentChannel();
  const revokePairing = useRevokeAgentChannelPairing();
  const [platform, setPlatform] = React.useState('telegram');
  const [memberId, setMemberId] = React.useState('');
  const [pairingCode, setPairingCode] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const activeMembers = (members ?? []).filter((item) => !item.disabledAt);
  React.useEffect(() => {
    if (!memberId && activeMembers[0]) setMemberId(activeMembers[0].id);
  }, [activeMembers, memberId]);

  const create = async () => {
    if (!memberId || !platform.trim() || createPairing.isPending) return;
    setMessage(null);
    setPairingCode(null);
    try {
      const result = await createPairing.mutateAsync({
        memberId,
        platform: platform.trim().toLocaleLowerCase('en-US'),
      });
      setPairingCode(result.pairingCode ?? null);
      if (!result.pairingCode) setMessage('这个请求已经生成过配对码，请使用首次显示的配对码。');
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const revoke = async (id: string, version: number) => {
    setMessage(null);
    try {
      await revokeChannel.mutateAsync({ id, expectedVersion: version });
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const revokePending = async (id: string) => {
    setMessage(null);
    try {
      await revokePairing.mutateAsync(id);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  return (
    <View
      style={[
        styles.settingsPanel,
        embedded && styles.settingsPanelEmbedded,
        { borderColor: c.separator },
      ]}
      testID="agent-channel-bindings"
    >
      <View style={styles.settingsHeading}>
        <View style={[styles.settingsIcon, { backgroundColor: c.fill }]}>
          <Link2 color={c.secondaryLabel} size={18} />
        </View>
        <View style={styles.flexCopy}>
          <Text style={[t.headline, { color: c.label }]}>消息渠道</Text>
          <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>外部消息只读，修改回到 Family App 确认</Text>
        </View>
      </View>

      {manager ? (
        <>
          <TextInput
            accessibilityLabel="消息渠道标识"
            autoCapitalize="none"
            onChangeText={setPlatform}
            placeholder="渠道标识，例如 telegram"
            placeholderTextColor={c.tertiaryLabel}
            style={[t.body, styles.channelInput, { color: c.label, borderColor: c.separator, backgroundColor: c.fill }]}
            value={platform}
          />
          <ScrollView horizontal contentContainerStyle={styles.memberChips} showsHorizontalScrollIndicator={false}>
            {activeMembers.map((item) => (
              <PressSurface
                accessibilityRole="button"
                accessibilityState={{ selected: item.id === memberId }}
                key={item.id}
                onPress={() => setMemberId(item.id)}
                style={[styles.memberChip, { backgroundColor: item.id === memberId ? c.tintSoft : c.fill, borderColor: item.id === memberId ? c.tint : c.separator }]}
              >
                <Text style={[t.footnote, { color: item.id === memberId ? c.tint : c.label, fontWeight: '600' }]}>
                  {item.avatarEmoji} {item.name}
                </Text>
              </PressSurface>
            ))}
          </ScrollView>
          <PressSurface
            accessibilityRole="button"
            disabled={!memberId || !platform.trim() || createPairing.isPending}
            onPress={() => void create()}
            style={[styles.channelAction, { backgroundColor: c.tint, borderColor: c.tint }]}
          >
            {createPairing.isPending ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Link2 color="#FFFFFF" size={17} />}
            <Text style={[t.footnote, { color: '#FFFFFF', fontWeight: '600' }]}>生成一次性配对码</Text>
          </PressSurface>
          {pairingCode ? (
            <View style={[styles.pairingCode, { backgroundColor: c.tintSoft, borderColor: c.tint }]}>
              <Text style={[t.caption, { color: c.secondaryLabel }]}>仅显示这一次</Text>
              <Text selectable style={[t.title2, styles.pairingCodeText, { color: c.tint }]}>{pairingCode}</Text>
            </View>
          ) : null}
        </>
      ) : null}

      {message ? <Text accessibilityLiveRegion="polite" role="alert" style={[t.footnote, { color: c.red }]}>{message}</Text> : null}

      {channels?.length ? (
        <View style={[styles.channelList, { borderTopColor: c.separator }]}>
          {channels.map((channel) => (
            <View key={channel.id} style={styles.channelRow}>
              <View style={styles.flexCopy}>
                <Text style={[t.footnote, { color: c.label, fontWeight: '600' }]}>
                  {channel.platform} · {channel.memberName ?? '家庭成员'}
                </Text>
                <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>
                  {channel.externalAccountLabel ?? channel.externalAccountHint ?? '外部账号'}{channel.revokedAt ? ' · 已撤销' : ' · 已绑定'}
                </Text>
              </View>
              {!channel.revokedAt && channel.canRevoke ? (
                <IconButton
                  accessibilityLabel={`撤销 ${channel.platform} 绑定`}
                  backgroundColor="transparent"
                  disabled={revokeChannel.isPending}
                  icon={Unlink}
                  onPress={() => void revoke(channel.id, channel.version)}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {manager && pairings?.some((item) => item.status === 'pending') ? (
        <View style={[styles.channelList, { borderTopColor: c.separator }]}>
          {pairings.filter((item) => item.status === 'pending').slice(0, 5).map((item) => (
            <View key={item.id} style={styles.channelRow}>
              <View style={styles.flexCopy}>
                <Text style={[t.footnote, { color: c.label }]}>{item.platform} · {item.memberName ?? '家庭成员'}</Text>
                <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>配对码待使用 · {new Date(item.expiresAt).toLocaleString()}</Text>
              </View>
              <IconButton
                accessibilityLabel="撤销待使用配对码"
                backgroundColor="transparent"
                disabled={revokePairing.isPending}
                icon={Unlink}
                onPress={() => void revokePending(item.id)}
              />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function AssistantSettingsSheet({
  manager,
  onClose,
  visible,
}: {
  manager: boolean;
  onClose: () => void;
  visible: boolean;
}) {
  const c = useTheme();
  return (
    <AdaptiveDialog
      accessibilityLabel="助理设置"
      maxWidth={640}
      onClose={onClose}
      style={styles.settingsDialog}
      testID="agent-settings-sheet"
      visible={visible}
    >
      <SafeAreaView edges={['bottom']} style={styles.settingsSheet}>
        <View style={[styles.settingsSheetHeader, { borderBottomColor: c.separator }]}>
          <View style={[styles.settingsIcon, { backgroundColor: c.fill }]}>
            <Settings2 color={c.secondaryLabel} size={18} />
          </View>
          <View style={styles.flexCopy}>
            <Text style={[t.headline, { color: c.label }]}>助理设置</Text>
            <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>需要时再打开，不占用对话空间</Text>
          </View>
          <IconButton
            accessibilityLabel="关闭助理设置"
            backgroundColor="transparent"
            icon={X}
            onPress={onClose}
            testID="agent-settings-close"
          />
        </View>
        <ScrollView
          contentContainerStyle={styles.settingsSheetContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {manager ? <RuntimeSettings embedded /> : null}
          <ChannelBindings embedded manager={manager} />
        </ScrollView>
      </SafeAreaView>
    </AdaptiveDialog>
  );
}

function ConversationHistorySheet({
  archiving,
  conversations,
  onArchive,
  onClose,
  onSelect,
  selectedId,
  visible,
}: {
  archiving: boolean;
  conversations: AgentConversation[];
  onArchive: (id: string) => void;
  onClose: () => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  visible: boolean;
}) {
  const c = useTheme();
  return (
    <AdaptiveDialog
      accessibilityLabel="会话历史"
      maxWidth={560}
      onClose={onClose}
      style={styles.historyDialog}
      testID="agent-history-sheet"
      visible={visible}
    >
      <SafeAreaView edges={['bottom']} style={styles.historySheet}>
        <View style={[styles.settingsSheetHeader, { borderBottomColor: c.separator }]}>
          <View style={[styles.settingsIcon, { backgroundColor: c.fill }]}>
            <MessageCircleMore color={c.secondaryLabel} size={18} />
          </View>
          <View style={styles.flexCopy}>
            <Text style={[t.headline, { color: c.label }]}>会话历史</Text>
            <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>
              {conversations.length ? `${conversations.length} 个进行中的对话` : '还没有对话'}
            </Text>
          </View>
          <IconButton
            accessibilityLabel="关闭会话历史"
            backgroundColor="transparent"
            icon={X}
            onPress={onClose}
            testID="agent-history-close"
          />
        </View>
        <ScrollView
          contentContainerStyle={styles.historyContent}
          showsVerticalScrollIndicator={false}
        >
          {conversations.length ? conversations.map((item) => {
            const selected = item.id === selectedId;
            return (
              <View
                key={item.id}
                style={[
                  styles.historyRow,
                  {
                    backgroundColor: selected ? c.tintSoft : c.card,
                    borderColor: selected ? c.tint : c.separator,
                  },
                ]}
              >
                <PressSurface
                  accessibilityLabel={`打开对话：${item.title}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onSelect(item.id)}
                  style={styles.historySelect}
                  testID={`agent-history-item-${item.id}`}
                >
                  <View style={[styles.historyIcon, { backgroundColor: selected ? c.card : c.fill }]}>
                    {selected ? <Check color={c.tint} size={18} /> : <MessageCircleMore color={c.secondaryLabel} size={18} />}
                  </View>
                  <View style={styles.flexCopy}>
                    <Text numberOfLines={2} style={[t.body, { color: c.label, fontWeight: '600' }]}>
                      {item.title}
                    </Text>
                    <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 4 }]}>
                      更新于 {new Date(item.updatedAt).toLocaleDateString('zh-CN', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </Text>
                  </View>
                </PressSurface>
                <IconButton
                  accessibilityLabel={`归档对话：${item.title}`}
                  backgroundColor="transparent"
                  disabled={archiving || Boolean(item.latestRun && ['queued', 'running'].includes(item.latestRun.status))}
                  icon={Archive}
                  onPress={() => onArchive(item.id)}
                />
              </View>
            );
          }) : (
            <View style={styles.historyEmpty}>
              <View style={[styles.welcomeIcon, { backgroundColor: c.tintSoft }]}>
                <MessageCircleMore color={c.tint} size={25} />
              </View>
              <Text style={[t.headline, { color: c.label }]}>从一个新问题开始</Text>
              <Text style={[t.footnote, styles.historyEmptyText, { color: c.secondaryLabel }]}>
                新对话会自动出现在这里，方便之后继续。
              </Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </AdaptiveDialog>
  );
}

export default function AssistantScreen() {
  const c = useTheme();
  const layout = useLayoutMode();
  const { member } = useSession();
  const manager = isHouseholdManager(member);
  const { data: status, isLoading: statusLoading } = useAgentStatus();
  const { data: channels } = useAgentChannels();
  const { data: conversations, isLoading: conversationsLoading } = useAgentConversations();
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const { data: conversation, isLoading: conversationLoading } =
    useAgentConversation(conversationId);
  const createConversation = useCreateAgentConversation();
  const sendMessage = useSendAgentMessage();
  const cancelRun = useCancelAgentRun();
  const archiveConversation = useArchiveAgentConversation();
  const [draft, setDraft] = React.useState('');
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [settingsVisible, setSettingsVisible] = React.useState(false);
  const [historyVisible, setHistoryVisible] = React.useState(false);
  const scrollRef = React.useRef<ScrollView>(null);
  const messageCount = conversation?.messages.length ?? 0;
  const latestRunStatus = conversation?.runs[0]?.status;

  React.useEffect(() => {
    if (!conversations) return;
    if (!conversationId || !conversations.some((item) => item.id === conversationId)) {
      setConversationId(conversations[0]?.id ?? null);
    }
  }, [conversationId, conversations]);

  React.useEffect(() => {
    if (!messageCount) return;
    const timeout = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(timeout);
  }, [latestRunStatus, messageCount]);

  const activeRun = conversation?.runs.find(
    (run) => run.status === 'queued' || run.status === 'running',
  );
  const latestRun = conversation?.runs[0] ?? null;
  const busy = sendMessage.isPending || createConversation.isPending || Boolean(activeRun);

  const newConversation = async () => {
    setLocalError(null);
    try {
      const created = await createConversation.mutateAsync(undefined);
      setConversationId(created.id);
      setDraft('');
    } catch (error) {
      setLocalError(errorMessage(error));
    }
  };

  const submit = async () => {
    const message = draft.trim();
    if (!message || busy) return;
    setLocalError(null);
    try {
      let targetId = conversationId;
      if (!targetId) {
        const created = await createConversation.mutateAsync(undefined);
        targetId = created.id;
        setConversationId(targetId);
      }
      await sendMessage.mutateAsync({ conversationId: targetId, message });
      setDraft('');
    } catch (error) {
      setLocalError(errorMessage(error));
    }
  };

  const archiveById = async (id: string) => {
    setLocalError(null);
    try {
      await archiveConversation.mutateAsync(id);
      if (id === conversationId) setDraft('');
    } catch (error) {
      setLocalError(errorMessage(error));
    }
  };

  const activeChannels = (channels ?? []).filter((channel) => !channel.revokedAt);
  const showSettings = manager || activeChannels.length > 0;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.screen}
      >
        <PageContainer maxWidth={1040} style={styles.page}>
          <Card style={[styles.chat, layout === 'compact' && styles.chatCompact]}>
            <View style={[styles.chatHeader, { borderBottomColor: c.separator }]}>
              <View style={[styles.botMark, { backgroundColor: c.tintSoft }]}>
                <Sparkles color={c.tint} size={20} />
              </View>
              <View style={styles.flexCopy}>
                <Text accessibilityRole="header" style={[t.headline, { color: c.label }]}>问问小管家</Text>
                <Text numberOfLines={1} style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>
                  {status?.selected.available
                    ? status.runtimeKind === 'hermes'
                      ? 'Hermes 已连接'
                      : '本地家庭摘要可用'
                    : '离线模式可用'}
                </Text>
              </View>
              <View style={styles.chatActions}>
                {showSettings ? (
                  <IconButton
                    accessibilityLabel="打开助理设置"
                    backgroundColor="transparent"
                    icon={Settings2}
                    onPress={() => setSettingsVisible(true)}
                    testID="agent-settings-trigger"
                  />
                ) : null}
                <IconButton
                  accessibilityLabel="打开会话历史"
                  backgroundColor="transparent"
                  icon={MessageCircleMore}
                  onPress={() => setHistoryVisible(true)}
                  testID="agent-history-trigger"
                />
                <IconButton
                  accessibilityLabel="开始新对话"
                  disabled={createConversation.isPending}
                  icon={Plus}
                  onPress={() => void newConversation()}
                  testID="agent-new-conversation"
                />
              </View>
            </View>

            <ScrollView
              contentContainerStyle={styles.messages}
              keyboardShouldPersistTaps="handled"
              ref={scrollRef}
              showsVerticalScrollIndicator={false}
              testID="agent-message-list"
            >
              {!statusLoading && (!status?.enabled || !status.persistenceEncrypted) ? (
                <View style={[styles.notice, { backgroundColor: c.orangeSoft }]}>
                  <CloudOff color={c.orange} size={19} />
                  <Text style={[t.footnote, styles.noticeText, { color: c.label }]}>
                    {!status?.enabled
                      ? '家庭小管家当前未启用，请联系家庭管理员。'
                      : '对话加密尚未配置，暂时不能开始新问答。'}
                  </Text>
                </View>
              ) : null}

              {conversationLoading || conversationsLoading ? (
                <SkeletonRows count={3} />
              ) : conversation?.messages.length ? (
                conversation.messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))
              ) : (
                <View style={styles.welcome}>
                  <View style={[styles.welcomeIcon, { backgroundColor: c.tintSoft }]}>
                    <Sparkles color={c.tint} size={26} />
                  </View>
                  <Text style={[t.title2, { color: c.label }]}>想了解家里的什么？</Text>
                  <Text style={[t.footnote, styles.welcomeCopy, { color: c.secondaryLabel }]}>
                    可以查询安排、库存、片单，也可以先创建一条待确认事项。
                  </Text>
                  <ScrollView
                    contentContainerStyle={styles.suggestions}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.suggestionScroller}
                  >
                    {SUGGESTIONS.map((suggestion) => (
                      <PressSurface
                        accessibilityRole="button"
                        key={suggestion}
                        onPress={() => setDraft(suggestion)}
                        style={[
                          styles.suggestion,
                          { backgroundColor: c.fill, borderColor: c.separator },
                        ]}
                      >
                        <Text numberOfLines={2} style={[t.footnote, { color: c.label }]}>{suggestion}</Text>
                      </PressSurface>
                    ))}
                  </ScrollView>
                </View>
              )}

              {conversationId
                ? conversation?.proposals.map((proposal) => (
                    <ProposalCard
                      conversationId={conversationId}
                      key={proposal.id}
                      proposal={proposal}
                    />
                  ))
                : null}

              {activeRun ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={[styles.runState, { backgroundColor: c.tintSoft }]}
                >
                  <ActivityIndicator color={c.tint} size="small" />
                  <Text style={[t.footnote, styles.runStateText, { color: c.label }]}>
                    {activeRun.status === 'queued' ? '正在准备回答…' : '正在查询家庭资料…'}
                  </Text>
                  <PressSurface
                    accessibilityRole="button"
                    disabled={cancelRun.isPending}
                    onPress={() =>
                      void cancelRun.mutateAsync({
                        runId: activeRun.id,
                        conversationId: activeRun.conversationId,
                      })
                    }
                    style={styles.cancelButton}
                  >
                    <CircleStop color={c.red} size={17} />
                    <Text style={[t.footnote, { color: c.red, fontWeight: '600' }]}>停止</Text>
                  </PressSurface>
                </View>
              ) : latestRun?.status === 'failed' || latestRun?.status === 'cancelled' ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={[styles.runState, { backgroundColor: c.redSoft }]}
                >
                  <Text style={[t.footnote, styles.runStateText, { color: c.red }]}>
                    {latestRun.status === 'cancelled'
                      ? '这次回答已停止。'
                      : latestRun.errorMessage ?? '回答失败，输入内容已保留，可再次发送。'}
                  </Text>
                </View>
              ) : latestRun?.errorCode === 'HERMES_UNAVAILABLE_FALLBACK' ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={[styles.runState, { backgroundColor: c.orangeSoft }]}
                >
                  <Text style={[t.footnote, styles.runStateText, { color: c.orange }]}>
                    本次由本地家庭摘要完成
                  </Text>
                </View>
              ) : null}
            </ScrollView>

            <View style={[styles.composerArea, { borderTopColor: c.separator }]}>
              {localError ? (
                <Text
                  accessibilityLiveRegion="polite"
                  role="alert"
                  style={[t.footnote, { color: c.red, marginBottom: 7 }]}
                >
                  {localError}
                </Text>
              ) : null}
              <View style={[styles.composer, { backgroundColor: c.fill, borderColor: c.separator }]}>
                <TextInput
                  accessibilityLabel="向家庭小管家提问"
                  editable={Boolean(status?.enabled && status.persistenceEncrypted) && !busy}
                  maxLength={2000}
                  multiline
                  onChangeText={setDraft}
                  placeholder="例如：这周家里有哪些安排？"
                  placeholderTextColor={c.tertiaryLabel}
                  style={[t.body, styles.input, { color: c.label }]}
                  testID="agent-message-input"
                  value={draft}
                />
                <IconButton
                  accessibilityLabel="发送问题"
                  backgroundColor={draft.trim() && !busy ? c.tint : c.fillStrong}
                  color={draft.trim() && !busy ? '#FFFFFF' : c.tertiaryLabel}
                  disabled={!draft.trim() || busy || !status?.enabled || !status.persistenceEncrypted}
                  icon={Send}
                  onPress={() => void submit()}
                  testID="agent-send-button"
                />
              </View>
            </View>
          </Card>
          <AssistantSettingsSheet
            manager={manager}
            onClose={() => setSettingsVisible(false)}
            visible={settingsVisible}
          />
          <ConversationHistorySheet
            archiving={archiveConversation.isPending}
            conversations={conversations ?? []}
            onArchive={(id) => void archiveById(id)}
            onClose={() => setHistoryVisible(false)}
            onSelect={(id) => {
              setConversationId(id);
              setHistoryVisible(false);
            }}
            selectedId={conversationId}
            visible={historyVisible}
          />
        </PageContainer>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { flex: 1, minHeight: 0, paddingBottom: 12, paddingTop: 12 },
  flexCopy: { flex: 1, minWidth: 0 },
  settingsPanel: {
    borderWidth: 1,
    borderRadius: radius.md,
    marginBottom: 12,
    padding: 14,
    gap: 12,
  },
  settingsPanelEmbedded: {
    borderWidth: 0,
    borderRadius: 0,
    marginBottom: 0,
    padding: 0,
  },
  settingsDialog: { maxHeight: '92%' },
  settingsSheet: { flexShrink: 1, maxHeight: '100%' },
  settingsSheetHeader: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 64,
    paddingHorizontal: 16,
  },
  settingsSheetContent: { gap: 24, padding: 16, paddingBottom: 32 },
  settingsHeading: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  settingsIcon: {
    alignItems: 'center',
    borderRadius: radius.sm,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  channelInput: {
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  memberChips: { gap: 8, paddingVertical: 2 },
  memberChip: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  channelAction: {
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  pairingCode: {
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  pairingCodeText: { letterSpacing: 2, marginTop: 2 },
  channelList: { borderTopWidth: 1, gap: 2, paddingTop: 8 },
  channelRow: { alignItems: 'center', flexDirection: 'row', minHeight: 52, gap: 8 },
  notice: {
    alignItems: 'center',
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  noticeText: { flex: 1, lineHeight: 19 },
  chat: { flex: 1, minHeight: 0, overflow: 'hidden' },
  chatCompact: { minHeight: 0 },
  chatHeader: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 64,
    paddingHorizontal: 12,
  },
  chatActions: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  botMark: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  messages: { flex: 1, flexGrow: 1, minHeight: 0, gap: 14, padding: 16 },
  messageRow: { alignItems: 'flex-end', flexDirection: 'row', gap: 8, maxWidth: '88%' },
  messageRowMine: { alignSelf: 'flex-end', justifyContent: 'flex-end' },
  messageAvatar: {
    alignItems: 'center',
    borderRadius: radius.full,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  messageBubble: {
    borderRadius: radius.md,
    borderWidth: 1,
    maxWidth: 680,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  messageText: { lineHeight: 25 },
  proposal: {
    alignSelf: 'stretch',
    borderLeftWidth: 3,
    gap: 11,
    maxWidth: 680,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  proposalHeading: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  proposalIcon: {
    alignItems: 'center',
    borderRadius: radius.sm,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  proposalSummary: { lineHeight: 19 },
  proposalChanges: { borderTopWidth: 1, gap: 8, paddingTop: 10 },
  proposalChange: { flexDirection: 'row', gap: 12 },
  proposalChangeLabel: { minWidth: 68, paddingTop: 1 },
  proposalChangeValue: { flex: 1, lineHeight: 19 },
  proposalWarning: { lineHeight: 18 },
  proposalActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  proposalButton: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 112,
    paddingHorizontal: 14,
  },
  welcome: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingVertical: 32 },
  welcomeIcon: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 56,
    justifyContent: 'center',
    marginBottom: 14,
    width: 56,
  },
  welcomeCopy: { lineHeight: 19, marginTop: 7, maxWidth: 430, textAlign: 'center' },
  suggestionScroller: { alignSelf: 'stretch', flexGrow: 0, marginTop: 20 },
  suggestions: { gap: 8, paddingHorizontal: 2 },
  suggestion: {
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    maxWidth: 260,
    minHeight: 44,
    paddingHorizontal: 13,
  },
  runState: {
    alignItems: 'center',
    alignSelf: 'stretch',
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: 9,
    minHeight: 48,
    paddingHorizontal: 13,
  },
  runStateText: { flex: 1, lineHeight: 19 },
  cancelButton: { alignItems: 'center', flexDirection: 'row', gap: 5, paddingHorizontal: 8 },
  composerArea: { borderTopWidth: 1, padding: 10 },
  composer: {
    alignItems: 'flex-end',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 54,
    padding: 5,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    paddingHorizontal: 8,
    paddingTop: Platform.OS === 'web' ? 11 : 10,
  },
  historyDialog: { maxHeight: '86%' },
  historySheet: { flexShrink: 1, maxHeight: '100%' },
  historyContent: { gap: 8, padding: 12, paddingBottom: 28 },
  historyRow: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 68,
    overflow: 'hidden',
    paddingRight: 4,
  },
  historySelect: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 11,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  historyIcon: {
    alignItems: 'center',
    borderRadius: radius.sm,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  historyEmpty: { alignItems: 'center', paddingHorizontal: 24, paddingVertical: 48 },
  historyEmptyText: { lineHeight: 19, marginTop: 6, textAlign: 'center' },
});
