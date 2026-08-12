import { useRouter } from 'expo-router';
import {
  Bell,
  BellRing,
  BookOpenText,
  ChevronDown,
  ChevronRight,
  Gift,
  History,
  KeyRound,
  ShieldCheck,
  Share2,
  Sparkles,
  Trash2,
  UserPlus,
  UsersRound,
} from 'lucide-react-native';
import React, { useState } from 'react';
import {
  Alert,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageContainer, useDesktopLayout } from '../../components/app-shell';
import {
  Card,
  ConfirmDialog,
  IOSSwitch,
  PressableScale,
  PrimaryButton,
  SectionHeader,
  Segmented,
} from '../../components/ui';
import { memberSubtitle } from '../../lib/member';
import {
  useCreateHouseholdInvitation,
  useAgentProfile,
  useAgentRoutines,
  useAgentSettings,
  useConfigureNightlyDelivery,
  useHouseholdInvitations,
  useRevokeHouseholdInvitation,
  useUpdateCookingPreference,
  useUpdateAgentProfile,
  useUpdatePassword,
} from '../../lib/queries';
import { useSession } from '../../lib/session';
import { radius, type as t, useTheme } from '../../lib/theme';
import type { CreatedHouseholdInvitation } from '../../lib/types';

type InviteRole = 'admin' | 'member';

export default function ProfileScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const { account, member, logout, updateAccount, updateMember } = useSession();
  const updatePreference = useUpdateCookingPreference();
  const agentProfile = useAgentProfile(Boolean(member));
  const updateAgentProfile = useUpdateAgentProfile();
  const updatePassword = useUpdatePassword();
  const canManageMembers = member?.role === 'owner' || member?.role === 'admin';
  const canManageAgent = canManageMembers;
  const consumer = member?.role === 'member';
  const adminDesktop = desktop && !consumer;
  const { data: invitations } = useHouseholdInvitations(canManageMembers);
  const createInvitation = useCreateHouseholdInvitation();
  const revokeInvitation = useRevokeHouseholdInvitation();
  const agentSettings = useAgentSettings(canManageAgent);
  const agentRoutines = useAgentRoutines(canManageAgent);
  const configureNightlyDelivery = useConfigureNightlyDelivery();
  const nightlyRoutine = agentRoutines.data?.find(
    (routine) => routine.kind === 'nightly_digest',
  );
  const nightlyDeliveryEnabled = Boolean(
    agentSettings.data?.routineNotificationsEnabled && nightlyRoutine?.enabled,
  );

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteEmoji, setInviteEmoji] = useState('🙂');
  const [inviteRole, setInviteRole] = useState<InviteRole>('member');
  const [createdInvitation, setCreatedInvitation] =
    useState<CreatedHouseholdInvitation | null>(null);
  const [logoutConfirmVisible, setLogoutConfirmVisible] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [securityExpanded, setSecurityExpanded] = useState(false);

  const savePassword = () => {
    if (newPassword !== confirmPassword) {
      Alert.alert('密码不一致', '请重新确认新密码');
      return;
    }
    updatePassword.mutate(
      { currentPassword: currentPassword || undefined, newPassword },
      {
        onSuccess: (updated) => {
          void updateAccount(updated);
          setCurrentPassword('');
          setNewPassword('');
          setConfirmPassword('');
          Alert.alert('密码已更新');
        },
        onError: (error) =>
          Alert.alert(
            '更新失败',
            error instanceof Error ? error.message : '请稍后再试',
          ),
      },
    );
  };

  const createMemberInvitation = () => {
    createInvitation.mutate(
      {
        memberName: inviteName,
        avatarEmoji: inviteEmoji || '🙂',
        role: inviteRole,
        expiresInHours: 48,
      },
      {
        onSuccess: (invitation) => {
          setCreatedInvitation(invitation);
          setInviteName('');
        },
        onError: (error) =>
          Alert.alert(
            '创建失败',
            error instanceof Error ? error.message : '请稍后再试',
          ),
      },
    );
  };

  const shareInvitation = async () => {
    if (!createdInvitation) return;
    try {
      await Share.share({
        message: `小管家家庭邀请码\n成员：${createdInvitation.memberName}\n邀请码：${createdInvitation.invitationToken}`,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      Alert.alert('分享不可用', '请选中邀请码并使用浏览器菜单复制');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <PageContainer
        maxWidth={consumer ? 720 : 1040}
        style={[
          styles.page,
          adminDesktop && styles.pageDesktop,
          consumer && styles.pageConsumer,
        ]}
      >
        <View
          style={[styles.header, consumer && styles.headerConsumer]}
          testID={consumer ? 'consumer-profile-header' : undefined}
        >
          {consumer ? (
            <Text style={[t.footnote, styles.consumerEyebrow, { color: c.tint }]}>我的家庭身份</Text>
          ) : null}
          <Text style={[consumer ? t.title1 : t.largeTitle, { color: c.label }]}>我的</Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Card
            style={[
              styles.profileCard,
              consumer && { backgroundColor: c.tintSoft },
            ]}
          >
            <Text style={{ fontSize: 52 }}>{member?.avatarEmoji}</Text>
            <View style={{ marginLeft: 14, flex: 1 }}>
              <Text style={[t.title2, { color: c.label }]}>{member?.name}</Text>
              <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 2 }]}>
                {member ? memberSubtitle(member) : '家庭成员'}
              </Text>
              <Text style={[t.caption, { color: c.tertiaryLabel, marginTop: 5 }]}>
                账号：{account?.loginName ?? '未加载'}
              </Text>
            </View>
          </Card>

          <SectionHeader title="家庭偏好" />
          <Card>
            <View style={styles.preferenceRow}>
              <View style={{ flex: 1 }}>
                <Text style={[t.body, { color: c.label }]}>经常掌勺</Text>
                <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>
                  {member?.prefersCooking ? '已标记' : '未标记'}
                </Text>
              </View>
              <IOSSwitch
                accessibilityLabel="愿意参与掌勺"
                disabled={!member || updatePreference.isPending}
                onValueChange={(prefersCooking) => {
                  updatePreference.mutate(prefersCooking, {
                    onSuccess: (updated) => void updateMember(updated),
                    onError: (error) =>
                      Alert.alert(
                        '更新失败',
                        error instanceof Error ? error.message : '请稍后再试',
                      ),
                  });
                }}
                value={member?.prefersCooking ?? false}
              />
            </View>
          </Card>

          <SectionHeader title="小管家" />
          <Card>
            <PressableScale
              accessibilityLabel="管理小管家记忆"
              accessibilityRole="link"
              haptic={false}
              onPress={() => router.push('/agent-memory')}
              style={styles.recipeRow}
              testID="agent-memory-entry"
            >
              <View style={[styles.recipeIcon, { backgroundColor: c.tintSoft }]}>
                <Sparkles color={c.tint} size={20} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[t.body, { color: c.label, fontWeight: '600' }]}>我的记忆</Text>
                <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 2 }]}>管理个人偏好与共享知识</Text>
              </View>
              <ChevronRight color={c.tertiaryLabel} size={19} />
            </PressableScale>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.separator }} />
            <View style={styles.preferenceRow}>
              <View style={{ flex: 1 }}>
                <Text style={[t.body, { color: c.label }]}>启用记忆</Text>
                <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>
                  {agentProfile.error
                    ? '状态暂时无法读取'
                    : updateAgentProfile.error
                      ? '更新失败，请重试'
                      : agentProfile.data?.memoryEnabled === false
                        ? '小管家不会记录或使用个人偏好'
                        : '让小管家记住确认过的个人偏好'}
                </Text>
              </View>
              <IOSSwitch
                accessibilityLabel="启用小管家记忆"
                disabled={!agentProfile.data || updateAgentProfile.isPending}
                onValueChange={(memoryEnabled) => {
                  const profile = agentProfile.data;
                  if (!profile) return;
                  updateAgentProfile.mutate(
                    { memoryEnabled, expectedVersion: profile.version },
                    {
                      onError: (error) =>
                        Alert.alert(
                          '更新失败',
                          error instanceof Error ? error.message : '请稍后再试',
                        ),
                    },
                  );
                }}
                value={agentProfile.data?.memoryEnabled ?? true}
              />
            </View>
            {canManageAgent ? (
              <>
                <View style={[styles.insetSeparator, { backgroundColor: c.separator }]} />
                <View style={styles.preferenceRow}>
                  <View style={[styles.recipeIcon, { backgroundColor: c.orangeSoft }]}>
                    <BellRing color={c.orange} size={20} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[t.body, { color: c.label }]}>主动提醒</Text>
                    <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>
                      {agentSettings.error || agentRoutines.error
                        ? '提醒状态暂时无法读取'
                        : nightlyRoutine
                          ? `每天 ${String(nightlyRoutine.scheduleHour).padStart(2, '0')}:${String(
                              nightlyRoutine.scheduleMinute,
                            ).padStart(2, '0')} 汇总临期订阅、药品和家庭待办`
                          : '正在读取夜间汇总计划'}
                    </Text>
                  </View>
                  <IOSSwitch
                    accessibilityLabel="启用家庭主动提醒"
                    disabled={
                      !agentSettings.data ||
                      !nightlyRoutine ||
                      configureNightlyDelivery.isPending
                    }
                    onValueChange={(enabled) => {
                      if (!agentSettings.data || !nightlyRoutine) return;
                      configureNightlyDelivery.mutate(
                        {
                          enabled,
                          expectedSettingsVersion: agentSettings.data.version,
                          expectedRoutineVersion: nightlyRoutine.version,
                        },
                        {
                          onError: (toggleError) =>
                            Alert.alert(
                              '更新失败',
                              toggleError instanceof Error
                                ? toggleError.message
                                : '请刷新后重试',
                            ),
                        },
                      );
                    }}
                    testID="nightly-delivery-switch"
                    value={nightlyDeliveryEnabled}
                  />
                </View>
              </>
            ) : null}
          </Card>

          <SectionHeader title="账号安全" />
          {consumer ? (
            <Card>
              <PressableScale
                accessibilityLabel={`${securityExpanded ? '收起' : '展开'}账号安全设置`}
                accessibilityState={{ expanded: securityExpanded }}
                onPress={() => setSecurityExpanded((current) => !current)}
                style={styles.securityDisclosure}
                testID="consumer-security-disclosure"
              >
                <View style={[styles.recipeIcon, { backgroundColor: c.blueSoft }]}>
                  <ShieldCheck color={c.blue} size={20} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[t.body, { color: c.label, fontWeight: '600' }]}>登录与密码</Text>
                  <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 2 }]}>需要时再修改账号密码</Text>
                </View>
                <ChevronDown
                  color={c.tertiaryLabel}
                  size={19}
                  style={{ transform: [{ rotate: securityExpanded ? '180deg' : '0deg' }] }}
                />
              </PressableScale>
            </Card>
          ) : null}
          {!consumer || securityExpanded ? (
            <Card style={[styles.formCard, consumer && styles.expandedSecurityCard]}>
              {account?.requiresPasswordSetup ? (
                <View style={[styles.securityNotice, { backgroundColor: c.orangeSoft }]}>
                  <KeyRound color={c.orange} size={18} />
                  <Text style={[t.subhead, { color: c.label, flex: 1 }]}>当前账号尚未设置密码</Text>
                </View>
              ) : (
                <ProfileInput
                  label="当前密码"
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  secureTextEntry
                />
              )}
              <ProfileInput
                label="新密码"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                placeholder="至少 8 位"
              />
              <ProfileInput
                label="确认新密码"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
              />
              <PrimaryButton
                title="更新密码"
                onPress={savePassword}
                disabled={newPassword.length < 8 || confirmPassword.length < 8}
                loading={updatePassword.isPending}
                icon={<KeyRound color="#FFFFFF" size={18} />}
              />
            </Card>
          ) : null}

          {canManageMembers ? (
            <>
              <SectionHeader title="成员邀请" />
              <Card style={styles.formCard}>
                <View style={styles.inviteIdentityRow}>
                  <View style={styles.emojiField}>
                    <ProfileInput
                      label="头像"
                      value={inviteEmoji}
                      onChangeText={setInviteEmoji}
                      maxLength={4}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ProfileInput
                      label="成员名称"
                      value={inviteName}
                      onChangeText={setInviteName}
                      placeholder="家庭成员"
                    />
                  </View>
                </View>
                <View style={{ gap: 7 }}>
                  <Text style={[t.footnote, { color: c.secondaryLabel }]}>家庭角色</Text>
                  <Segmented<InviteRole>
                    options={[
                      { label: '成员', value: 'member' },
                      { label: '管理员', value: 'admin' },
                    ]}
                    value={inviteRole}
                    onChange={setInviteRole}
                  />
                </View>
                <PrimaryButton
                  title="生成 48 小时邀请"
                  onPress={createMemberInvitation}
                  disabled={!inviteName.trim()}
                  loading={createInvitation.isPending}
                  icon={<UserPlus color="#FFFFFF" size={18} />}
                />

                {createdInvitation ? (
                  <View style={[styles.tokenBox, { backgroundColor: c.tintSoft }]}>
                    <Text style={[t.footnote, { color: c.secondaryLabel }]}>一次性邀请码</Text>
                    <Text selectable style={[styles.tokenText, { color: c.label }]}>
                      {createdInvitation.invitationToken}
                    </Text>
                    <PressableScale onPress={() => void shareInvitation()} style={styles.shareButton}>
                      <Share2 color={c.tint} size={17} />
                      <Text style={[t.subhead, { color: c.tint, fontWeight: '600' }]}>分享邀请</Text>
                    </PressableScale>
                  </View>
                ) : null}
              </Card>

              {(invitations?.length ?? 0) > 0 ? (
                <Card style={styles.invitationList}>
                  {invitations?.map((invitation) => (
                    <View
                      key={invitation.id}
                      style={[styles.invitationRow, { borderBottomColor: c.separator }]}
                    >
                      <Text style={{ fontSize: 24 }}>{invitation.avatarEmoji}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[t.body, { color: c.label }]}>{invitation.memberName}</Text>
                        <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>
                          {invitation.role === 'admin' ? '管理员' : '成员'} · {formatExpiry(invitation.expiresAt)}到期
                        </Text>
                      </View>
                      <PressableScale
                        accessibilityLabel={`撤销${invitation.memberName}的邀请`}
                        disabled={revokeInvitation.isPending}
                        onPress={() =>
                          Alert.alert('撤销邀请', `撤销给「${invitation.memberName}」的邀请？`, [
                            { text: '取消', style: 'cancel' },
                            {
                              text: '撤销',
                              style: 'destructive',
                              onPress: () =>
                                revokeInvitation.mutate(invitation.id, {
                                  onSuccess: () => {
                                    if (createdInvitation?.id === invitation.id) {
                                      setCreatedInvitation(null);
                                    }
                                  },
                                  onError: (error) =>
                                    Alert.alert(
                                      '撤销失败',
                                      error instanceof Error
                                        ? error.message
                                        : '请稍后再试',
                                    ),
                                }),
                            },
                          ])
                        }
                        style={styles.iconButton}
                      >
                        <Trash2 color={c.red} size={18} />
                      </PressableScale>
                    </View>
                  ))}
                </Card>
              ) : null}
            </>
          ) : null}

          <SectionHeader title="家庭内容" />
          <Card>
            <PressableScale
              accessibilityLabel="打开家庭菜谱"
              accessibilityRole="link"
              haptic={false}
              onPress={() => router.push('/recipes')}
              style={styles.recipeRow}
            >
              <View style={[styles.recipeIcon, { backgroundColor: c.tintSoft }]}>
                <BookOpenText color={c.tint} size={20} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[t.body, { color: c.label, fontWeight: '600' }]}>家庭菜谱</Text>
                <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 2 }]}>
                  {consumer ? '看看家里的菜谱和成员做法' : '管理菜品、成员做法和会做的菜'}
                </Text>
              </View>
              <ChevronRight color={c.tertiaryLabel} size={19} />
            </PressableScale>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.separator }} />
            <PressableScale
              accessibilityLabel="打开家庭活动"
              accessibilityRole="link"
              haptic={false}
              onPress={() => router.push('/activity')}
              style={styles.recipeRow}
            >
              <View style={[styles.recipeIcon, { backgroundColor: c.blueSoft }]}>
                <History color={c.blue} size={20} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[t.body, { color: c.label, fontWeight: '600' }]}>家庭活动</Text>
                <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 2 }]}>
                  {consumer ? '看看家里最近发生了什么' : '成员管理与菜单动态'}
                </Text>
              </View>
              <ChevronRight color={c.tertiaryLabel} size={19} />
            </PressableScale>
            {consumer ? (
              <>
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.separator }} />
                <PressableScale
                  accessibilityLabel="打开我的积分"
                  accessibilityRole="link"
                  haptic={false}
                  onPress={() => router.push('/points')}
                  style={styles.recipeRow}
                >
                  <View style={[styles.recipeIcon, { backgroundColor: c.orangeSoft }]}>
                    <Gift color={c.orange} size={20} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[t.body, { color: c.label, fontWeight: '600' }]}>我的积分</Text>
                    <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 2 }]}>查看任务奖励和积分记录</Text>
                  </View>
                  <ChevronRight color={c.tertiaryLabel} size={19} />
                </PressableScale>
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.separator }} />
                <PressableScale
                  accessibilityLabel="打开家庭知识库"
                  accessibilityRole="link"
                  haptic={false}
                  onPress={() => router.push('/knowledge')}
                  style={styles.recipeRow}
                >
                  <View style={[styles.recipeIcon, { backgroundColor: c.greenSoft }]}>
                    <BookOpenText color={c.green} size={20} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[t.body, { color: c.label, fontWeight: '600' }]}>家庭知识库</Text>
                    <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 2 }]}>查找家里的说明和经验</Text>
                  </View>
                  <ChevronRight color={c.tertiaryLabel} size={19} />
                </PressableScale>
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.separator }} />
                <PressableScale
                  accessibilityLabel="打开消息通知"
                  accessibilityRole="link"
                  haptic={false}
                  onPress={() => router.push('/notifications')}
                  style={styles.recipeRow}
                >
                  <View style={[styles.recipeIcon, { backgroundColor: c.accentSoft }]}>
                    <Bell color={c.accent} size={20} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[t.body, { color: c.label, fontWeight: '600' }]}>消息通知</Text>
                    <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 2 }]}>查看需要处理的家庭消息</Text>
                  </View>
                  <ChevronRight color={c.tertiaryLabel} size={19} />
                </PressableScale>
              </>
            ) : null}
            {canManageMembers ? (
              <>
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.separator }} />
                <PressableScale
                  accessibilityLabel="打开家庭成员"
                  accessibilityRole="link"
                  haptic={false}
                  onPress={() => router.push('/members')}
                  style={styles.recipeRow}
                >
                  <View style={[styles.recipeIcon, { backgroundColor: c.greenSoft }]}>
                    <UsersRound color={c.green} size={20} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[t.body, { color: c.label, fontWeight: '600' }]}>家庭成员</Text>
                    <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 2 }]}>档案、角色与登录状态</Text>
                  </View>
                  <ChevronRight color={c.tertiaryLabel} size={19} />
                </PressableScale>
              </>
            ) : null}
          </Card>

          <SectionHeader title="账号" />
          <Card>
            <PressableScale
              accessibilityLabel="退出登录"
              onPress={() => setLogoutConfirmVisible(true)}
              style={{ padding: 14 }}
            >
              <Text style={[t.body, { color: c.red, textAlign: 'center' }]}>退出登录</Text>
            </PressableScale>
          </Card>

          <Text style={[t.footnote, styles.version, { color: c.tertiaryLabel }]}>
            小管家 v0.2 · 家庭协作平台
          </Text>
        </ScrollView>
      </PageContainer>

      <ConfirmDialog
        confirmLabel="退出"
        loading={loggingOut}
        message={`退出账号「${account?.loginName ?? ''}」？`}
        onCancel={() => setLogoutConfirmVisible(false)}
        onConfirm={() => {
          setLoggingOut(true);
          void logout();
        }}
        title="退出登录"
        visible={logoutConfirmVisible}
      />
    </SafeAreaView>
  );
}

function ProfileInput({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  maxLength?: number;
}) {
  const c = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[t.footnote, { color: c.secondaryLabel }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={maxLength}
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

function formatExpiry(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingTop: 8 },
  pageDesktop: { paddingTop: 22 },
  pageConsumer: { paddingTop: 14 },
  header: { paddingTop: 0 },
  headerConsumer: { paddingTop: 0, paddingBottom: 4 },
  consumerEyebrow: { fontWeight: '700', marginBottom: 5 },
  scrollContent: { paddingBottom: 56 },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    marginTop: 16,
  },
  preferenceRow: {
    minHeight: 64,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  insetSeparator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 66,
  },
  formCard: { padding: 16, gap: 14 },
  securityNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 11,
    borderRadius: radius.sm,
  },
  securityDisclosure: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 72,
    paddingHorizontal: 14,
  },
  expandedSecurityCard: { marginTop: 10 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 16,
  },
  inviteIdentityRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  emojiField: { width: 76 },
  tokenBox: { padding: 12, borderRadius: radius.sm, gap: 7 },
  tokenText: { fontSize: 14, lineHeight: 20 },
  shareButton: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  invitationList: { marginTop: 10 },
  invitationRow: {
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recipeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 72,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  recipeIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  version: { textAlign: 'center', marginTop: 24 },
});
