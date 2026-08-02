import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  DatabaseBackup,
  HardDrive,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  XCircle,
} from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PageContainer, useDesktopLayout } from '../../components/app-shell';
import { Card, ConfirmDialog, EmptyState, PrimaryButton, Segmented } from '../../components/ui';
import {
  type BackupPolicyInput,
  useBackupDashboard,
  useCancelBackupRun,
  useQueueBackupRun,
  useQueueRestoreDrill,
  useUpdateBackupPolicy,
} from '../../lib/queries';
import { useSession } from '../../lib/session';
import { radius, type as t, useTheme } from '../../lib/theme';
import type {
  BackupCapacityStatus,
  BackupRun,
  BackupRunKind,
  BackupRunStatus,
  BackupScheduleFrequency,
} from '../../lib/types';

type PolicyForm = {
  scheduleEnabled: boolean;
  frequency: BackupScheduleFrequency;
  weeklyDay: number;
  scheduledHour: string;
  scheduledMinute: string;
  retentionDays: string;
  retentionCount: string;
  capacityWarningPercent: string;
  capacityCriticalPercent: string;
  restoreDrillEnabled: boolean;
  restoreDrillDay: string;
  restoreDrillHour: string;
};

type Confirmation =
  | { kind: 'backup' }
  | { kind: 'capacity_check' }
  | { kind: 'restore_drill'; run: BackupRun }
  | { kind: 'cancel'; run: BackupRun };

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const RUN_KIND_LABELS: Record<BackupRunKind, string> = {
  backup: '完整备份',
  restore_drill: '恢复演练',
  capacity_check: '容量检查',
};
const RUN_STATUS_LABELS: Record<BackupRunStatus, string> = {
  queued: '等待执行',
  running: '执行中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
};

function formFromPolicy(policy: NonNullable<ReturnType<typeof useBackupDashboard>['data']>['policy']): PolicyForm {
  return {
    scheduleEnabled: policy.scheduleEnabled,
    frequency: policy.frequency,
    weeklyDay: policy.weeklyDay ?? 1,
    scheduledHour: String(policy.scheduledHour),
    scheduledMinute: String(policy.scheduledMinute),
    retentionDays: String(policy.retentionDays),
    retentionCount: String(policy.retentionCount),
    capacityWarningPercent: String(policy.capacityWarningPercent),
    capacityCriticalPercent: String(policy.capacityCriticalPercent),
    restoreDrillEnabled: policy.restoreDrillEnabled,
    restoreDrillDay: String(policy.restoreDrillDay),
    restoreDrillHour: String(policy.restoreDrillHour),
  };
}

function formatTime(value: string | null) {
  if (!value) return '尚未记录';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function formatBytes(value: string | null) {
  if (!value) return '0 B';
  const bytes = Number(value);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function statusColor(
  status: BackupRunStatus,
  colors: ReturnType<typeof useTheme>,
) {
  if (status === 'succeeded') return { color: colors.green, bg: colors.greenSoft };
  if (status === 'failed') return { color: colors.red, bg: colors.redSoft };
  if (status === 'running') return { color: colors.blue, bg: colors.blueSoft };
  if (status === 'queued') return { color: colors.orange, bg: colors.orangeSoft };
  return { color: colors.secondaryLabel, bg: colors.fill };
}

function capacityCopy(status: BackupCapacityStatus) {
  if (status === 'critical') return '严重不足';
  if (status === 'warning') return '接近上限';
  if (status === 'ok') return '正常';
  return '待检查';
}

function NumericField({
  label,
  onChange,
  suffix,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  suffix?: string;
  value: string;
}) {
  const c = useTheme();
  return (
    <View style={styles.numericField}>
      <Text style={[t.caption, { color: c.secondaryLabel, fontWeight: '600' }]}>{label}</Text>
      <View style={[styles.numericInputRow, { backgroundColor: c.fill }]}>
        <TextInput
          accessibilityLabel={label}
          inputMode="numeric"
          maxLength={4}
          onChangeText={(next) => onChange(next.replace(/\D/g, ''))}
          selectTextOnFocus
          style={[t.body, styles.numericInput, { color: c.label }]}
          value={value}
        />
        {suffix ? <Text style={[t.footnote, { color: c.secondaryLabel }]}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

function StatusBadge({ status }: { status: BackupRunStatus }) {
  const c = useTheme();
  const palette = statusColor(status, c);
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[t.caption, { color: palette.color, fontWeight: '700' }]}>
        {RUN_STATUS_LABELS[status]}
      </Text>
    </View>
  );
}

export default function SystemBackupsScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const { member } = useSession();
  const admin = member?.role === 'owner' || member?.role === 'admin';
  const dashboard = useBackupDashboard(admin);
  const savePolicy = useUpdateBackupPolicy();
  const queueRun = useQueueBackupRun();
  const queueRestore = useQueueRestoreDrill();
  const cancelRun = useCancelBackupRun();
  const [form, setForm] = useState<PolicyForm | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    if (dashboard.data?.policy) setForm(formFromPolicy(dashboard.data.policy));
  }, [dashboard.data?.policy]);

  const storagePercent = useMemo(() => {
    const total = Number(dashboard.data?.policy.storageTotalBytes ?? 0);
    const used = Number(dashboard.data?.policy.storageUsedBytes ?? 0);
    return total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  }, [dashboard.data?.policy.storageTotalBytes, dashboard.data?.policy.storageUsedBytes]);

  const pending = queueRun.isPending || queueRestore.isPending || cancelRun.isPending;

  const submitPolicy = async () => {
    if (!form) return;
    const input: BackupPolicyInput = {
      scheduleEnabled: form.scheduleEnabled,
      frequency: form.frequency,
      weeklyDay: form.frequency === 'weekly' ? form.weeklyDay : null,
      scheduledHour: Number(form.scheduledHour),
      scheduledMinute: Number(form.scheduledMinute),
      retentionDays: Number(form.retentionDays),
      retentionCount: Number(form.retentionCount),
      capacityWarningPercent: Number(form.capacityWarningPercent),
      capacityCriticalPercent: Number(form.capacityCriticalPercent),
      restoreDrillEnabled: form.restoreDrillEnabled,
      restoreDrillDay: Number(form.restoreDrillDay),
      restoreDrillHour: Number(form.restoreDrillHour),
    };
    if (
      !Number.isInteger(input.scheduledHour) || input.scheduledHour < 0 || input.scheduledHour > 23 ||
      !Number.isInteger(input.scheduledMinute) || input.scheduledMinute < 0 || input.scheduledMinute > 59 ||
      !Number.isInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > 3650 ||
      !Number.isInteger(input.retentionCount) || input.retentionCount < 1 || input.retentionCount > 365 ||
      !Number.isInteger(input.capacityWarningPercent) ||
      !Number.isInteger(input.capacityCriticalPercent) ||
      input.capacityWarningPercent < 1 ||
      input.capacityCriticalPercent > 99 ||
      input.capacityWarningPercent >= input.capacityCriticalPercent ||
      !Number.isInteger(input.restoreDrillDay) || input.restoreDrillDay < 1 || input.restoreDrillDay > 28 ||
      !Number.isInteger(input.restoreDrillHour) || input.restoreDrillHour < 0 || input.restoreDrillHour > 23
    ) {
      setMessage({ text: '请检查时间、保留范围和容量阈值', error: true });
      return;
    }
    try {
      await savePolicy.mutateAsync(input);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMessage({ text: '备份策略已保存', error: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : '策略保存失败', error: true });
    }
  };

  const completeConfirmation = async () => {
    if (!confirmation) return;
    try {
      if (confirmation.kind === 'backup' || confirmation.kind === 'capacity_check') {
        await queueRun.mutateAsync(confirmation.kind);
      } else if (confirmation.kind === 'restore_drill') {
        await queueRestore.mutateAsync(confirmation.run.id);
      } else {
        await cancelRun.mutateAsync(confirmation.run.id);
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMessage({
        text: confirmation.kind === 'cancel' ? '排队任务已取消' : '操作已加入执行队列',
        error: false,
      });
      setConfirmation(null);
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : '操作失败', error: true });
    }
  };

  if (!admin) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
        <PageContainer style={styles.denied}>
          <EmptyState emoji="!" title="无权访问系统备份" />
          <PrimaryButton onPress={() => router.replace('/profile')} title="返回我的" />
        </PageContainer>
      </SafeAreaView>
    );
  }

  if (dashboard.isLoading || !form) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.tint} style={styles.loader} />
      </SafeAreaView>
    );
  }

  if (dashboard.error || !dashboard.data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
        <PageContainer style={styles.denied}>
          <EmptyState emoji="!" title="备份状态加载失败" hint={dashboard.error?.message} />
          <PrimaryButton onPress={() => void dashboard.refetch()} title="重新加载" />
        </PageContainer>
      </SafeAreaView>
    );
  }

  const { policy, runs, workerOnline, activeRun } = dashboard.data;
  const latestBackup = runs.find((run) => run.artifactAvailable);
  const confirmationCopy = confirmationText(confirmation);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <PageContainer style={[styles.page, desktop && styles.pageDesktop]}>
        <View style={styles.header}>
          {!desktop ? (
            <Pressable
              accessibilityLabel="返回"
              accessibilityRole="button"
              onPress={() => router.back()}
              style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? c.fill : 'transparent' }]}
            >
              <ArrowLeft color={c.label} size={22} />
            </Pressable>
          ) : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[desktop ? t.title1 : t.title2, { color: c.label }]}>系统备份</Text>
            <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>家庭数据保护与恢复状态</Text>
          </View>
          <Pressable
            accessibilityLabel="刷新备份状态"
            accessibilityRole="button"
            onPress={() => void dashboard.refetch()}
            style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? c.fill : 'transparent' }]}
          >
            <RefreshCw color={c.secondaryLabel} size={20} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {message ? (
            <View style={[styles.message, { backgroundColor: message.error ? c.redSoft : c.greenSoft }]}>
              {message.error ? <XCircle color={c.red} size={18} /> : <CheckCircle2 color={c.green} size={18} />}
              <Text style={[t.footnote, { color: message.error ? c.red : c.green, fontWeight: '600', flex: 1 }]}>{message.text}</Text>
            </View>
          ) : null}

          <View style={[styles.statusGrid, desktop && styles.statusGridDesktop]}>
            <View style={[styles.statusCell, { backgroundColor: c.card, borderColor: c.separator }]}>
              <Server color={workerOnline ? c.green : c.red} size={20} />
              <Text style={[t.caption, { color: c.secondaryLabel }]}>备份 worker</Text>
              <Text style={[t.headline, { color: workerOnline ? c.green : c.red }]}>{workerOnline ? '在线' : '离线'}</Text>
              <Text style={[t.caption, { color: c.tertiaryLabel }]}>{formatTime(policy.workerLastSeenAt)}</Text>
            </View>
            <View style={[styles.statusCell, { backgroundColor: c.card, borderColor: c.separator }]}>
              <HardDrive color={policy.capacityStatus === 'critical' ? c.red : policy.capacityStatus === 'warning' ? c.orange : c.blue} size={20} />
              <Text style={[t.caption, { color: c.secondaryLabel }]}>备份存储</Text>
              <Text style={[t.headline, { color: c.label }]}>{capacityCopy(policy.capacityStatus)} · {storagePercent}%</Text>
              <Text style={[t.caption, { color: c.tertiaryLabel }]}>{formatBytes(policy.storageAvailableBytes)} 可用</Text>
            </View>
            <View style={[styles.statusCell, { backgroundColor: c.card, borderColor: c.separator }]}>
              <DatabaseBackup color={c.tint} size={20} />
              <Text style={[t.caption, { color: c.secondaryLabel }]}>最近备份</Text>
              <Text style={[t.headline, { color: c.label }]}>{latestBackup ? formatBytes(latestBackup.totalBytes) : '暂无'}</Text>
              <Text style={[t.caption, { color: c.tertiaryLabel }]}>{latestBackup ? formatTime(latestBackup.finishedAt) : '尚未完成备份'}</Text>
            </View>
          </View>

          {policy.capacityStatus === 'warning' || policy.capacityStatus === 'critical' ? (
            <View style={[styles.alert, { backgroundColor: policy.capacityStatus === 'critical' ? c.redSoft : c.orangeSoft }]}>
              <AlertTriangle color={policy.capacityStatus === 'critical' ? c.red : c.orange} size={20} />
              <Text style={[t.footnote, { color: policy.capacityStatus === 'critical' ? c.red : c.orange, flex: 1, fontWeight: '600' }]}>备份存储已使用 {storagePercent}%，请清理旧文件或扩容。</Text>
            </View>
          ) : null}

          <View style={styles.actionRow}>
            <PrimaryButton
              disabled={Boolean(activeRun) || !workerOnline}
              icon={<DatabaseBackup color="#FFF" size={18} />}
              onPress={() => setConfirmation({ kind: 'backup' })}
              style={styles.actionButton}
              title="立即备份"
            />
            <Pressable
              accessibilityRole="button"
              disabled={Boolean(activeRun) || !workerOnline}
              onPress={() => setConfirmation({ kind: 'capacity_check' })}
              style={({ pressed }) => [styles.secondaryAction, { backgroundColor: pressed ? c.fillStrong : c.fill, opacity: activeRun || !workerOnline ? 0.45 : 1 }]}
            >
              <HardDrive color={c.tint} size={18} />
              <Text style={[t.headline, { color: c.tint }]}>检查容量</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!latestBackup || Boolean(activeRun) || !workerOnline}
              onPress={() => latestBackup && setConfirmation({ kind: 'restore_drill', run: latestBackup })}
              style={({ pressed }) => [styles.secondaryAction, { backgroundColor: pressed ? c.fillStrong : c.fill, opacity: !latestBackup || activeRun || !workerOnline ? 0.45 : 1 }]}
            >
              <RotateCcw color={c.tint} size={18} />
              <Text style={[t.headline, { color: c.tint }]}>恢复演练</Text>
            </Pressable>
          </View>

          {activeRun ? (
            <Card style={styles.activeRun}>
              <View style={[styles.activeIcon, { backgroundColor: c.blueSoft }]}>
                <Play color={c.blue} size={19} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[t.headline, { color: c.label }]}>{RUN_KIND_LABELS[activeRun.kind]} · {RUN_STATUS_LABELS[activeRun.status]}</Text>
                <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>{activeRun.status === 'running' ? `最近心跳 ${formatTime(activeRun.heartbeatAt)}` : `计划时间 ${formatTime(activeRun.scheduledFor)}`}</Text>
              </View>
              {activeRun.status === 'queued' ? (
                <Pressable accessibilityRole="button" onPress={() => setConfirmation({ kind: 'cancel', run: activeRun })} style={[styles.smallButton, { backgroundColor: c.redSoft }]}>
                  <Text style={[t.footnote, { color: c.red, fontWeight: '700' }]}>取消</Text>
                </Pressable>
              ) : null}
            </Card>
          ) : null}

          <View style={styles.sectionTitle}>
            <CalendarClock color={c.secondaryLabel} size={18} />
            <Text style={[t.headline, { color: c.label }]}>计划与保留策略</Text>
          </View>
          <Card style={styles.policyCard}>
            <View style={[styles.switchRow, { borderBottomColor: c.separator }]}>
              <View style={{ flex: 1 }}>
                <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]}>自动完整备份</Text>
                <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>下次：{formatTime(policy.nextBackupAt)}</Text>
              </View>
              <Switch
                accessibilityLabel="自动完整备份"
                onValueChange={(value) => setForm((current) => current && { ...current, scheduleEnabled: value })}
                trackColor={{ false: c.fillStrong, true: c.tintSoft }}
                thumbColor={form.scheduleEnabled ? c.tint : c.tertiaryLabel}
                value={form.scheduleEnabled}
              />
            </View>
            <View style={styles.policyBody}>
              <Segmented
                onChange={(value) => setForm((current) => current && { ...current, frequency: value })}
                options={[{ label: '每天', value: 'daily' }, { label: '每周', value: 'weekly' }]}
                value={form.frequency}
              />
              {form.frequency === 'weekly' ? (
                <View style={styles.weekdays}>
                  {WEEKDAYS.map((day, index) => {
                    const selected = form.weeklyDay === index;
                    return (
                      <Pressable
                        accessibilityLabel={`星期${day}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        key={day}
                        onPress={() => setForm((current) => current && { ...current, weeklyDay: index })}
                        style={[styles.dayButton, { backgroundColor: selected ? c.tint : c.fill }]}
                      >
                        <Text style={[t.footnote, { color: selected ? '#FFF' : c.label, fontWeight: '700' }]}>{day}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              <View style={styles.fieldGrid}>
                <NumericField label="执行小时" onChange={(value) => setForm((current) => current && { ...current, scheduledHour: value })} suffix="时" value={form.scheduledHour} />
                <NumericField label="执行分钟" onChange={(value) => setForm((current) => current && { ...current, scheduledMinute: value })} suffix="分" value={form.scheduledMinute} />
                <NumericField label="保留天数" onChange={(value) => setForm((current) => current && { ...current, retentionDays: value })} suffix="天" value={form.retentionDays} />
                <NumericField label="保留份数" onChange={(value) => setForm((current) => current && { ...current, retentionCount: value })} suffix="份" value={form.retentionCount} />
                <NumericField label="容量警告" onChange={(value) => setForm((current) => current && { ...current, capacityWarningPercent: value })} suffix="%" value={form.capacityWarningPercent} />
                <NumericField label="容量严重" onChange={(value) => setForm((current) => current && { ...current, capacityCriticalPercent: value })} suffix="%" value={form.capacityCriticalPercent} />
              </View>
            </View>
            <View style={[styles.switchRow, styles.restoreSwitch, { borderTopColor: c.separator }]}>
              <View style={{ flex: 1 }}>
                <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]}>每月恢复演练</Text>
                <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>下次：{formatTime(policy.nextRestoreDrillAt)}</Text>
              </View>
              <Switch
                accessibilityLabel="每月恢复演练"
                onValueChange={(value) => setForm((current) => current && { ...current, restoreDrillEnabled: value })}
                trackColor={{ false: c.fillStrong, true: c.tintSoft }}
                thumbColor={form.restoreDrillEnabled ? c.tint : c.tertiaryLabel}
                value={form.restoreDrillEnabled}
              />
            </View>
            <View style={[styles.fieldGrid, styles.restoreFields]}>
              <NumericField label="每月日期" onChange={(value) => setForm((current) => current && { ...current, restoreDrillDay: value })} suffix="日" value={form.restoreDrillDay} />
              <NumericField label="演练小时" onChange={(value) => setForm((current) => current && { ...current, restoreDrillHour: value })} suffix="时" value={form.restoreDrillHour} />
            </View>
            <View style={styles.saveRow}>
              <PrimaryButton
                icon={<Save color="#FFF" size={18} />}
                loading={savePolicy.isPending}
                onPress={() => void submitPolicy()}
                style={styles.saveButton}
                title="保存策略"
              />
            </View>
          </Card>

          <View style={styles.sectionTitle}>
            <DatabaseBackup color={c.secondaryLabel} size={18} />
            <Text style={[t.headline, { color: c.label }]}>运行历史</Text>
          </View>
          {runs.length ? (
            <Card style={styles.historyCard}>
              {runs.map((run, index) => (
                <View key={run.id} style={[styles.historyRow, index < runs.length - 1 && { borderBottomColor: c.separator, borderBottomWidth: StyleSheet.hairlineWidth }]}>
                  <View style={[styles.historyIcon, { backgroundColor: run.status === 'failed' ? c.redSoft : c.fill }]}>
                    {run.status === 'failed' ? <XCircle color={c.red} size={18} /> : run.kind === 'restore_drill' ? <RotateCcw color={c.tint} size={18} /> : <DatabaseBackup color={c.tint} size={18} />}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={styles.historyTitle}>
                      <Text style={[t.subhead, { color: c.label, fontWeight: '700', flexShrink: 1 }]}>{RUN_KIND_LABELS[run.kind]}</Text>
                      <StatusBadge status={run.status} />
                    </View>
                    <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 4 }]}>{formatTime(run.finishedAt ?? run.createdAt)} · {run.trigger === 'manual' ? run.requestedBy?.name ?? '管理员' : '自动计划'}</Text>
                    {run.errorMessage || run.resultSummary ? <Text numberOfLines={2} style={[t.caption, { color: run.errorMessage ? c.red : c.tertiaryLabel, marginTop: 3 }]}>{run.errorMessage ?? run.resultSummary}</Text> : null}
                    {run.kind === 'backup' && run.status === 'succeeded' ? <Text style={[t.caption, { color: c.tertiaryLabel, marginTop: 3 }]}>{formatBytes(run.totalBytes)} · {run.retained ? '已保留' : '已按策略清理'} · 校验{run.checksumVerified ? '通过' : '待确认'}</Text> : null}
                  </View>
                  {run.artifactAvailable && !activeRun ? (
                    <Pressable accessibilityLabel="使用此备份恢复演练" accessibilityRole="button" onPress={() => setConfirmation({ kind: 'restore_drill', run })} style={[styles.squareButton, { backgroundColor: c.fill }]}>
                      <RotateCcw color={c.tint} size={17} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </Card>
          ) : (
            <EmptyState emoji="-" title="还没有备份运行记录" />
          )}
        </ScrollView>
      </PageContainer>
      <ConfirmDialog
        confirmLabel={confirmationCopy.confirmLabel}
        destructive={confirmation?.kind === 'cancel'}
        loading={pending}
        message={confirmationCopy.message}
        onCancel={() => { if (!pending) setConfirmation(null); }}
        onConfirm={() => void completeConfirmation()}
        title={confirmationCopy.title}
        visible={Boolean(confirmation)}
      />
    </SafeAreaView>
  );
}

function confirmationText(confirmation: Confirmation | null) {
  if (!confirmation) return { title: '', message: '', confirmLabel: '确认' };
  if (confirmation.kind === 'backup') {
    return {
      title: '立即创建完整备份？',
      message: '预计生成数据库转储、上传文件归档、版本清单和 SHA-256 校验和。完成后自动执行保留策略和容量检查。',
      confirmLabel: '加入备份队列',
    };
  }
  if (confirmation.kind === 'capacity_check') {
    return {
      title: '检查备份存储容量？',
      message: 'worker 将刷新总容量、已用空间和告警状态，不会修改现有备份。',
      confirmLabel: '开始检查',
    };
  }
  if (confirmation.kind === 'restore_drill') {
    return {
      title: '执行隔离恢复演练？',
      message: `将使用 ${formatTime(confirmation.run.finishedAt)} 的备份创建临时数据库，验证校验和、迁移和附件后清理临时环境，不会覆盖运行中的数据库。`,
      confirmLabel: '开始演练',
    };
  }
  return {
    title: '取消排队任务？',
    message: '仅取消尚未被 worker 领取的任务，运行历史会保留。',
    confirmLabel: '确认取消',
  };
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  page: { flex: 1, paddingTop: 12 },
  pageDesktop: { paddingTop: 28 },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconButton: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  content: { paddingTop: 14, paddingBottom: 48, gap: 14 },
  loader: { marginTop: 100 },
  denied: { flex: 1, maxWidth: 420, alignItems: 'stretch', justifyContent: 'center', gap: 18 },
  message: { minHeight: 42, borderRadius: radius.sm, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusGrid: { flexDirection: 'column', gap: 10 },
  statusGridDesktop: { flexDirection: 'row' },
  statusCell: { flex: 1, minHeight: 114, borderWidth: 1, borderRadius: radius.md, padding: 14, justifyContent: 'space-between', gap: 5 },
  alert: { minHeight: 48, borderRadius: radius.sm, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionButton: { minWidth: 150, flexGrow: 1 },
  secondaryAction: { minHeight: 48, minWidth: 150, flexGrow: 1, borderRadius: radius.sm, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  activeRun: { minHeight: 72, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  activeIcon: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  smallButton: { minHeight: 34, borderRadius: radius.sm, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { marginTop: 6, minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 7 },
  policyCard: { overflow: 'hidden' },
  switchRow: { minHeight: 70, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  restoreSwitch: { borderBottomWidth: 0, borderTopWidth: StyleSheet.hairlineWidth },
  policyBody: { padding: 16, gap: 14 },
  weekdays: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  dayButton: { width: 38, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  restoreFields: { paddingHorizontal: 16, paddingBottom: 16 },
  numericField: { minWidth: 132, flexGrow: 1, gap: 6 },
  numericInputRow: { height: 44, borderRadius: radius.sm, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 5 },
  numericInput: { flex: 1, minWidth: 40, paddingVertical: 0 },
  saveRow: { paddingHorizontal: 16, paddingBottom: 16, alignItems: 'flex-end' },
  saveButton: { width: '100%', maxWidth: 260 },
  historyCard: { overflow: 'hidden' },
  historyRow: { minHeight: 88, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 11 },
  historyIcon: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  historyTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { minHeight: 24, borderRadius: radius.full, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  squareButton: { width: 38, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
});
