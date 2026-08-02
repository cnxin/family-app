import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import {
  Check,
  CircleDollarSign,
  Gift,
  History,
  Pencil,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  X,
  XCircle,
} from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
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
  ConfirmDialog,
  EmptyState,
  PrimaryButton,
  Segmented,
} from '../../components/ui';
import {
  useAdjustPoints,
  useCancelRedemption,
  useDecideRedemption,
  usePointsAccounts,
  usePointsLedger,
  useRedeemReward,
  useReversePointsLedger,
  useReverseRedemption,
  useRewardRedemptions,
  useRewards,
  useUpsertReward,
} from '../../lib/queries';
import { useSession } from '../../lib/session';
import { radius, type as t, useTheme } from '../../lib/theme';
import type {
  PointsAccount,
  PointsLedger,
  Reward,
  RewardRedemption,
  RewardRedemptionStatus,
} from '../../lib/types';

type ViewMode = 'rewards' | 'redemptions' | 'ledger';
type RedemptionFilter = 'all' | RewardRedemptionStatus;
type Confirmation =
  | { kind: 'redeem'; reward: Reward }
  | { kind: 'approve'; redemption: RewardRedemption }
  | { kind: 'reject'; redemption: RewardRedemption }
  | { kind: 'cancel'; redemption: RewardRedemption }
  | { kind: 'reverse-redemption'; redemption: RewardRedemption }
  | { kind: 'reverse-ledger'; entry: PointsLedger };

const STATUS_LABELS: Record<RewardRedemptionStatus, string> = {
  pending: '待确认',
  approved: '已确认',
  rejected: '未通过',
  cancelled: '已取消',
  reversed: '已撤销',
};

function idempotencyKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function Sheet({
  children,
  onClose,
  subtitle,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  subtitle: string;
  title: string;
}) {
  const c = useTheme();
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible>
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="关闭窗口"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: c.card, borderColor: c.separator }]}
        >
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.title2, { color: c.label }]}>{title}</Text>
              <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>
                {subtitle}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="关闭"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.iconButton,
                { backgroundColor: pressed ? c.fill : 'transparent' },
              ]}
            >
              <X color={c.secondaryLabel} size={20} />
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function RewardForm({
  entry,
  onClose,
}: {
  entry: Reward | null;
  onClose: () => void;
}) {
  const c = useTheme();
  const save = useUpsertReward();
  const [name, setName] = useState(entry?.name ?? '');
  const [description, setDescription] = useState(entry?.description ?? '');
  const [cost, setCost] = useState(String(entry?.cost ?? 20));
  const [isActive, setIsActive] = useState(entry?.isActive ?? true);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    const points = Number(cost);
    if (!name.trim()) {
      setMessage('请填写奖励名称');
      return;
    }
    if (!Number.isInteger(points) || points < 1 || points > 1_000_000) {
      setMessage('兑换积分需要是 1 到 1000000 的整数');
      return;
    }
    setMessage(null);
    try {
      await save.mutateAsync({
        id: entry?.id,
        name: name.trim(),
        description: description.trim() || null,
        cost: points,
        ...(entry ? { isActive } : {}),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    }
  };

  return (
    <Sheet
      onClose={onClose}
      subtitle="成员申请时先扣除积分，审批未通过会自动退回"
      title={entry ? '编辑家庭奖励' : '新增家庭奖励'}
    >
      <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
        <View style={styles.field}>
          <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>奖励名称</Text>
          <TextInput
            accessibilityLabel="奖励名称"
            maxLength={120}
            onChangeText={setName}
            placeholder="比如：选择周末电影"
            placeholderTextColor={c.tertiaryLabel}
            style={[t.body, styles.input, { backgroundColor: c.fill, color: c.label }]}
            value={name}
          />
        </View>
        <View style={styles.field}>
          <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>所需积分</Text>
          <TextInput
            accessibilityLabel="奖励所需积分"
            inputMode="numeric"
            maxLength={7}
            onChangeText={setCost}
            placeholder="20"
            placeholderTextColor={c.tertiaryLabel}
            style={[t.body, styles.input, { backgroundColor: c.fill, color: c.label }]}
            value={cost}
          />
        </View>
        <View style={styles.field}>
          <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>说明</Text>
          <TextInput
            accessibilityLabel="奖励说明"
            maxLength={1000}
            multiline
            onChangeText={setDescription}
            placeholder="兑换范围、履约方式或注意事项"
            placeholderTextColor={c.tertiaryLabel}
            style={[t.body, styles.noteInput, { backgroundColor: c.fill, color: c.label }]}
            textAlignVertical="top"
            value={description}
          />
        </View>
        {entry ? (
          <View style={[styles.switchRow, { borderColor: c.separator }]}>
            <View style={{ flex: 1 }}>
              <Text style={[t.subhead, { color: c.label, fontWeight: '600' }]}>允许继续兑换</Text>
              <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>停用后保留已有兑换历史</Text>
            </View>
            <Switch
              accessibilityLabel="奖励是否启用"
              onValueChange={setIsActive}
              trackColor={{ false: c.fillStrong, true: c.tintSoft }}
              thumbColor={isActive ? c.tint : c.tertiaryLabel}
              value={isActive}
            />
          </View>
        ) : null}
        {message ? <Text style={[t.footnote, { color: c.red }]}>{message}</Text> : null}
        <View style={styles.formActions}>
          <Pressable
            accessibilityRole="button"
            disabled={save.isPending}
            onPress={onClose}
            style={[styles.secondaryButton, { backgroundColor: c.fill }]}
          >
            <Text style={[t.headline, { color: c.label }]}>取消</Text>
          </Pressable>
          <PrimaryButton
            loading={save.isPending}
            onPress={() => void submit()}
            style={{ flex: 1 }}
            title="保存奖励"
          />
        </View>
      </ScrollView>
    </Sheet>
  );
}

function AdjustmentForm({
  accounts,
  onClose,
}: {
  accounts: PointsAccount[];
  onClose: () => void;
}) {
  const c = useTheme();
  const adjust = useAdjustPoints();
  const [memberId, setMemberId] = useState(accounts[0]?.memberId ?? '');
  const [delta, setDelta] = useState('10');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const account = accounts.find((item) => item.memberId === memberId);
  const amount = Number(delta);
  const expected = account && Number.isInteger(amount) ? account.balance + amount : null;

  const submit = async () => {
    if (!account) {
      setMessage('请选择家庭成员');
      return;
    }
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000) {
      setMessage('积分变化需要是 -1000000 到 1000000 的非零整数');
      return;
    }
    if ((expected ?? -1) < 0) {
      setMessage('调整后积分不能小于 0');
      return;
    }
    setMessage(null);
    try {
      await adjust.mutateAsync({
        memberId: account.memberId,
        delta: amount,
        note: note.trim() || null,
        idempotencyKey: idempotencyKey(),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '积分调整失败');
    }
  };

  return (
    <Sheet onClose={onClose} subtitle="变化会写入不可变流水，可通过反向流水纠正" title="调整成员积分">
      <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
        <View style={styles.field}>
          <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>家庭成员</Text>
          <View style={styles.memberOptions}>
            {accounts.map((item) => {
              const active = item.memberId === memberId;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  key={item.id}
                  onPress={() => setMemberId(item.memberId)}
                  style={[
                    styles.memberOption,
                    {
                      backgroundColor: active ? c.tintSoft : c.card,
                      borderColor: active ? c.tint : c.separator,
                    },
                  ]}
                >
                  <Text>{item.member.avatarEmoji}</Text>
                  <Text style={[t.footnote, { color: active ? c.tint : c.label, fontWeight: '600' }]}>
                    {item.member.name} · {item.balance}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={styles.field}>
          <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>变化量</Text>
          <TextInput
            accessibilityLabel="积分变化量"
            inputMode="numeric"
            maxLength={8}
            onChangeText={setDelta}
            placeholder="正数发放，负数扣减"
            placeholderTextColor={c.tertiaryLabel}
            style={[t.body, styles.input, { backgroundColor: c.fill, color: c.label }]}
            value={delta}
          />
        </View>
        <View style={[styles.preview, { backgroundColor: c.orangeSoft }]}>
          <Text style={[t.caption, { color: c.secondaryLabel }]}>预计变化</Text>
          <Text style={[t.title2, { color: c.orange }]}>
            {account?.balance ?? 0} {Number.isFinite(amount) && amount >= 0 ? '+' : '-'} {Number.isFinite(amount) ? Math.abs(amount) : 0} = {expected ?? '--'}
          </Text>
        </View>
        <View style={styles.field}>
          <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>原因</Text>
          <TextInput
            accessibilityLabel="积分调整原因"
            maxLength={500}
            onChangeText={setNote}
            placeholder="比如：主动完成额外家务"
            placeholderTextColor={c.tertiaryLabel}
            style={[t.body, styles.input, { backgroundColor: c.fill, color: c.label }]}
            value={note}
          />
        </View>
        {message ? <Text style={[t.footnote, { color: c.red }]}>{message}</Text> : null}
        <View style={styles.formActions}>
          <Pressable accessibilityRole="button" onPress={onClose} style={[styles.secondaryButton, { backgroundColor: c.fill }]}>
            <Text style={[t.headline, { color: c.label }]}>取消</Text>
          </Pressable>
          <PrimaryButton loading={adjust.isPending} onPress={() => void submit()} style={{ flex: 1 }} title="确认变动" />
        </View>
      </ScrollView>
    </Sheet>
  );
}

export default function PointsScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const params = useLocalSearchParams<{ redemptionId?: string | string[] }>();
  const focusedRedemptionId = firstParam(params.redemptionId);
  const { member } = useSession();
  const admin = member?.role === 'owner' || member?.role === 'admin';
  const [mode, setMode] = useState<ViewMode>(focusedRedemptionId ? 'redemptions' : 'rewards');
  const [redemptionFilter, setRedemptionFilter] = useState<RedemptionFilter>('all');
  const [rewardForm, setRewardForm] = useState<Reward | 'new' | null>(null);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const { data: accounts, isLoading: accountsLoading } = usePointsAccounts();
  const { data: rewards, isLoading: rewardsLoading, error: rewardsError } = useRewards(admin);
  const { data: ledger, isLoading: ledgerLoading, error: ledgerError } = usePointsLedger();
  const { data: redemptions, isLoading: redemptionsLoading, error: redemptionsError } = useRewardRedemptions();
  const redeem = useRedeemReward();
  const decide = useDecideRedemption();
  const cancel = useCancelRedemption();
  const reverseRedemption = useReverseRedemption();
  const reverseLedger = useReversePointsLedger();
  const ownAccount = accounts?.find((item) => item.memberId === member?.id);
  const reversedIds = useMemo(
    () => new Set((ledger ?? []).map((entry) => entry.reversesLedgerId).filter(Boolean)),
    [ledger],
  );
  const visibleRedemptions = (redemptions ?? []).filter(
    (item) => redemptionFilter === 'all' || item.status === redemptionFilter,
  );

  useEffect(() => {
    if (focusedRedemptionId) setMode('redemptions');
  }, [focusedRedemptionId]);

  const fail = (title: string, error: unknown) => {
    Alert.alert(title, error instanceof Error ? error.message : '请稍后再试');
  };

  const completeConfirmation = async () => {
    if (!confirmation) return;
    try {
      if (confirmation.kind === 'redeem') {
        await redeem.mutateAsync({
          rewardId: confirmation.reward.id,
          idempotencyKey: idempotencyKey(),
        });
      } else if (confirmation.kind === 'approve' || confirmation.kind === 'reject') {
        await decide.mutateAsync({
          id: confirmation.redemption.id,
          decision: confirmation.kind === 'approve' ? 'approve' : 'reject',
          idempotencyKey: idempotencyKey(),
        });
      } else if (confirmation.kind === 'cancel') {
        await cancel.mutateAsync({ id: confirmation.redemption.id, idempotencyKey: idempotencyKey() });
      } else if (confirmation.kind === 'reverse-redemption') {
        await reverseRedemption.mutateAsync({ id: confirmation.redemption.id, idempotencyKey: idempotencyKey() });
      } else {
        await reverseLedger.mutateAsync({ id: confirmation.entry.id, idempotencyKey: idempotencyKey() });
      }
      setConfirmation(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      fail('操作失败', error);
    }
  };

  const pendingMutation =
    redeem.isPending ||
    decide.isPending ||
    cancel.isPending ||
    reverseRedemption.isPending ||
    reverseLedger.isPending;

  const confirmationCopy = confirmationMessage(confirmation, ownAccount, accounts ?? []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <PageContainer maxWidth={1120} style={[styles.page, desktop && styles.pageDesktop]}>
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[desktop ? t.largeTitle : t.title1, { color: c.label }]}>积分奖励</Text>
            <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 4 }]}>家庭贡献、兑换与审批记录</Text>
          </View>
          {admin ? (
            <View style={styles.headerActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setAdjustmentOpen(true)}
                style={({ pressed }) => [styles.headerSecondary, { backgroundColor: pressed ? c.fillStrong : c.fill }]}
              >
                <SlidersHorizontal color={c.tint} size={17} />
                <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>调整积分</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setRewardForm('new')}
                style={({ pressed }) => [styles.headerPrimary, { backgroundColor: pressed ? c.green : c.tint }]}
              >
                <Plus color="#FFFFFF" size={17} />
                <Text style={[t.footnote, { color: '#FFFFFF', fontWeight: '700' }]}>新增奖励</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={styles.balanceBand}>
          <View style={[styles.ownBalance, { backgroundColor: c.orangeSoft }]}>
            <CircleDollarSign color={c.orange} size={25} />
            <View>
              <Text style={[t.caption, { color: c.secondaryLabel }]}>我的可用积分</Text>
              <Text style={[t.largeTitle, { color: c.orange }]}>{accountsLoading ? '--' : ownAccount?.balance ?? 0}</Text>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.accountStrip}>
            {(accounts ?? []).map((account) => (
              <View key={account.id} style={[styles.accountChip, { backgroundColor: c.card, borderColor: c.separator }]}>
                <Text style={styles.accountEmoji}>{account.member.avatarEmoji}</Text>
                <View>
                  <Text style={[t.caption, { color: c.secondaryLabel }]}>{account.member.name}</Text>
                  <Text style={[t.headline, { color: c.label }]}>{account.balance}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>

        <View style={styles.toolbar}>
          <Segmented<ViewMode>
            onChange={setMode}
            options={[
              { label: '家庭奖励', value: 'rewards' },
              { label: admin ? '兑换审批' : '我的兑换', value: 'redemptions' },
              { label: '积分流水', value: 'ledger' },
            ]}
            value={mode}
          />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {mode === 'rewards' ? (
            rewardsLoading ? (
              <ActivityIndicator color={c.tint} style={styles.loader} />
            ) : rewardsError ? (
              <EmptyState emoji="!" title="奖励加载失败" hint={rewardsError.message} />
            ) : rewards?.length ? (
              <View style={styles.rewardGrid}>
                {rewards.map((reward) => (
                  <Card key={reward.id} style={[styles.rewardCard, desktop && styles.rewardCardDesktop, !reward.isActive && { opacity: 0.65 }]}>
                    <View style={styles.rewardTop}>
                      <View style={[styles.rewardIcon, { backgroundColor: c.orangeSoft }]}>
                        <Gift color={c.orange} size={21} />
                      </View>
                      <View style={[styles.costBadge, { backgroundColor: c.fill }]}>
                        <CircleDollarSign color={c.orange} size={14} />
                        <Text style={[t.footnote, { color: c.orange, fontWeight: '700' }]}>{reward.cost}</Text>
                      </View>
                    </View>
                    <Text style={[t.headline, { color: c.label, marginTop: 12 }]}>{reward.name}</Text>
                    <Text numberOfLines={3} style={[t.footnote, styles.rewardDescription, { color: c.secondaryLabel }]}>
                      {reward.description ?? '家庭管理员确认后履约'}
                    </Text>
                    {!reward.isActive ? <Text style={[t.caption, { color: c.red, marginTop: 8 }]}>已停用</Text> : null}
                    <View style={styles.rewardActions}>
                      {reward.isActive ? (
                        <Pressable
                          accessibilityRole="button"
                          disabled={(ownAccount?.balance ?? 0) < reward.cost}
                          onPress={() => setConfirmation({ kind: 'redeem', reward })}
                          style={[
                            styles.redeemButton,
                            {
                              backgroundColor: c.tint,
                              opacity: (ownAccount?.balance ?? 0) < reward.cost ? 0.4 : 1,
                            },
                          ]}
                        >
                          <Gift color="#FFFFFF" size={15} />
                          <Text style={[t.footnote, { color: '#FFFFFF', fontWeight: '700' }]}>申请兑换</Text>
                        </Pressable>
                      ) : null}
                      {admin ? (
                        <Pressable
                          accessibilityLabel={`编辑${reward.name}`}
                          accessibilityRole="button"
                          onPress={() => setRewardForm(reward)}
                          style={[styles.squareButton, { backgroundColor: c.fill }]}
                        >
                          <Pencil color={c.secondaryLabel} size={16} />
                        </Pressable>
                      ) : null}
                    </View>
                  </Card>
                ))}
              </View>
            ) : (
              <EmptyState emoji="*" title="还没有家庭奖励" />
            )
          ) : null}

          {mode === 'redemptions' ? (
            <>
              <View style={styles.filterBar}>
                <Segmented<RedemptionFilter>
                  onChange={setRedemptionFilter}
                  options={[
                    { label: '全部', value: 'all' },
                    { label: '待确认', value: 'pending' },
                    { label: '已完成', value: 'approved' },
                  ]}
                  value={redemptionFilter}
                />
              </View>
              {redemptionsLoading ? (
                <ActivityIndicator color={c.tint} style={styles.loader} />
              ) : redemptionsError ? (
                <EmptyState emoji="!" title="兑换记录加载失败" hint={redemptionsError.message} />
              ) : visibleRedemptions.length ? (
                <Card style={styles.listCard}>
                  {visibleRedemptions.map((redemption, index) => (
                    <View
                      key={redemption.id}
                      style={[
                        styles.listRow,
                        index < visibleRedemptions.length - 1 && { borderBottomColor: c.separator, borderBottomWidth: StyleSheet.hairlineWidth },
                        redemption.id === focusedRedemptionId && { backgroundColor: c.tintSoft },
                      ]}
                    >
                      <View style={[styles.rowIcon, { backgroundColor: c.orangeSoft }]}>
                        <Gift color={c.orange} size={18} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={styles.rowTitleLine}>
                          <Text numberOfLines={1} style={[t.subhead, { color: c.label, fontWeight: '700', flexShrink: 1 }]}>{redemption.rewardName}</Text>
                          <StatusBadge status={redemption.status} />
                        </View>
                        <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 4 }]}>
                          {redemption.member.avatarEmoji} {redemption.member.name} · {redemption.cost} 积分 · {timeLabel(redemption.createdAt)}
                        </Text>
                        {redemption.decisionNote ? <Text numberOfLines={2} style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>{redemption.decisionNote}</Text> : null}
                      </View>
                      <View style={styles.rowActions}>
                        {admin && redemption.status === 'pending' ? (
                          <>
                            <Pressable accessibilityLabel="确认兑换" accessibilityRole="button" onPress={() => setConfirmation({ kind: 'approve', redemption })} style={[styles.squareButton, { backgroundColor: c.greenSoft }]}>
                              <Check color={c.green} size={17} />
                            </Pressable>
                            <Pressable accessibilityLabel="拒绝兑换" accessibilityRole="button" onPress={() => setConfirmation({ kind: 'reject', redemption })} style={[styles.squareButton, { backgroundColor: c.redSoft }]}>
                              <XCircle color={c.red} size={17} />
                            </Pressable>
                          </>
                        ) : null}
                        {!admin && redemption.status === 'pending' ? (
                          <Pressable accessibilityLabel="取消兑换" accessibilityRole="button" onPress={() => setConfirmation({ kind: 'cancel', redemption })} style={[styles.squareButton, { backgroundColor: c.fill }]}>
                            <X color={c.secondaryLabel} size={17} />
                          </Pressable>
                        ) : null}
                        {admin && redemption.status === 'approved' ? (
                          <Pressable accessibilityLabel="撤销兑换" accessibilityRole="button" onPress={() => setConfirmation({ kind: 'reverse-redemption', redemption })} style={[styles.squareButton, { backgroundColor: c.fill }]}>
                            <RotateCcw color={c.tint} size={17} />
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </Card>
              ) : (
                <EmptyState emoji="-" title="没有匹配的兑换记录" />
              )}
            </>
          ) : null}

          {mode === 'ledger' ? (
            ledgerLoading ? (
              <ActivityIndicator color={c.tint} style={styles.loader} />
            ) : ledgerError ? (
              <EmptyState emoji="!" title="积分流水加载失败" hint={ledgerError.message} />
            ) : ledger?.length ? (
              <Card style={styles.listCard}>
                {ledger.map((entry, index) => {
                  const reversed = reversedIds.has(entry.id);
                  const reversible = admin && entry.sourceType === 'manual' && entry.type !== 'reversal' && !reversed;
                  return (
                    <View key={entry.id} style={[styles.listRow, index < ledger.length - 1 && { borderBottomColor: c.separator, borderBottomWidth: StyleSheet.hairlineWidth }]}>
                      <View style={[styles.rowIcon, { backgroundColor: entry.delta > 0 ? c.greenSoft : c.redSoft }]}>
                        <History color={entry.delta > 0 ? c.green : c.red} size={18} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]}>
                          {entry.member.avatarEmoji} {entry.member.name} · {entry.delta > 0 ? '+' : ''}{entry.delta}
                        </Text>
                        <Text numberOfLines={2} style={[t.caption, { color: c.secondaryLabel, marginTop: 4 }]}>
                          {entry.pointsBefore} → {entry.pointsAfter} · {entry.note ?? ledgerTypeLabel(entry.type)} · {timeLabel(entry.createdAt)}
                        </Text>
                        {reversed ? <Text style={[t.caption, { color: c.tertiaryLabel, marginTop: 3 }]}>已通过反向流水撤销</Text> : null}
                      </View>
                      {reversible ? (
                        <Pressable accessibilityLabel="撤销积分流水" accessibilityRole="button" onPress={() => setConfirmation({ kind: 'reverse-ledger', entry })} style={[styles.squareButton, { backgroundColor: c.fill }]}>
                          <RotateCcw color={c.tint} size={17} />
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </Card>
            ) : (
              <EmptyState emoji="-" title="还没有积分流水" />
            )
          ) : null}
        </ScrollView>
      </PageContainer>

      {rewardForm ? <RewardForm entry={rewardForm === 'new' ? null : rewardForm} onClose={() => setRewardForm(null)} /> : null}
      {adjustmentOpen ? <AdjustmentForm accounts={accounts ?? []} onClose={() => setAdjustmentOpen(false)} /> : null}
      <ConfirmDialog
        confirmLabel={confirmationCopy.confirmLabel}
        destructive={confirmationCopy.destructive}
        loading={pendingMutation}
        message={confirmationCopy.message}
        onCancel={() => {
          if (!pendingMutation) setConfirmation(null);
        }}
        onConfirm={() => void completeConfirmation()}
        title={confirmationCopy.title}
        visible={Boolean(confirmation)}
      />
    </SafeAreaView>
  );
}

function StatusBadge({ status }: { status: RewardRedemptionStatus }) {
  const c = useTheme();
  const active = status === 'approved';
  const pending = status === 'pending';
  return (
    <View style={[styles.statusBadge, { backgroundColor: pending ? c.orangeSoft : active ? c.greenSoft : c.fill }]}>
      <Text style={[t.caption, { color: pending ? c.orange : active ? c.green : c.secondaryLabel, fontWeight: '700' }]}>
        {STATUS_LABELS[status]}
      </Text>
    </View>
  );
}

function ledgerTypeLabel(type: PointsLedger['type']) {
  if (type === 'award') return '积分发放';
  if (type === 'adjustment') return '积分调整';
  if (type === 'redemption') return '奖励兑换';
  return '反向流水';
}

function confirmationMessage(
  confirmation: Confirmation | null,
  ownAccount: PointsAccount | undefined,
  accounts: PointsAccount[],
) {
  if (!confirmation) {
    return { title: '', message: '', confirmLabel: '确认', destructive: false };
  }
  if (confirmation.kind === 'redeem') {
    const before = ownAccount?.balance ?? 0;
    return {
      title: `兑换「${confirmation.reward.name}」？`,
      message: `预计积分变化：${before} - ${confirmation.reward.cost} = ${before - confirmation.reward.cost}。提交后先扣分，未通过时自动退回。`,
      confirmLabel: '确认兑换',
      destructive: false,
    };
  }
  if (confirmation.kind === 'approve') {
    return {
      title: '确认这笔兑换？',
      message: `「${confirmation.redemption.rewardName}」已在申请时扣除 ${confirmation.redemption.cost} 积分。确认后进入已完成状态，不会再次扣分。`,
      confirmLabel: '确认通过',
      destructive: false,
    };
  }
  if (confirmation.kind === 'reverse-ledger') {
    const account = accounts.find((item) => item.memberId === confirmation.entry.memberId);
    const before = account?.balance ?? 0;
    const delta = -confirmation.entry.delta;
    return {
      title: '撤销这笔积分流水？',
      message: `将写入反向流水。预计积分变化：${before} ${delta >= 0 ? '+' : '-'} ${Math.abs(delta)} = ${before + delta}，原流水会永久保留。`,
      confirmLabel: '确认撤销',
      destructive: true,
    };
  }
  const account = accounts.find((item) => item.memberId === confirmation.redemption.memberId);
  const before = account?.balance ?? 0;
  if (confirmation.kind === 'reject' || confirmation.kind === 'cancel' || confirmation.kind === 'reverse-redemption') {
    return {
      title: confirmation.kind === 'reject' ? '拒绝这笔兑换？' : confirmation.kind === 'cancel' ? '取消这笔兑换？' : '撤销已确认兑换？',
      message: `将写入反向流水并退回积分。预计变化：${before} + ${confirmation.redemption.cost} = ${before + confirmation.redemption.cost}，历史记录不会删除。`,
      confirmLabel: confirmation.kind === 'reject' ? '拒绝并退回' : '撤销并退回',
      destructive: true,
    };
  }
  return { title: '', message: '', confirmLabel: '确认', destructive: false };
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingTop: 18 },
  pageDesktop: { paddingTop: 30 },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  headerSecondary: { minHeight: 40, borderRadius: radius.sm, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  headerPrimary: { minHeight: 40, borderRadius: radius.sm, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  balanceBand: { marginTop: 20, flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  ownBalance: { width: 190, minHeight: 88, borderRadius: radius.md, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  accountStrip: { gap: 8, paddingRight: 4 },
  accountChip: { minWidth: 118, minHeight: 88, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9 },
  accountEmoji: { fontSize: 24 },
  toolbar: { marginTop: 18, maxWidth: 520 },
  scrollContent: { paddingTop: 18, paddingBottom: 42 },
  loader: { marginTop: 80 },
  rewardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  rewardCard: { width: '100%', minHeight: 220, padding: 16 },
  rewardCardDesktop: { width: '48.9%' },
  rewardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rewardIcon: { width: 42, height: 42, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  costBadge: { minHeight: 30, borderRadius: radius.full, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 4 },
  rewardDescription: { marginTop: 6, lineHeight: 19, flex: 1 },
  rewardActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 14 },
  redeemButton: { minHeight: 38, borderRadius: radius.sm, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  squareButton: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  filterBar: { maxWidth: 380, marginBottom: 12 },
  listCard: { overflow: 'hidden' },
  listRow: { minHeight: 82, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 11 },
  rowIcon: { width: 38, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowActions: { flexDirection: 'row', gap: 5 },
  statusBadge: { minHeight: 24, borderRadius: radius.full, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  overlay: { flex: 1, backgroundColor: 'rgba(17, 25, 20, 0.42)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  sheet: { width: '100%', maxWidth: 560, maxHeight: '94%', borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  sheetHeader: { minHeight: 76, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  iconButton: { width: 38, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  formContent: { paddingHorizontal: 20, paddingBottom: 20, gap: 16 },
  field: { gap: 7 },
  fieldLabel: { fontWeight: '600' },
  input: { height: 46, borderRadius: radius.sm, paddingHorizontal: 12 },
  noteInput: { minHeight: 86, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 },
  switchRow: { minHeight: 62, borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  memberOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  memberOption: { minHeight: 38, borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6 },
  preview: { minHeight: 76, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'center', gap: 4 },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  secondaryButton: { flex: 1, minHeight: 48, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
});
