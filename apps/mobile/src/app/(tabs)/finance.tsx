import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Landmark,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Sparkles,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react-native';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
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
  AdaptiveDialog,
  Card,
  ConfirmDialog,
  EmptyState,
  PrimaryButton,
  PressableScale,
  Segmented,
} from '../../components/ui';
import {
  type FinanceTransactionInput,
  useCreateFinanceAccount,
  useCreateFinanceCategory,
  useCreateFinanceTransaction,
  useDeleteFinanceBudget,
  useFinanceAccounts,
  useFinanceCategories,
  useFinanceSummary,
  useFinanceTransactions,
  useReverseFinanceTransaction,
  useUpdateFinanceAccount,
  useUpdateFinanceCategory,
  useUpsertFinanceBudget,
} from '../../lib/queries';
import { useSession } from '../../lib/session';
import { radius, type as t, useTheme } from '../../lib/theme';
import type {
  FinanceAccount,
  FinanceAccountType,
  FinanceBudget,
  FinanceCategory,
  FinanceTransaction,
  FinanceTransactionType,
} from '../../lib/types';

type FinanceView = 'overview' | 'ledger' | 'budgets' | 'accounts';
type LedgerFilter = 'all' | Exclude<FinanceTransactionType, 'reversal'>;
type TransactionMode = Exclude<FinanceTransactionType, 'reversal'>;

const ACCOUNT_LABELS: Record<FinanceAccountType, string> = {
  cash: '现金',
  bank: '银行卡',
  alipay: '支付宝',
  wechat: '微信',
  other: '其他',
};

function monthNow() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
}

function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function adjacentMonth(month: string, delta: number) {
  const [year, monthValue] = month.split('-').map(Number);
  const value = new Date(Date.UTC(year, monthValue - 1 + delta, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month: string) {
  const [year, monthValue] = month.split('-');
  return `${year} 年 ${Number(monthValue)} 月`;
}

function currency(value: number, signed = false) {
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}¥${Math.abs(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function ModalHeader({ title, subtitle, onClose }: {
  title: string;
  subtitle: string;
  onClose: () => void;
}) {
  const c = useTheme();
  return (
    <View style={[styles.dialogHeader, { borderBottomColor: c.separator }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[t.title2, { color: c.label }]}>{title}</Text>
        <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>{subtitle}</Text>
      </View>
      <PressableScale accessibilityLabel="关闭" haptic={false} onPress={onClose} style={styles.iconButton}>
        <X color={c.secondaryLabel} size={20} />
      </PressableScale>
    </View>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  return <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>{children}</Text>;
}

function ChoiceChip({ active, label, onPress }: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choiceChip,
        {
          backgroundColor: active ? c.tintSoft : pressed ? c.fill : c.card,
          borderColor: active ? c.tint : c.separator,
        },
      ]}
    >
      <Text style={[t.footnote, { color: active ? c.tint : c.label, fontWeight: '600' }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function TransactionDialog({ accounts, categories, onClose }: {
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  onClose: () => void;
}) {
  const c = useTheme();
  const create = useCreateFinanceTransaction();
  const [mode, setMode] = React.useState<TransactionMode>('expense');
  const [amountValue, setAmountValue] = React.useState('');
  const [accountId, setAccountId] = React.useState(accounts[0]?.id ?? '');
  const [toAccountId, setToAccountId] = React.useState(accounts[1]?.id ?? '');
  const matchingCategories = categories.filter((entry) => entry.kind === mode);
  const [categoryId, setCategoryId] = React.useState(
    categories.find((entry) => entry.kind === 'expense')?.id ?? '',
  );
  const [title, setTitle] = React.useState('');
  const [occurredOn, setOccurredOn] = React.useState(today());
  const [note, setNote] = React.useState('');
  const [message, setMessage] = React.useState<string | null>(null);

  const changeMode = (next: TransactionMode) => {
    setMode(next);
    if (next !== 'transfer') {
      setCategoryId(categories.find((entry) => entry.kind === next)?.id ?? '');
    }
  };

  const submit = async () => {
    const parsed = Number(amountValue);
    if (!Number.isFinite(parsed) || parsed <= 0 || Math.round(parsed * 100) !== parsed * 100) {
      setMessage('请输入大于 0 且最多两位小数的金额');
      return;
    }
    if (!accountId) {
      setMessage('请选择账户');
      return;
    }
    if (mode === 'transfer' && (!toAccountId || toAccountId === accountId)) {
      setMessage('请选择不同的转入账户');
      return;
    }
    if (mode !== 'transfer' && !categoryId) {
      setMessage('请选择收支分类');
      return;
    }
    if (!title.trim()) {
      setMessage('请填写这笔账的名称');
      return;
    }
    setMessage(null);
    const input: FinanceTransactionInput = {
      type: mode,
      amount: parsed,
      accountId,
      toAccountId: mode === 'transfer' ? toAccountId : null,
      categoryId: mode === 'transfer' ? null : categoryId,
      title: title.trim(),
      note: note.trim() || null,
      occurredOn,
    };
    try {
      await create.mutateAsync(input);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '记账失败');
    }
  };

  return (
    <AdaptiveDialog accessibilityLabel="记一笔" maxWidth={620} onClose={onClose} visible>
      <ModalHeader
        onClose={onClose}
        subtitle="确认后写入不可变家庭流水，误记可由管理员撤销"
        title="记一笔"
      />
      <ScrollView contentContainerStyle={styles.dialogContent} keyboardShouldPersistTaps="handled">
        <Segmented<TransactionMode>
          onChange={changeMode}
          options={[
            { label: '支出', value: 'expense' },
            { label: '收入', value: 'income' },
            { label: '转账', value: 'transfer' },
          ]}
          value={mode}
        />
        <View style={styles.field}>
          <FieldLabel>金额</FieldLabel>
          <View style={[styles.amountInputWrap, { backgroundColor: c.fill, borderColor: c.separator }]}>
            <Text style={[t.title2, { color: c.secondaryLabel }]}>¥</Text>
            <TextInput
              accessibilityLabel="金额"
              autoFocus
              inputMode="decimal"
              maxLength={15}
              onChangeText={setAmountValue}
              placeholder="0.00"
              placeholderTextColor={c.tertiaryLabel}
              style={[styles.amountInput, { color: c.label }]}
              value={amountValue}
            />
          </View>
        </View>
        <View style={styles.field}>
          <FieldLabel>{mode === 'transfer' ? '转出账户' : '账户'}</FieldLabel>
          <View style={styles.choiceWrap}>
            {accounts.filter((entry) => entry.isActive).map((entry) => (
              <ChoiceChip
                active={accountId === entry.id}
                key={entry.id}
                label={`${entry.name} ${currency(entry.balance)}`}
                onPress={() => setAccountId(entry.id)}
              />
            ))}
          </View>
        </View>
        {mode === 'transfer' ? (
          <View style={styles.field}>
            <FieldLabel>转入账户</FieldLabel>
            <View style={styles.choiceWrap}>
              {accounts.filter((entry) => entry.isActive && entry.id !== accountId).map((entry) => (
                <ChoiceChip
                  active={toAccountId === entry.id}
                  key={entry.id}
                  label={entry.name}
                  onPress={() => setToAccountId(entry.id)}
                />
              ))}
            </View>
          </View>
        ) : (
          <View style={styles.field}>
            <FieldLabel>{mode === 'expense' ? '支出分类' : '收入分类'}</FieldLabel>
            <View style={styles.choiceWrap}>
              {matchingCategories.map((entry) => (
                <ChoiceChip
                  active={categoryId === entry.id}
                  key={entry.id}
                  label={entry.name}
                  onPress={() => setCategoryId(entry.id)}
                />
              ))}
            </View>
          </View>
        )}
        <View style={styles.field}>
          <FieldLabel>名称</FieldLabel>
          <TextInput
            accessibilityLabel="账目名称"
            maxLength={120}
            onChangeText={setTitle}
            placeholder={mode === 'expense' ? '比如：周末聚餐' : mode === 'income' ? '比如：工资' : '比如：转入日常账户'}
            placeholderTextColor={c.tertiaryLabel}
            style={[styles.input, { backgroundColor: c.fill, color: c.label }]}
            value={title}
          />
        </View>
        <View style={styles.twoColumns}>
          <View style={[styles.field, styles.flexField]}>
            <FieldLabel>日期</FieldLabel>
            <TextInput
              accessibilityLabel="记账日期"
              maxLength={10}
              onChangeText={setOccurredOn}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={c.tertiaryLabel}
              style={[styles.input, { backgroundColor: c.fill, color: c.label }]}
              value={occurredOn}
            />
          </View>
          <View style={[styles.field, styles.flexField]}>
            <FieldLabel>备注（可选）</FieldLabel>
            <TextInput
              accessibilityLabel="备注"
              maxLength={1000}
              onChangeText={setNote}
              placeholder="补充说明"
              placeholderTextColor={c.tertiaryLabel}
              style={[styles.input, { backgroundColor: c.fill, color: c.label }]}
              value={note}
            />
          </View>
        </View>
        {message ? <Text style={[t.footnote, { color: c.red }]}>{message}</Text> : null}
        <PrimaryButton
          icon={<ReceiptText color="#FFFFFF" size={18} />}
          loading={create.isPending}
          onPress={() => void submit()}
          title="确认记账"
        />
      </ScrollView>
    </AdaptiveDialog>
  );
}

function AccountDialog({ entry, onClose }: {
  entry: FinanceAccount | null;
  onClose: () => void;
}) {
  const c = useTheme();
  const create = useCreateFinanceAccount();
  const update = useUpdateFinanceAccount();
  const [name, setName] = React.useState(entry?.name ?? '');
  const [type, setType] = React.useState<FinanceAccountType>(entry?.type ?? 'bank');
  const [openingBalance, setOpeningBalance] = React.useState('0');
  const [message, setMessage] = React.useState<string | null>(null);
  const submit = async () => {
    const opening = Number(openingBalance);
    if (!name.trim()) return setMessage('请填写账户名称');
    if (!entry && (!Number.isFinite(opening) || Math.round(opening * 100) !== opening * 100)) {
      return setMessage('初始余额最多保留两位小数');
    }
    try {
      if (entry) {
        await update.mutateAsync({ id: entry.id, name: name.trim(), type, expectedVersion: entry.version });
      } else {
        await create.mutateAsync({ name: name.trim(), type, openingBalance: opening });
      }
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '账户保存失败');
    }
  };
  return (
    <AdaptiveDialog accessibilityLabel={entry ? '编辑账户' : '新增账户'} maxWidth={520} onClose={onClose} visible>
      <ModalHeader onClose={onClose} subtitle="账户余额由初始余额和不可变流水共同计算" title={entry ? '编辑账户' : '新增账户'} />
      <View style={styles.dialogContent}>
        <View style={styles.field}>
          <FieldLabel>账户名称</FieldLabel>
          <TextInput accessibilityLabel="账户名称" maxLength={80} onChangeText={setName} placeholder="比如：日常银行卡" placeholderTextColor={c.tertiaryLabel} style={[styles.input, { backgroundColor: c.fill, color: c.label }]} value={name} />
        </View>
        <View style={styles.field}>
          <FieldLabel>账户类型</FieldLabel>
          <View style={styles.choiceWrap}>
            {(Object.keys(ACCOUNT_LABELS) as FinanceAccountType[]).map((value) => (
              <ChoiceChip active={type === value} key={value} label={ACCOUNT_LABELS[value]} onPress={() => setType(value)} />
            ))}
          </View>
        </View>
        {!entry ? (
          <View style={styles.field}>
            <FieldLabel>初始余额</FieldLabel>
            <TextInput accessibilityLabel="初始余额" inputMode="decimal" onChangeText={setOpeningBalance} placeholder="0.00" placeholderTextColor={c.tertiaryLabel} style={[styles.input, { backgroundColor: c.fill, color: c.label }]} value={openingBalance} />
          </View>
        ) : null}
        {message ? <Text style={[t.footnote, { color: c.red }]}>{message}</Text> : null}
        <PrimaryButton loading={create.isPending || update.isPending} onPress={() => void submit()} title="保存账户" />
      </View>
    </AdaptiveDialog>
  );
}

function CategoryDialog({ onClose }: { onClose: () => void }) {
  const c = useTheme();
  const save = useCreateFinanceCategory();
  const [kind, setKind] = React.useState<'expense' | 'income'>('expense');
  const [name, setName] = React.useState('');
  const [message, setMessage] = React.useState<string | null>(null);
  const submit = async () => {
    if (!name.trim()) return setMessage('请填写分类名称');
    try {
      await save.mutateAsync({ name: name.trim(), kind });
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '分类保存失败');
    }
  };
  return (
    <AdaptiveDialog accessibilityLabel="新增分类" maxWidth={480} onClose={onClose} visible>
      <ModalHeader onClose={onClose} subtitle="自定义分类会和系统分类一起用于记账和预算" title="新增分类" />
      <View style={styles.dialogContent}>
        <Segmented<'expense' | 'income'> onChange={setKind} options={[{ label: '支出分类', value: 'expense' }, { label: '收入分类', value: 'income' }]} value={kind} />
        <View style={styles.field}>
          <FieldLabel>分类名称</FieldLabel>
          <TextInput accessibilityLabel="分类名称" autoFocus maxLength={80} onChangeText={setName} placeholder="比如：宠物" placeholderTextColor={c.tertiaryLabel} style={[styles.input, { backgroundColor: c.fill, color: c.label }]} value={name} />
        </View>
        {message ? <Text style={[t.footnote, { color: c.red }]}>{message}</Text> : null}
        <PrimaryButton loading={save.isPending} onPress={() => void submit()} title="保存分类" />
      </View>
    </AdaptiveDialog>
  );
}

function BudgetDialog({ category, entry, month, onClose }: {
  category: FinanceCategory;
  entry: FinanceBudget | null;
  month: string;
  onClose: () => void;
}) {
  const c = useTheme();
  const save = useUpsertFinanceBudget();
  const [value, setValue] = React.useState(String(entry?.amount ?? ''));
  const [message, setMessage] = React.useState<string | null>(null);
  const submit = async () => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || Math.round(parsed * 100) !== parsed * 100) {
      return setMessage('预算金额不能小于 0，最多保留两位小数');
    }
    try {
      await save.mutateAsync({ categoryId: category.id, month, amount: parsed, expectedVersion: entry?.version });
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '预算保存失败');
    }
  };
  return (
    <AdaptiveDialog accessibilityLabel="设置预算" maxWidth={460} onClose={onClose} visible>
      <ModalHeader onClose={onClose} subtitle={`${monthLabel(month)} · ${category.name}`} title="设置分类预算" />
      <View style={styles.dialogContent}>
        <View style={styles.field}>
          <FieldLabel>预算金额</FieldLabel>
          <TextInput accessibilityLabel="预算金额" autoFocus inputMode="decimal" onChangeText={setValue} placeholder="0.00" placeholderTextColor={c.tertiaryLabel} style={[styles.input, { backgroundColor: c.fill, color: c.label }]} value={value} />
        </View>
        {message ? <Text style={[t.footnote, { color: c.red }]}>{message}</Text> : null}
        <PrimaryButton loading={save.isPending} onPress={() => void submit()} title="保存预算" />
      </View>
    </AdaptiveDialog>
  );
}

function SummaryTile({ color, label, value }: { color: string; label: string; value: string }) {
  const c = useTheme();
  return (
    <View style={[styles.summaryTile, { backgroundColor: c.card, borderColor: c.separator }]}>
      <Text style={[t.caption, { color: c.secondaryLabel }]}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={[t.title2, { color, marginTop: 7 }]}>{value}</Text>
    </View>
  );
}

function TransactionRow({ entry, admin, onReverse }: {
  entry: FinanceTransaction;
  admin: boolean;
  onReverse: () => void;
}) {
  const c = useTheme();
  const outgoing = entry.type === 'expense';
  const incoming = entry.type === 'income';
  const Icon = outgoing ? ArrowUpRight : incoming ? ArrowDownLeft : entry.type === 'transfer' ? ArrowLeftRight : RotateCcw;
  const color = outgoing ? c.red : incoming ? c.green : entry.type === 'reversal' ? c.secondaryLabel : c.blue;
  const background = outgoing ? c.redSoft : incoming ? c.greenSoft : entry.type === 'reversal' ? c.fill : c.blueSoft;
  const accounts = entry.postings.map((posting) => posting.account?.name).filter(Boolean).join(' → ');
  return (
    <View style={[styles.transactionRow, { borderBottomColor: c.separator, opacity: entry.reversed ? 0.55 : 1 }]}>
      <View style={[styles.rowIcon, { backgroundColor: background }]}><Icon color={color} size={18} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.rowTitleLine}>
          <Text numberOfLines={1} style={[t.subhead, styles.rowTitle, { color: c.label }]}>{entry.title}</Text>
          <Text style={[t.headline, { color }]}>
            {entry.type === 'expense' ? '-' : entry.type === 'income' ? '+' : ''}{currency(entry.amount)}
          </Text>
        </View>
        <Text numberOfLines={1} style={[t.caption, { color: c.secondaryLabel, marginTop: 4 }]}>
          {[entry.occurredOn, entry.category?.name, accounts, entry.actorName].filter(Boolean).join(' · ')}
        </Text>
        {entry.reversed ? <Text style={[t.caption, { color: c.red, marginTop: 3 }]}>已由反向流水撤销</Text> : null}
      </View>
      {admin && entry.type !== 'reversal' && !entry.reversed ? (
        <PressableScale accessibilityLabel={`撤销${entry.title}`} haptic={false} onPress={onReverse} style={styles.iconButton}>
          <RotateCcw color={c.secondaryLabel} size={17} />
        </PressableScale>
      ) : null}
    </View>
  );
}

export default function FinanceScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const { member } = useSession();
  const admin = member?.role === 'owner' || member?.role === 'admin';
  const [month, setMonth] = React.useState(monthNow());
  const [view, setView] = React.useState<FinanceView>('overview');
  const [filter, setFilter] = React.useState<LedgerFilter>('all');
  const [transactionOpen, setTransactionOpen] = React.useState(false);
  const [accountForm, setAccountForm] = React.useState<FinanceAccount | 'new' | null>(null);
  const [categoryOpen, setCategoryOpen] = React.useState(false);
  const [budgetForm, setBudgetForm] = React.useState<{ category: FinanceCategory; entry: FinanceBudget | null } | null>(null);
  const [reverseEntry, setReverseEntry] = React.useState<FinanceTransaction | null>(null);
  const [deleteBudgetEntry, setDeleteBudgetEntry] = React.useState<FinanceBudget | null>(null);
  const summary = useFinanceSummary(month);
  const accounts = useFinanceAccounts(true);
  const categories = useFinanceCategories(true);
  const transactions = useFinanceTransactions(month, filter === 'all' ? undefined : filter);
  const reverse = useReverseFinanceTransaction();
  const updateAccount = useUpdateFinanceAccount();
  const updateCategory = useUpdateFinanceCategory();
  const deleteBudget = useDeleteFinanceBudget();
  const activeAccounts = (accounts.data ?? []).filter((entry) => entry.isActive);
  const activeCategories = (categories.data ?? []).filter((entry) => entry.isActive);
  const loading = summary.isLoading || accounts.isLoading || categories.isLoading;
  const error = summary.error ?? accounts.error ?? categories.error;

  const reverseConfirmed = async () => {
    if (!reverseEntry) return;
    try {
      await reverse.mutateAsync({ id: reverseEntry.id });
      setReverseEntry(null);
    } catch (failure) {
      setReverseEntry(null);
      setTimeout(() => Alert.alert('撤销失败', failure instanceof Error ? failure.message : '请稍后重试'), 0);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <PageContainer maxWidth={1180} style={[styles.page, desktop && styles.pageDesktop]}>
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text accessibilityRole="header" style={[desktop ? t.largeTitle : t.title1, { color: c.label }]}>家庭财务</Text>
            <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 4 }]}>家庭共享账本、预算和账户余额</Text>
          </View>
          <View style={styles.headerActions}>
            <PressableScale
              accessibilityLabel="问小管家"
              haptic={false}
              onPress={() => router.push({ pathname: '/assistant', params: { route: '/finance' } })}
              style={[styles.secondaryAction, { backgroundColor: c.fill }]}
            >
              <Sparkles color={c.tint} size={17} />
              <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>问小管家</Text>
            </PressableScale>
            <PressableScale
              accessibilityLabel="记一笔"
              disabled={!activeAccounts.length}
              onPress={() => setTransactionOpen(true)}
              style={[styles.primaryAction, { backgroundColor: c.tint, opacity: activeAccounts.length ? 1 : 0.45 }]}
            >
              <Plus color="#FFFFFF" size={18} />
              <Text style={[t.footnote, { color: '#FFFFFF', fontWeight: '700' }]}>记一笔</Text>
            </PressableScale>
          </View>
        </View>

        <View style={styles.monthBar}>
          <PressableScale accessibilityLabel="上个月" haptic={false} onPress={() => setMonth(adjacentMonth(month, -1))} style={styles.iconButton}>
            <ChevronLeft color={c.label} size={20} />
          </PressableScale>
          <Text style={[t.headline, styles.monthText, { color: c.label }]}>{monthLabel(month)}</Text>
          <PressableScale accessibilityLabel="下个月" disabled={month >= monthNow()} haptic={false} onPress={() => setMonth(adjacentMonth(month, 1))} style={styles.iconButton}>
            <ChevronRight color={month >= monthNow() ? c.tertiaryLabel : c.label} size={20} />
          </PressableScale>
        </View>

        <View style={styles.viewTabs}>
          <Segmented<FinanceView>
            onChange={setView}
            options={[
              { label: '概览', value: 'overview' },
              { label: '流水', value: 'ledger' },
              { label: '预算', value: 'budgets' },
              { label: '账户', value: 'accounts' },
            ]}
            value={view}
          />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {loading ? <ActivityIndicator color={c.tint} style={styles.loader} /> : error ? (
            <EmptyState emoji="!" hint={error.message} title="家庭财务加载失败" />
          ) : !accounts.data?.length && view !== 'accounts' ? (
            <EmptyState icon={WalletCards} iconBackground={c.tintSoft} iconColor={c.tint} hint="先建立现金、银行卡或支付账户，再开始记录家庭收支" title="还没有财务账户" />
          ) : null}

          {!loading && !error && accounts.data?.length && view === 'overview' ? (
            <>
              <View style={styles.summaryGrid}>
                <SummaryTile color={c.label} label="家庭总余额" value={currency(summary.data?.totalBalance ?? 0)} />
                <SummaryTile color={c.green} label="本月收入" value={currency(summary.data?.income ?? 0)} />
                <SummaryTile color={c.red} label="本月支出" value={currency(summary.data?.expense ?? 0)} />
                <SummaryTile color={(summary.data?.net ?? 0) >= 0 ? c.green : c.red} label="本月结余" value={currency(summary.data?.net ?? 0, true)} />
              </View>
              <View style={styles.sectionHeader}>
                <Text style={[t.headline, { color: c.label }]}>账户余额</Text>
                <Text style={[t.caption, { color: c.secondaryLabel }]}>{activeAccounts.length} 个使用中</Text>
              </View>
              <Card>
                {activeAccounts.map((entry, index) => (
                  <View key={entry.id} style={[styles.accountRow, index < activeAccounts.length - 1 && { borderBottomColor: c.separator, borderBottomWidth: StyleSheet.hairlineWidth }]}>
                    <View style={[styles.rowIcon, { backgroundColor: c.tintSoft }]}><Landmark color={c.tint} size={18} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={[t.subhead, { color: c.label, fontWeight: '600' }]}>{entry.name}</Text>
                      <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>{ACCOUNT_LABELS[entry.type]}</Text>
                    </View>
                    <Text style={[t.headline, { color: c.label }]}>{currency(entry.balance)}</Text>
                  </View>
                ))}
              </Card>
              <View style={styles.sectionHeader}>
                <Text style={[t.headline, { color: c.label }]}>预算进度</Text>
                <PressableScale accessibilityLabel="管理预算" haptic={false} onPress={() => setView('budgets')} style={styles.textAction}>
                  <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>管理预算</Text>
                  <ChevronRight color={c.tint} size={16} />
                </PressableScale>
              </View>
              {summary.data?.budgets.length ? (
                <Card>
                  {summary.data.budgets.map((entry, index) => (
                    <View key={entry.id} style={[styles.budgetRow, index < summary.data!.budgets.length - 1 && { borderBottomColor: c.separator, borderBottomWidth: StyleSheet.hairlineWidth }]}>
                      <View style={styles.rowTitleLine}>
                        <Text style={[t.subhead, { color: c.label, fontWeight: '600' }]}>{entry.category.name}</Text>
                        <Text style={[t.footnote, { color: entry.ratio > 100 ? c.red : c.secondaryLabel }]}>{currency(entry.spent)} / {currency(entry.amount)}</Text>
                      </View>
                      <View style={[styles.progressTrack, { backgroundColor: c.fill }]}>
                        <View style={[styles.progressFill, { backgroundColor: entry.ratio > 100 ? c.red : c.tint, width: `${Math.min(entry.ratio, 100)}%` }]} />
                      </View>
                    </View>
                  ))}
                </Card>
              ) : <EmptyState icon={ReceiptText} hint="按餐饮、居家等支出分类设置月度预算" title="本月还没有预算" />}
            </>
          ) : null}

          {!loading && !error && accounts.data?.length && view === 'ledger' ? (
            <>
              <View style={styles.filterWrap}>
                <Segmented<LedgerFilter>
                  onChange={setFilter}
                  options={[{ label: '全部', value: 'all' }, { label: '支出', value: 'expense' }, { label: '收入', value: 'income' }, { label: '转账', value: 'transfer' }]}
                  value={filter}
                />
              </View>
              {transactions.isLoading ? <ActivityIndicator color={c.tint} style={styles.loader} /> : transactions.data?.length ? (
                <Card>
                  {transactions.data.map((entry) => <TransactionRow admin={admin} entry={entry} key={entry.id} onReverse={() => setReverseEntry(entry)} />)}
                </Card>
              ) : <EmptyState icon={ReceiptText} hint="本月符合筛选条件的流水会显示在这里" title="还没有流水" />}
            </>
          ) : null}

          {!loading && !error && accounts.data?.length && view === 'budgets' ? (
            <>
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={[t.headline, { color: c.label }]}>月度分类预算</Text>
                  <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>点击分类设置或调整预算</Text>
                </View>
              </View>
              <Card>
                {activeCategories.filter((entry) => entry.kind === 'expense').map((category, index, rows) => {
                  const budget = summary.data?.budgets.find((entry) => entry.categoryId === category.id) ?? null;
                  return (
                    <View key={category.id} style={[styles.manageRow, index < rows.length - 1 && { borderBottomColor: c.separator, borderBottomWidth: StyleSheet.hairlineWidth }]}>
                      <Pressable
                        accessibilityLabel={`设置${category.name}预算`}
                        accessibilityRole="button"
                        disabled={!admin}
                        onPress={() => setBudgetForm({ category, entry: budget })}
                        style={({ pressed }) => [styles.manageRowAction, pressed && { backgroundColor: c.fill }]}
                      >
                        <View style={[styles.colorSwatch, { backgroundColor: category.color }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={[t.subhead, { color: c.label, fontWeight: '600' }]}>{category.name}</Text>
                          <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>{budget ? `已用 ${currency(budget.spent)} · 剩余 ${currency(budget.remaining)}` : '尚未设置'}</Text>
                        </View>
                        <Text style={[t.headline, { color: budget ? c.label : c.tertiaryLabel }]}>{budget ? currency(budget.amount) : '--'}</Text>
                        {admin ? <Pencil color={c.tertiaryLabel} size={16} /> : null}
                      </Pressable>
                      {admin && budget ? (
                        <PressableScale accessibilityLabel={`删除${category.name}预算`} haptic={false} onPress={() => setDeleteBudgetEntry(budget)} style={styles.iconButton}>
                          <Trash2 color={c.red} size={16} />
                        </PressableScale>
                      ) : null}
                    </View>
                  );
                })}
              </Card>
              {!admin ? <Text style={[t.footnote, styles.permissionNote, { color: c.secondaryLabel }]}>只有家庭管理员可以修改预算。</Text> : null}
            </>
          ) : null}

          {!loading && !error && view === 'accounts' ? (
            <>
              <View style={styles.sectionHeader}>
                <Text style={[t.headline, { color: c.label }]}>财务账户</Text>
                {admin ? <PressableScale accessibilityLabel="新增账户" haptic={false} onPress={() => setAccountForm('new')} style={[styles.compactButton, { backgroundColor: c.tintSoft }]}><Plus color={c.tint} size={16} /><Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>新增账户</Text></PressableScale> : null}
              </View>
              {accounts.data?.length ? (
                <Card>
                  {accounts.data.map((entry, index, rows) => (
                    <View key={entry.id} style={[styles.manageRow, index < rows.length - 1 && { borderBottomColor: c.separator, borderBottomWidth: StyleSheet.hairlineWidth }]}>
                      <View style={[styles.rowIcon, { backgroundColor: entry.isActive ? c.tintSoft : c.fill }]}><WalletCards color={entry.isActive ? c.tint : c.secondaryLabel} size={18} /></View>
                      <View style={{ flex: 1 }}><Text style={[t.subhead, { color: c.label, fontWeight: '600' }]}>{entry.name}</Text><Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>{ACCOUNT_LABELS[entry.type]} · {currency(entry.balance)}</Text></View>
                      {admin ? <PressableScale accessibilityLabel={`编辑${entry.name}`} haptic={false} onPress={() => setAccountForm(entry)} style={styles.iconButton}><Pencil color={c.secondaryLabel} size={16} /></PressableScale> : null}
                      {admin ? <Switch accessibilityLabel={`${entry.name}${entry.isActive ? '停用' : '启用'}`} onValueChange={(isActive) => void updateAccount.mutateAsync({ id: entry.id, isActive, expectedVersion: entry.version })} trackColor={{ false: c.fillStrong, true: c.tintSoft }} thumbColor={entry.isActive ? c.tint : c.tertiaryLabel} value={entry.isActive} /> : null}
                    </View>
                  ))}
                </Card>
              ) : (
                <EmptyState
                  icon={WalletCards}
                  hint={admin ? '点击上方“新增账户”建立家庭的第一个财务账户' : '请联系家庭管理员建立财务账户'}
                  title="还没有财务账户"
                />
              )}
              <View style={styles.sectionHeader}>
                <Text style={[t.headline, { color: c.label }]}>收支分类</Text>
                {admin ? <PressableScale accessibilityLabel="新增分类" haptic={false} onPress={() => setCategoryOpen(true)} style={[styles.compactButton, { backgroundColor: c.tintSoft }]}><Plus color={c.tint} size={16} /><Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>新增分类</Text></PressableScale> : null}
              </View>
              <Card>
                {(categories.data ?? []).map((entry, index, rows) => (
                  <View key={entry.id} style={[styles.manageRow, index < rows.length - 1 && { borderBottomColor: c.separator, borderBottomWidth: StyleSheet.hairlineWidth }]}>
                    <View style={[styles.colorSwatch, { backgroundColor: entry.color }]} />
                    <View style={{ flex: 1 }}><Text style={[t.subhead, { color: c.label, fontWeight: '600' }]}>{entry.name}</Text><Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>{entry.kind === 'expense' ? '支出分类' : '收入分类'}{entry.systemKey ? ' · 系统默认' : ''}</Text></View>
                    {admin ? <Switch accessibilityLabel={`${entry.name}${entry.isActive ? '停用' : '启用'}`} onValueChange={(isActive) => void updateCategory.mutateAsync({ id: entry.id, isActive, expectedVersion: entry.version })} trackColor={{ false: c.fillStrong, true: c.tintSoft }} thumbColor={entry.isActive ? c.tint : c.tertiaryLabel} value={entry.isActive} /> : null}
                  </View>
                ))}
              </Card>
            </>
          ) : null}
        </ScrollView>
      </PageContainer>

      {transactionOpen ? <TransactionDialog accounts={activeAccounts} categories={activeCategories} onClose={() => setTransactionOpen(false)} /> : null}
      {accountForm ? <AccountDialog entry={accountForm === 'new' ? null : accountForm} onClose={() => setAccountForm(null)} /> : null}
      {categoryOpen ? <CategoryDialog onClose={() => setCategoryOpen(false)} /> : null}
      {budgetForm ? <BudgetDialog category={budgetForm.category} entry={budgetForm.entry} month={month} onClose={() => setBudgetForm(null)} /> : null}
      <ConfirmDialog visible={Boolean(reverseEntry)} title="撤销这笔流水？" message="原流水会保留，并新增一笔金额相反的撤销流水。账户余额和本月统计会同步恢复。" confirmLabel="确认撤销" loading={reverse.isPending} onCancel={() => setReverseEntry(null)} onConfirm={() => void reverseConfirmed()} />
      <ConfirmDialog visible={Boolean(deleteBudgetEntry)} title="删除这项预算？" message="只会删除本月预算，不会影响已有财务流水。" confirmLabel="删除预算" loading={deleteBudget.isPending} onCancel={() => setDeleteBudgetEntry(null)} onConfirm={() => {
        if (!deleteBudgetEntry) return;
        void deleteBudget.mutateAsync({ id: deleteBudgetEntry.id, expectedVersion: deleteBudgetEntry.version }).then(() => setDeleteBudgetEntry(null));
      }} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingTop: 8 },
  pageDesktop: { paddingTop: 22 },
  header: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  secondaryAction: { minHeight: 44, paddingHorizontal: 12, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  primaryAction: { minHeight: 44, paddingHorizontal: 14, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  monthBar: { alignSelf: 'center', minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  monthText: { minWidth: 150, textAlign: 'center' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  viewTabs: { width: '100%', maxWidth: 520, alignSelf: 'center', marginTop: 8 },
  scrollContent: { paddingTop: 16, paddingBottom: 40 },
  loader: { paddingVertical: 54 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryTile: { minWidth: 150, flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: 15 },
  sectionHeader: { minHeight: 44, marginTop: 20, marginBottom: 8, paddingHorizontal: 3, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  accountRow: { minHeight: 72, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 11 },
  rowIcon: { width: 38, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  textAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4 },
  budgetRow: { paddingHorizontal: 14, paddingVertical: 13 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  progressTrack: { height: 7, borderRadius: 4, marginTop: 10, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  filterWrap: { width: '100%', maxWidth: 520, marginBottom: 12 },
  transactionRow: { minHeight: 78, paddingHorizontal: 14, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  rowTitle: { flex: 1, fontWeight: '600' },
  manageRow: { minHeight: 70, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  manageRowAction: { flex: 1, minWidth: 0, minHeight: 48, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', gap: 10 },
  colorSwatch: { width: 18, height: 18, borderRadius: 4 },
  compactButton: { minHeight: 44, paddingHorizontal: 11, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', gap: 5 },
  permissionNote: { marginTop: 10, textAlign: 'center' },
  dialogHeader: { minHeight: 74, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 10 },
  dialogContent: { padding: 20, gap: 17 },
  field: { gap: 7 },
  fieldLabel: { fontWeight: '600' },
  input: { minHeight: 48, borderRadius: radius.sm, paddingHorizontal: 13, fontSize: 16 },
  amountInputWrap: { minHeight: 62, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 8 },
  amountInput: { flex: 1, minWidth: 0, fontSize: 29, fontWeight: '700', letterSpacing: 0 },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choiceChip: { minHeight: 44, paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  twoColumns: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  flexField: { flex: 1, minWidth: 190 },
});
