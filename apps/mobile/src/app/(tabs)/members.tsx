import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Pencil,
  Power,
  PowerOff,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
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
  EmptyState,
  PressableScale,
  PrimaryButton,
  Segmented,
} from '../../components/ui';
import { memberRoleLabel } from '../../lib/member';
import {
  useManagedMembers,
  useUpdateManagedMember,
  useUpdateManagedMemberStatus,
} from '../../lib/queries';
import { useSession } from '../../lib/session';
import { radius, type as t, useTheme } from '../../lib/theme';
import type { ManagedMember, MemberRole } from '../../lib/types';

type MemberFilter = 'active' | 'all';

export default function MembersScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const params = useLocalSearchParams<{ memberId?: string }>();
  const { member: currentMember, updateMember } = useSession();
  const { data: members, isLoading, error } = useManagedMembers();
  const updateProfile = useUpdateManagedMember();
  const updateStatus = useUpdateManagedMemberStatus();
  const [filter, setFilter] = useState<MemberFilter>('active');
  const [editing, setEditing] = useState<ManagedMember | null>(null);
  const openedMemberId = useRef<string | null>(null);

  useEffect(() => {
    if (!params.memberId || !members || openedMemberId.current === params.memberId) {
      return;
    }
    const selected = members.find((item) => item.id === params.memberId);
    if (selected) {
      openedMemberId.current = params.memberId;
      setEditing(selected);
    }
  }, [members, params.memberId]);

  const visibleMembers =
    members?.filter((item) => filter === 'all' || !item.disabledAt) ?? [];

  const canManageTarget = (target: ManagedMember) =>
    !(
      target.role === 'owner' &&
      currentMember?.role !== 'owner'
    );

  const setMemberStatus = (target: ManagedMember) => {
    const enabled = Boolean(target.disabledAt);
    const verb = enabled ? '恢复' : '停用';
    Alert.alert(`${verb}家庭访问`, `${verb}「${target.name}」的家庭访问？`, [
      { text: '取消', style: 'cancel' },
      {
        text: verb,
        style: enabled ? 'default' : 'destructive',
        onPress: () =>
          updateStatus.mutate(
            { id: target.id, enabled },
            {
              onError: (requestError) =>
                Alert.alert(
                  `${verb}失败`,
                  requestError instanceof Error ? requestError.message : '请稍后再试',
                ),
            },
          ),
      },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <PageContainer
        maxWidth={1040}
        style={[styles.page, desktop && styles.pageDesktop]}
      >
        <View style={styles.header}>
          {!desktop ? (
            <PressableScale
              accessibilityLabel="返回"
              haptic={false}
              onPress={() => router.replace('/profile')}
              style={styles.backButton}
            >
              <ArrowLeft color={c.label} size={21} />
            </PressableScale>
          ) : null}
          <View style={{ flex: 1 }}>
            <Text style={[desktop ? t.largeTitle : t.title1, { color: c.label }]}>家庭成员</Text>
            <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 3 }]}>成员档案与家庭权限</Text>
          </View>
          <View style={[styles.countBox, { backgroundColor: c.tintSoft }]}>
            <UsersRound color={c.tint} size={18} />
            <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]}>
              {members?.filter((item) => !item.disabledAt).length ?? 0}
            </Text>
          </View>
        </View>

        <View style={styles.filterRow}>
          <Segmented<MemberFilter>
            options={[
              { label: '在家成员', value: 'active' },
              { label: '全部成员', value: 'all' },
            ]}
            value={filter}
            onChange={setFilter}
          />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {isLoading ? (
            <Text style={[t.subhead, styles.loading, { color: c.secondaryLabel }]}>正在加载...</Text>
          ) : error ? (
            <EmptyState emoji="!" title="成员加载失败" hint={error.message} />
          ) : visibleMembers.length === 0 ? (
            <EmptyState emoji="👤" title="暂无成员" />
          ) : (
            <View style={styles.memberGrid}>
              {visibleMembers.map((item) => {
                const manageable = canManageTarget(item);
                const isSelf = item.id === currentMember?.id;
                return (
                  <Card
                    key={item.id}
                    style={[styles.memberCard, desktop && styles.memberCardDesktop]}
                  >
                    <View style={styles.memberTopRow}>
                      <View style={[styles.avatar, { backgroundColor: c.orangeSoft }]}>
                        <Text style={styles.avatarEmoji}>{item.avatarEmoji}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={styles.nameRow}>
                          <Text
                            numberOfLines={1}
                            style={[t.headline, { color: c.label, flexShrink: 1 }]}
                          >
                            {item.name}
                          </Text>
                          {isSelf ? (
                            <Text style={[styles.selfLabel, { color: c.tint }]}>我</Text>
                          ) : null}
                        </View>
                        <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>
                          {memberRoleLabel(item.role)}
                          {item.prefersCooking ? ' · 经常掌勺' : ''}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.status,
                          { backgroundColor: item.disabledAt ? c.redSoft : c.greenSoft },
                        ]}
                      >
                        <Text
                          style={[
                            t.caption,
                            { color: item.disabledAt ? c.red : c.green, fontWeight: '700' },
                          ]}
                        >
                          {item.disabledAt ? '已停用' : '可登录'}
                        </Text>
                      </View>
                    </View>

                    <View style={[styles.accountRow, { borderTopColor: c.separator }]}>
                      {item.role === 'owner' ? (
                        <ShieldCheck color={c.tint} size={17} />
                      ) : (
                        <UserRoundCheck color={c.secondaryLabel} size={17} />
                      )}
                      <Text style={[t.footnote, { color: c.secondaryLabel, flex: 1 }]}>
                        {item.account ? `账号：${item.account.loginName}` : '未关联登录账号'}
                      </Text>
                      {item.account?.disabledAt ? (
                        <Text style={[t.caption, { color: c.red }]}>账号已停用</Text>
                      ) : null}
                    </View>

                    {manageable ? (
                      <View style={[styles.actions, { borderTopColor: c.separator }]}>
                        <PressableScale
                          accessibilityLabel={`编辑${item.name}`}
                          haptic={false}
                          onPress={() => setEditing(item)}
                          style={styles.actionButton}
                        >
                          <Pencil color={c.tint} size={17} />
                          <Text style={[t.subhead, { color: c.tint, fontWeight: '600' }]}>编辑</Text>
                        </PressableScale>
                        {!isSelf ? (
                          <PressableScale
                            accessibilityLabel={`${item.disabledAt ? '恢复' : '停用'}${item.name}`}
                            disabled={updateStatus.isPending}
                            haptic={false}
                            onPress={() => setMemberStatus(item)}
                            style={styles.actionButton}
                          >
                            {item.disabledAt ? (
                              <Power color={c.green} size={17} />
                            ) : (
                              <PowerOff color={c.red} size={17} />
                            )}
                            <Text
                              style={[
                                t.subhead,
                                {
                                  color: item.disabledAt ? c.green : c.red,
                                  fontWeight: '600',
                                },
                              ]}
                            >
                              {item.disabledAt ? '恢复' : '停用'}
                            </Text>
                          </PressableScale>
                        ) : null}
                      </View>
                    ) : null}
                  </Card>
                );
              })}
            </View>
          )}
        </ScrollView>
      </PageContainer>

      <MemberEditor
        currentMemberId={currentMember?.id}
        currentRole={currentMember?.role}
        member={editing}
        loading={updateProfile.isPending}
        onClose={() => setEditing(null)}
        onSave={(input) => {
          if (!editing) return;
          updateProfile.mutate(
            { id: editing.id, ...input },
            {
              onSuccess: (updated) => {
                if (updated.id === currentMember?.id) {
                  void updateMember(updated);
                }
                setEditing(null);
              },
              onError: (requestError) =>
                Alert.alert(
                  '保存失败',
                  requestError instanceof Error ? requestError.message : '请稍后再试',
                ),
            },
          );
        }}
      />
    </SafeAreaView>
  );
}

function MemberEditor({
  member,
  currentMemberId,
  currentRole,
  loading,
  onClose,
  onSave,
}: {
  member: ManagedMember | null;
  currentMemberId?: string;
  currentRole?: MemberRole;
  loading: boolean;
  onClose: () => void;
  onSave: (input: {
    name: string;
    avatarEmoji: string;
    role: MemberRole;
    prefersCooking: boolean;
  }) => void;
}) {
  const c = useTheme();
  const [name, setName] = useState('');
  const [avatarEmoji, setAvatarEmoji] = useState('');
  const [role, setRole] = useState<MemberRole>('member');
  const [prefersCooking, setPrefersCooking] = useState(false);

  useEffect(() => {
    if (!member) return;
    setName(member.name);
    setAvatarEmoji(member.avatarEmoji);
    setRole(member.role);
    setPrefersCooking(member.prefersCooking);
  }, [member]);

  const canChangeRole = member?.id !== currentMemberId;
  const roleOptions =
    currentRole === 'owner'
      ? [
          { label: '管理员', value: 'owner' as const },
          { label: '协管', value: 'admin' as const },
          { label: '成员', value: 'member' as const },
        ]
      : [
          { label: '协管', value: 'admin' as const },
          { label: '成员', value: 'member' as const },
        ];

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={Boolean(member)}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { backgroundColor: c.card, borderColor: c.separator }]}>
          <View style={styles.modalHeader}>
            <Text style={[t.title2, { color: c.label }]}>编辑成员</Text>
            <PressableScale haptic={false} onPress={onClose} style={styles.closeButton}>
              <Text style={[t.subhead, { color: c.tint }]}>取消</Text>
            </PressableScale>
          </View>

          <View style={styles.identityInputs}>
            <View style={{ width: 76 }}>
              <Field
                label="头像"
                value={avatarEmoji}
                onChangeText={setAvatarEmoji}
                maxLength={4}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="成员名称" value={name} onChangeText={setName} maxLength={64} />
            </View>
          </View>

          <View style={{ gap: 7 }}>
            <Text style={[t.footnote, { color: c.secondaryLabel }]}>家庭角色</Text>
            {canChangeRole ? (
              <Segmented<MemberRole> options={roleOptions} value={role} onChange={setRole} />
            ) : (
              <View style={[styles.readonlyRole, { backgroundColor: c.fill }]}>
                <Text style={[t.subhead, { color: c.label }]}>{memberRoleLabel(role)}</Text>
              </View>
            )}
          </View>

          <View style={[styles.preferenceRow, { borderColor: c.separator }]}>
            <Text style={[t.body, { color: c.label, flex: 1 }]}>经常掌勺</Text>
            <Switch
              accessibilityLabel="经常掌勺"
              onValueChange={setPrefersCooking}
              trackColor={{ false: c.fillStrong, true: c.tintSoft }}
              thumbColor={prefersCooking ? c.tint : c.tertiaryLabel}
              value={prefersCooking}
            />
          </View>

          <PrimaryButton
            disabled={!name.trim() || !avatarEmoji.trim()}
            loading={loading}
            onPress={() =>
              onSave({
                name: name.trim(),
                avatarEmoji: avatarEmoji.trim(),
                role,
                prefersCooking,
              })
            }
            title="保存成员资料"
          />
        </View>
      </View>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChangeText,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  maxLength: number;
}) {
  const c = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[t.footnote, { color: c.secondaryLabel }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        maxLength={maxLength}
        onChangeText={onChangeText}
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
  page: { flex: 1, paddingTop: 8 },
  pageDesktop: { paddingTop: 22 },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10 },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  countBox: {
    height: 38,
    minWidth: 58,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  filterRow: { width: '100%', maxWidth: 360, marginTop: 14 },
  scrollContent: { paddingTop: 14, paddingBottom: 32 },
  loading: { textAlign: 'center', paddingTop: 48 },
  memberGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  memberCard: { width: '100%', minWidth: 0 },
  memberCardDesktop: { width: '49%', flexGrow: 1 },
  memberTopRow: { minHeight: 76, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 25 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  selfLabel: { fontSize: 12, fontWeight: '700' },
  status: { borderRadius: radius.full, paddingHorizontal: 9, paddingVertical: 5 },
  accountRow: {
    minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actions: { minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row' },
  actionButton: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.32)', justifyContent: 'flex-end' },
  modalSheet: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    padding: 20,
    paddingBottom: 28,
    gap: 18,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  closeButton: { minWidth: 52, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  identityInputs: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  readonlyRole: { minHeight: 40, borderRadius: radius.sm, justifyContent: 'center', paddingHorizontal: 12 },
  preferenceRow: {
    minHeight: 58,
    borderWidth: 1,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
});
