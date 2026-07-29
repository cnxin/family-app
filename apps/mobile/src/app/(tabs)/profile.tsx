import { useRouter } from 'expo-router';
import { KeyRound, Share2, Trash2, UserPlus } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  Alert,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageContainer, useDesktopLayout } from '../../components/app-shell';
import {
  Card,
  PressableScale,
  PrimaryButton,
  SectionHeader,
  Segmented,
} from '../../components/ui';
import { memberSubtitle } from '../../lib/member';
import {
  useCreateHouseholdInvitation,
  useDishes,
  useHouseholdInvitations,
  useRemoveDish,
  useRevokeHouseholdInvitation,
  useUpdateCookingPreference,
  useUpdatePassword,
} from '../../lib/queries';
import { useSession } from '../../lib/session';
import { CATEGORY_EMOJI, radius, type as t, useTheme } from '../../lib/theme';
import type { CreatedHouseholdInvitation } from '../../lib/types';

type InviteRole = 'admin' | 'member';

export default function ProfileScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const { account, member, logout, updateAccount, updateMember } = useSession();
  const { data: dishes } = useDishes();
  const removeDish = useRemoveDish();
  const updatePreference = useUpdateCookingPreference();
  const updatePassword = useUpdatePassword();
  const canManageMembers = member?.role === 'owner' || member?.role === 'admin';
  const { data: invitations } = useHouseholdInvitations(canManageMembers);
  const createInvitation = useCreateHouseholdInvitation();
  const revokeInvitation = useRevokeHouseholdInvitation();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteEmoji, setInviteEmoji] = useState('🙂');
  const [inviteRole, setInviteRole] = useState<InviteRole>('member');
  const [createdInvitation, setCreatedInvitation] =
    useState<CreatedHouseholdInvitation | null>(null);

  const confirmRemove = (id: string, name: string) => {
    Alert.alert('下架菜品', `「${name}」将不再出现在点菜列表里`, [
      { text: '取消', style: 'cancel' },
      {
        text: '下架',
        style: 'destructive',
        onPress: () => removeDish.mutate(id),
      },
    ]);
  };

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
        maxWidth={1040}
        style={[styles.page, desktop && styles.pageDesktop]}
      >
        <View style={styles.header}>
          <Text style={[t.largeTitle, { color: c.label }]}>我的</Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Card style={styles.profileCard}>
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
              <Switch
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
                trackColor={{ false: c.fillStrong, true: c.tintSoft }}
                thumbColor={member?.prefersCooking ? c.tint : c.tertiaryLabel}
                value={member?.prefersCooking ?? false}
              />
            </View>
          </Card>

          <SectionHeader title="账号安全" />
          <Card style={styles.formCard}>
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

          <SectionHeader title={`菜谱管理（${dishes?.length ?? 0} 道）`} right={
            <PressableScale onPress={() => router.push('/dish-edit')}>
              <Text style={[t.subhead, { color: c.tint, fontWeight: '600' }]}>＋ 新增菜品</Text>
            </PressableScale>
          } />
          <Card>
            {(dishes ?? []).map((dish) => (
              <View
                key={dish.id}
                style={[styles.dishRow, { borderBottomColor: c.separator }]}
              >
                <Text style={{ fontSize: 24 }}>{CATEGORY_EMOJI[dish.category] ?? '🍽️'}</Text>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[t.body, { color: c.label }]}>{dish.name}</Text>
                  <Text style={[t.footnote, { color: c.secondaryLabel }]}>
                    {dish.category} · {dish.ingredients?.length ?? 0} 种食材 · {dish.recipeSteps?.length ?? 0} 步做法
                  </Text>
                </View>
                <PressableScale
                  onPress={() => router.push(`/dish-edit?id=${dish.id}`)}
                  style={styles.rowButton}
                >
                  <Text style={[t.subhead, { color: c.tint }]}>编辑</Text>
                </PressableScale>
                <PressableScale
                  onPress={() => confirmRemove(dish.id, dish.name)}
                  style={styles.rowButton}
                >
                  <Text style={[t.subhead, { color: c.red }]}>下架</Text>
                </PressableScale>
              </View>
            ))}
          </Card>

          <SectionHeader title="账号" />
          <Card>
            <PressableScale
              onPress={() =>
                Alert.alert('退出登录', `退出账号「${account?.loginName ?? ''}」？`, [
                  { text: '取消', style: 'cancel' },
                  { text: '退出', style: 'destructive', onPress: () => void logout() },
                ])
              }
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
  header: { paddingTop: 0 },
  scrollContent: { paddingBottom: 32 },
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
  formCard: { padding: 16, gap: 14 },
  securityNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 11,
    borderRadius: radius.sm,
  },
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
  dishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowButton: { paddingHorizontal: 8, paddingVertical: 6 },
  version: { textAlign: 'center', marginTop: 24 },
});
