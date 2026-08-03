import {
  Archive,
  Bot,
  CircleStop,
  CloudOff,
  MessageCircleMore,
  Plus,
  Send,
  Settings2,
  Sparkles,
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
import { PageContainer, PageHeader, useLayoutMode } from '../../components/app-shell';
import {
  Card,
  IconButton,
  PressSurface,
  Segmented,
  SkeletonRows,
} from '../../components/ui';
import { isHouseholdManager } from '../../lib/member';
import {
  useAgentConversation,
  useAgentConversations,
  useAgentSettings,
  useAgentStatus,
  useArchiveAgentConversation,
  useCancelAgentRun,
  useCreateAgentConversation,
  useSendAgentMessage,
  useUpdateAgentSettings,
} from '../../lib/queries';
import { useSession } from '../../lib/session';
import { radius, type as t, useTheme } from '../../lib/theme';
import type { AgentMessage, AgentRuntimeKind } from '../../lib/types';

const SUGGESTIONS = [
  '今天家里有什么安排？',
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

function RuntimeSettings() {
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
    <View style={[styles.settingsPanel, { borderColor: c.separator }]} testID="agent-settings-panel">
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

export default function AssistantScreen() {
  const c = useTheme();
  const layout = useLayoutMode();
  const { member } = useSession();
  const manager = isHouseholdManager(member);
  const { data: status, isLoading: statusLoading } = useAgentStatus();
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
  const scrollRef = React.useRef<ScrollView>(null);
  const messageCount = conversation?.messages.length ?? 0;
  const latestRunStatus = conversation?.runs[0]?.status;

  React.useEffect(() => {
    if (!conversationId && conversations?.length) {
      setConversationId(conversations[0].id);
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

  const archiveCurrent = async () => {
    if (!conversationId) return;
    setLocalError(null);
    try {
      await archiveConversation.mutateAsync(conversationId);
      setConversationId(null);
    } catch (error) {
      setLocalError(errorMessage(error));
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.screen}
      >
        <PageContainer maxWidth={1040} style={styles.page}>
          <PageHeader
            eyebrow="家庭助理"
            title="问问小管家"
            subtitle="查询家庭安排、库存、知识、出行、观影和回忆"
            action={
              <IconButton
                accessibilityLabel="开始新对话"
                icon={Plus}
                onPress={() => void newConversation()}
                testID="agent-new-conversation"
              />
            }
          />

          {manager ? <RuntimeSettings /> : null}

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

          {conversations?.length ? (
            <ScrollView
              contentContainerStyle={styles.conversationTabs}
              horizontal
              showsHorizontalScrollIndicator={false}
              testID="agent-conversation-list"
            >
              {conversations.map((item) => (
                <PressSurface
                  accessibilityRole="button"
                  accessibilityState={{ selected: item.id === conversationId }}
                  key={item.id}
                  onPress={() => setConversationId(item.id)}
                  style={[
                    styles.conversationTab,
                    {
                      backgroundColor: item.id === conversationId ? c.tintSoft : c.fill,
                      borderColor: item.id === conversationId ? c.tint : c.separator,
                    },
                  ]}
                >
                  <MessageCircleMore
                    color={item.id === conversationId ? c.tint : c.secondaryLabel}
                    size={16}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      t.footnote,
                      {
                        color: item.id === conversationId ? c.tint : c.label,
                        fontWeight: '600',
                      },
                    ]}
                  >
                    {item.title}
                  </Text>
                </PressSurface>
              ))}
            </ScrollView>
          ) : null}

          <Card style={[styles.chat, layout === 'compact' && styles.chatCompact]}>
            <View style={[styles.chatHeader, { borderBottomColor: c.separator }]}>
              <View style={[styles.botMark, { backgroundColor: c.tintSoft }]}>
                <Bot color={c.tint} size={21} />
              </View>
              <View style={styles.flexCopy}>
                <Text style={[t.headline, { color: c.label }]}>家庭小管家</Text>
                <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>
                  {status?.selected.available
                    ? status.runtimeKind === 'hermes'
                      ? 'Hermes 已连接'
                      : '本地家庭摘要可用'
                    : '离线模式可用'}
                </Text>
              </View>
              {conversationId ? (
                <IconButton
                  accessibilityLabel="归档当前对话"
                  backgroundColor="transparent"
                  disabled={archiveConversation.isPending || Boolean(activeRun)}
                  icon={Archive}
                  onPress={() => void archiveCurrent()}
                />
              ) : null}
            </View>

            <ScrollView
              contentContainerStyle={styles.messages}
              keyboardShouldPersistTaps="handled"
              ref={scrollRef}
              showsVerticalScrollIndicator={false}
              testID="agent-message-list"
            >
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
                  <View style={styles.suggestions}>
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
                        <Text style={[t.footnote, { color: c.label }]}>{suggestion}</Text>
                      </PressSurface>
                    ))}
                  </View>
                </View>
              )}

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
              <Text style={[t.caption, { color: c.tertiaryLabel, marginTop: 7 }]}>只读查询，不会替你修改家庭数据</Text>
            </View>
          </Card>
        </PageContainer>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { flex: 1, paddingBottom: 14 },
  flexCopy: { flex: 1, minWidth: 0 },
  settingsPanel: {
    borderWidth: 1,
    borderRadius: radius.md,
    marginBottom: 12,
    padding: 14,
    gap: 12,
  },
  settingsHeading: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  settingsIcon: {
    alignItems: 'center',
    borderRadius: radius.sm,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  notice: {
    alignItems: 'center',
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  noticeText: { flex: 1, lineHeight: 19 },
  conversationTabs: { gap: 8, paddingBottom: 12 },
  conversationTab: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    maxWidth: 220,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  chat: { flex: 1, minHeight: 560, overflow: 'hidden' },
  chatCompact: { minHeight: 0 },
  chatHeader: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 68,
    paddingHorizontal: 14,
  },
  botMark: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  messages: { flexGrow: 1, gap: 14, padding: 16 },
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
  welcome: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingVertical: 42 },
  welcomeIcon: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 56,
    justifyContent: 'center',
    marginBottom: 14,
    width: 56,
  },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    marginTop: 20,
    maxWidth: 620,
  },
  suggestion: {
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
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
  composerArea: { borderTopWidth: 1, padding: 12 },
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
});
