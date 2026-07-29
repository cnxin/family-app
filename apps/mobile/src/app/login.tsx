import { Redirect } from 'expo-router';
import {
  House,
  KeyRound,
  LogIn,
  UserPlus,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDesktopLayout } from '../components/app-shell';
import { PressableScale, PrimaryButton, Segmented } from '../components/ui';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { radius, type as t, useTheme } from '../lib/theme';
import type {
  AuthSetupStatus,
  InvitationPreview,
} from '../lib/types';

type LoginMode = 'login' | 'join';

export default function LoginScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const {
    member,
    ready,
    login,
    bootstrap,
    redeemInvitation,
  } = useSession();
  const [setupStatus, setSetupStatus] = useState<AuthSetupStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [mode, setMode] = useState<LoginMode>('login');
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [householdSlug, setHouseholdSlug] = useState('');
  const [invitationToken, setInvitationToken] = useState('');
  const [invitePreview, setInvitePreview] = useState<InvitationPreview | null>(null);
  const [householdName, setHouseholdName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [bootstrapKey, setBootstrapKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadSetupStatus = useCallback(async () => {
    setStatusError(false);
    try {
      setSetupStatus(
        await api<AuthSetupStatus>('/auth/setup/status', { auth: false }),
      );
    } catch {
      setStatusError(true);
    }
  }, []);

  useEffect(() => {
    if (ready && !member) void loadSetupStatus();
  }, [loadSetupStatus, member, ready]);

  if (!ready) return null;
  if (member) return <Redirect href="/(tabs)" />;

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (!setupStatus?.initialized) {
        await bootstrap({
          bootstrapSecret: bootstrapKey,
          householdName,
          ownerName,
          loginName,
          password,
        });
      } else if (mode === 'join') {
        await redeemInvitation({ invitationToken, loginName, password });
      } else {
        await login(
          loginName,
          password || undefined,
          householdSlug || undefined,
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const previewInvitation = async () => {
    setPreviewBusy(true);
    setMessage(null);
    try {
      setInvitePreview(
        await api<InvitationPreview>('/auth/invitations/preview', {
          method: 'POST',
          body: { invitationToken },
          auth: false,
        }),
      );
    } catch (error) {
      setInvitePreview(null);
      setMessage(error instanceof Error ? error.message : '邀请码无效');
    } finally {
      setPreviewBusy(false);
    }
  };

  const initialized = setupStatus?.initialized ?? false;
  const canSubmit = !initialized
    ? Boolean(
        bootstrapKey.length >= 16 &&
          householdName.trim() &&
          ownerName.trim() &&
          loginName.trim().length >= 2 &&
          password.length >= 8,
      )
    : mode === 'join'
      ? Boolean(
          invitationToken.trim().length >= 32 &&
            loginName.trim().length >= 2 &&
            password.length >= 1,
        )
      : Boolean(loginName.trim());

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            entering={FadeInDown.duration(320)}
            style={[styles.frame, desktop && styles.frameDesktop]}
          >
            <View style={styles.brandRow}>
              <View style={[styles.brandMark, { backgroundColor: c.tint }]}>
                <House color="#FFFFFF" size={25} strokeWidth={2.2} />
              </View>
              <View>
                <Text style={[t.headline, { color: c.label }]}>小管家</Text>
                <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>家庭空间</Text>
              </View>
            </View>

            {!setupStatus && !statusError ? (
              <ActivityIndicator color={c.tint} style={styles.loader} />
            ) : null}

            {statusError ? (
              <View style={styles.statusState}>
                <Text style={[t.headline, { color: c.label }]}>服务器暂时不可用</Text>
                <PressableScale onPress={() => void loadSetupStatus()} style={styles.retryButton}>
                  <Text style={[t.subhead, { color: c.tint, fontWeight: '600' }]}>重新连接</Text>
                </PressableScale>
              </View>
            ) : null}

            {setupStatus ? (
              <>
                <View style={styles.heading}>
                  <Text style={[t.largeTitle, { color: c.label }]}>
                    {initialized
                      ? mode === 'login'
                        ? '欢迎回家'
                        : '加入家庭'
                      : '建立家庭空间'}
                  </Text>
                  <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 7 }]}>
                    {initialized
                      ? mode === 'login'
                        ? '使用家庭账号登录'
                        : '领取家庭成员邀请'
                      : '创建首位家庭管理员'}
                  </Text>
                </View>

                {initialized ? (
                  <Segmented<LoginMode>
                    options={[
                      { label: '账号登录', value: 'login' },
                      { label: '邀请码', value: 'join' },
                    ]}
                    value={mode}
                    onChange={(nextMode) => {
                      setMode(nextMode);
                      setMessage(null);
                    }}
                  />
                ) : null}

                <View
                  style={[
                    styles.form,
                    { backgroundColor: c.card, borderColor: c.separator },
                  ]}
                >
                  {!initialized ? (
                    <>
                      <FormField
                        label="家庭名称"
                        value={householdName}
                        onChangeText={setHouseholdName}
                        placeholder="我的家"
                      />
                      <FormField
                        label="你的成员名称"
                        value={ownerName}
                        onChangeText={setOwnerName}
                        placeholder="家庭管理员"
                      />
                    </>
                  ) : null}

                  {initialized && mode === 'join' ? (
                    <>
                      <FormField
                        label="邀请码"
                        value={invitationToken}
                        onChangeText={(value) => {
                          setInvitationToken(value.trim());
                          setInvitePreview(null);
                        }}
                        placeholder="输入收到的邀请码"
                        autoCapitalize="none"
                      />
                      <PressableScale
                        disabled={invitationToken.length < 32 || previewBusy}
                        onPress={() => void previewInvitation()}
                        style={styles.previewButton}
                      >
                        {previewBusy ? (
                          <ActivityIndicator color={c.tint} size="small" />
                        ) : (
                          <Text style={[t.subhead, { color: c.tint, fontWeight: '600' }]}>验证邀请码</Text>
                        )}
                      </PressableScale>
                      {invitePreview ? (
                        <View style={[styles.previewBox, { backgroundColor: c.tintSoft }]}>
                          <Text style={[t.body, { color: c.label }]}>
                            {invitePreview.avatarEmoji} {invitePreview.householdName}
                          </Text>
                          <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>成员档案：{invitePreview.memberName}</Text>
                        </View>
                      ) : null}
                    </>
                  ) : null}

                  <FormField
                    label="登录账号"
                    value={loginName}
                    onChangeText={setLoginName}
                    placeholder="输入账号"
                    autoCapitalize="none"
                  />
                  <FormField
                    label="密码"
                    value={password}
                    onChangeText={setPassword}
                    placeholder={
                      initialized
                        ? '输入密码'
                        : '至少 8 位'
                    }
                    secureTextEntry
                    autoCapitalize="none"
                  />

                  {initialized && mode === 'login' ? (
                    <FormField
                      label="家庭标识（可选）"
                      value={householdSlug}
                      onChangeText={setHouseholdSlug}
                      placeholder="多家庭账号可指定"
                      autoCapitalize="none"
                    />
                  ) : null}

                  {!initialized ? (
                    <FormField
                      label="初始化密钥"
                      value={bootstrapKey}
                      onChangeText={setBootstrapKey}
                      placeholder="输入部署时生成的密钥"
                      secureTextEntry
                      autoCapitalize="none"
                    />
                  ) : null}
                </View>

                {message ? (
                  <View style={[styles.messageBox, { backgroundColor: c.redSoft }]}>
                    <Text style={[t.subhead, { color: c.red, textAlign: 'center' }]}>{message}</Text>
                  </View>
                ) : null}

                <PrimaryButton
                  title={
                    !initialized
                      ? '创建并进入'
                      : mode === 'join'
                        ? '领取邀请并进入'
                        : '登录'
                  }
                  onPress={() => void submit()}
                  disabled={!canSubmit}
                  loading={busy}
                  icon={
                    !busy ? (
                      initialized ? (
                        mode === 'join' ? (
                          <UserPlus color="#FFFFFF" size={18} />
                        ) : (
                          <LogIn color="#FFFFFF" size={18} />
                        )
                      ) : (
                        <KeyRound color="#FFFFFF" size={18} />
                      )
                    ) : undefined
                  }
                />

              </>
            ) : null}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  autoCapitalize = 'sentences',
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  const c = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[t.footnote, { color: c.secondaryLabel }]}>{label}</Text>
      <TextInput
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.tertiaryLabel}
        secureTextEntry={secureTextEntry}
        style={[
          styles.input,
          { backgroundColor: c.bg, borderColor: c.separator, color: c.label },
        ]}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  frame: { width: '100%', maxWidth: 536 },
  frameDesktop: { maxWidth: 520 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  brandMark: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loader: { marginVertical: 64 },
  statusState: { alignItems: 'center', gap: 14, paddingVertical: 64 },
  retryButton: { paddingHorizontal: 18, paddingVertical: 10 },
  heading: { marginTop: 34, marginBottom: 22 },
  form: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 16,
    gap: 14,
    marginTop: 16,
    marginBottom: 16,
  },
  field: { gap: 6 },
  input: {
    width: '100%',
    minHeight: 46,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 10,
    fontSize: 16,
  },
  previewButton: {
    minHeight: 34,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  previewBox: { borderRadius: radius.sm, padding: 12 },
  messageBox: { padding: 11, borderRadius: radius.sm, marginBottom: 12 },
});
