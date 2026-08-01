import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Archive,
  BellPlus,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Trash2,
  Upload,
  Wrench,
  X,
} from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageContainer, useDesktopLayout } from '../../components/app-shell';
import { DateSelector } from '../../components/date-selector';
import {
  Card,
  ConfirmDialog,
  EmptyState,
  PrimaryButton,
  Segmented,
} from '../../components/ui';
import { photoUri } from '../../lib/api';
import { formatPlanDate, parseDate, todayStr } from '../../lib/date';
import {
  useAddAssetDocument,
  useAddMaintenancePlan,
  useAsset,
  useAssetDocumentAccess,
  useAssets,
  useCompleteMaintenancePlan,
  useRemoveAssetDocument,
  useUpdateMaintenancePlan,
  useUpsertAsset,
} from '../../lib/queries';
import { radius, type as t, useTheme } from '../../lib/theme';
import type {
  AssetCategory,
  AssetDocument,
  AssetDocumentType,
  HomeAsset,
  MaintenancePlan,
} from '../../lib/types';

const CATEGORY_META: Record<AssetCategory, { label: string; short: string }> = {
  appliance: { label: '家电', short: '电' },
  furniture: { label: '家具', short: '家' },
  electronics: { label: '数码', short: '数' },
  tool: { label: '工具', short: '工' },
  other: { label: '其他', short: '物' },
};

const DOCUMENT_META: Record<AssetDocumentType, string> = {
  receipt: '购买凭证',
  manual: '说明资料',
  warranty: '保修材料',
  other: '其他资料',
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function dateLabel(value: string | null) {
  if (!value) return '未记录';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(parseDate(value));
}

function addDays(value: string, days: number) {
  const date = parseDate(value);
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function dueState(value: string) {
  const today = parseDate(todayStr()).getTime();
  const due = parseDate(value).getTime();
  const days = Math.round((due - today) / 86_400_000);
  if (days < 0) return { label: `逾期 ${Math.abs(days)} 天`, urgent: true };
  if (days === 0) return { label: '今天到期', urgent: true };
  if (days <= 30) return { label: `${days} 天后`, urgent: false };
  return { label: formatPlanDate(value), urgent: false };
}

function idempotencyKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const c = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>
        {label}
      </Text>
      {children}
    </View>
  );
}

function OptionalDateField({
  enabled,
  label,
  onEnabledChange,
  onValueChange,
  value,
}: {
  enabled: boolean;
  label: string;
  onEnabledChange: (value: boolean) => void;
  onValueChange: (value: string) => void;
  value: string;
}) {
  const c = useTheme();
  return (
    <Field label={label}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: enabled }}
        onPress={() => onEnabledChange(!enabled)}
        style={styles.checkboxRow}
      >
        <View
          style={[
            styles.checkbox,
            {
              backgroundColor: enabled ? c.tint : 'transparent',
              borderColor: enabled ? c.tint : c.fillStrong,
            },
          ]}
        >
          {enabled ? <CheckCircle2 color="#FFFFFF" size={14} /> : null}
        </View>
        <Text style={[t.subhead, { color: c.label }]}>记录{label}</Text>
      </Pressable>
      {enabled ? (
        <DateSelector allowPast onChange={onValueChange} value={value} />
      ) : null}
    </Field>
  );
}

function AssetEditor({
  asset,
  onClose,
  onSaved,
}: {
  asset: HomeAsset | null;
  onClose: () => void;
  onSaved: (asset: HomeAsset) => void;
}) {
  const c = useTheme();
  const save = useUpsertAsset();
  const [name, setName] = useState(asset?.name ?? '');
  const [category, setCategory] = useState<AssetCategory>(
    asset?.category ?? 'appliance',
  );
  const [location, setLocation] = useState(asset?.location ?? '');
  const [brand, setBrand] = useState(asset?.brand ?? '');
  const [model, setModel] = useState(asset?.model ?? '');
  const [serialNumber, setSerialNumber] = useState(asset?.serialNumber ?? '');
  const [purchaseEnabled, setPurchaseEnabled] = useState(
    Boolean(asset?.purchaseDate),
  );
  const [purchaseDate, setPurchaseDate] = useState(
    asset?.purchaseDate ?? todayStr(),
  );
  const [purchasePrice, setPurchasePrice] = useState(
    asset?.purchasePrice ? String(Number(asset.purchasePrice)) : '',
  );
  const [warrantyEnabled, setWarrantyEnabled] = useState(
    Boolean(asset?.warrantyExpiresOn),
  );
  const [warrantyExpiresOn, setWarrantyExpiresOn] = useState(
    asset?.warrantyExpiresOn ?? addDays(todayStr(), 365),
  );
  const [note, setNote] = useState(asset?.note ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const parsedPrice = purchasePrice.trim() ? Number(purchasePrice) : null;
  const valid =
    Boolean(name.trim()) &&
    (parsedPrice == null || (Number.isFinite(parsedPrice) && parsedPrice >= 0));

  const submit = async () => {
    if (!valid) return;
    setMessage(null);
    try {
      const saved = await save.mutateAsync({
        id: asset?.id,
        name: name.trim(),
        category,
        location: location.trim() || null,
        brand: brand.trim() || null,
        model: model.trim() || null,
        serialNumber: serialNumber.trim() || null,
        purchaseDate: purchaseEnabled ? purchaseDate : null,
        purchasePrice: parsedPrice,
        warrantyExpiresOn: warrantyEnabled ? warrantyExpiresOn : null,
        status: asset?.status,
        note: note.trim() || null,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved(saved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存资产失败');
    }
  };

  return (
    <Sheet
      onClose={onClose}
      subtitle="保修信息、型号和位置只在当前家庭可见"
      title={asset ? '编辑家庭资产' : '新增家庭资产'}
    >
      <ScrollView
        contentContainerStyle={styles.formContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Field label="资产名称">
          <TextInput
            accessibilityLabel="资产名称"
            onChangeText={setName}
            placeholder="比如：客厅空调"
            placeholderTextColor={c.tertiaryLabel}
            style={[styles.input, t.body, { backgroundColor: c.fill, color: c.label }]}
            value={name}
          />
        </Field>
        <Field label="分类">
          <View style={styles.chips}>
            {(Object.keys(CATEGORY_META) as AssetCategory[]).map((value) => {
              const selected = category === value;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={value}
                  onPress={() => setCategory(value)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected ? c.tintSoft : c.fill,
                      borderColor: selected ? c.tint : 'transparent',
                    },
                  ]}
                >
                  <Text
                    style={[
                      t.footnote,
                      { color: selected ? c.tint : c.label, fontWeight: '700' },
                    ]}
                  >
                    {CATEGORY_META[value].label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Field>
        <View style={styles.twoColumns}>
          <Field label="所在位置">
            <TextInput
              accessibilityLabel="所在位置"
              onChangeText={setLocation}
              placeholder="客厅、厨房"
              placeholderTextColor={c.tertiaryLabel}
              style={[styles.input, t.body, { backgroundColor: c.fill, color: c.label }]}
              value={location}
            />
          </Field>
          <Field label="品牌">
            <TextInput
              accessibilityLabel="品牌"
              onChangeText={setBrand}
              placeholder="可选"
              placeholderTextColor={c.tertiaryLabel}
              style={[styles.input, t.body, { backgroundColor: c.fill, color: c.label }]}
              value={brand}
            />
          </Field>
          <Field label="型号">
            <TextInput
              accessibilityLabel="型号"
              onChangeText={setModel}
              placeholder="可选"
              placeholderTextColor={c.tertiaryLabel}
              style={[styles.input, t.body, { backgroundColor: c.fill, color: c.label }]}
              value={model}
            />
          </Field>
          <Field label="序列号">
            <TextInput
              accessibilityLabel="序列号"
              onChangeText={setSerialNumber}
              placeholder="可选"
              placeholderTextColor={c.tertiaryLabel}
              style={[styles.input, t.body, { backgroundColor: c.fill, color: c.label }]}
              value={serialNumber}
            />
          </Field>
        </View>
        <OptionalDateField
          enabled={purchaseEnabled}
          label="购买日期"
          onEnabledChange={setPurchaseEnabled}
          onValueChange={setPurchaseDate}
          value={purchaseDate}
        />
        {purchaseEnabled ? (
          <Field label="购买价格">
            <TextInput
              accessibilityLabel="购买价格"
              inputMode="decimal"
              onChangeText={setPurchasePrice}
              placeholder="可选"
              placeholderTextColor={c.tertiaryLabel}
              style={[styles.input, t.body, { backgroundColor: c.fill, color: c.label }]}
              value={purchasePrice}
            />
          </Field>
        ) : null}
        <OptionalDateField
          enabled={warrantyEnabled}
          label="保修到期日"
          onEnabledChange={setWarrantyEnabled}
          onValueChange={setWarrantyExpiresOn}
          value={warrantyExpiresOn}
        />
        <Field label="备注">
          <TextInput
            accessibilityLabel="资产备注"
            multiline
            onChangeText={setNote}
            placeholder="安装信息、注意事项等"
            placeholderTextColor={c.tertiaryLabel}
            style={[
              styles.input,
              styles.multiline,
              t.body,
              { backgroundColor: c.fill, color: c.label },
            ]}
            value={note}
          />
        </Field>
        {message ? <Text style={[t.footnote, { color: c.red }]}>{message}</Text> : null}
        <PrimaryButton
          disabled={!valid}
          loading={save.isPending}
          onPress={() => void submit()}
          title="保存资产"
        />
      </ScrollView>
    </Sheet>
  );
}

function DocumentForm({
  asset,
  onClose,
  onSaved,
}: {
  asset: HomeAsset;
  onClose: () => void;
  onSaved: () => void;
}) {
  const c = useTheme();
  const add = useAddAssetDocument();
  const [type, setType] = useState<AssetDocumentType>('receipt');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [localPhoto, setLocalPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const valid = Boolean(title.trim()) && Boolean(localPhoto || url.trim());

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      setLocalPhoto(result.assets[0].uri);
      setUrl('');
    }
  };

  const submit = async () => {
    if (!valid) return;
    setMessage(null);
    setUploading(true);
    try {
      await add.mutateAsync({
        assetId: asset.id,
        type,
        title: title.trim(),
        ...(localPhoto ? { localUri: localPhoto } : { url: url.trim() }),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存资料失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Sheet onClose={onClose} subtitle={asset.name} title="添加资产资料">
      <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
        <Field label="资料类型">
          <View style={styles.chips}>
            {(Object.keys(DOCUMENT_META) as AssetDocumentType[]).map((value) => {
              const selected = type === value;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={value}
                  onPress={() => setType(value)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected ? c.tintSoft : c.fill,
                      borderColor: selected ? c.tint : 'transparent',
                    },
                  ]}
                >
                  <Text style={[t.footnote, { color: selected ? c.tint : c.label, fontWeight: '700' }]}>
                    {DOCUMENT_META[value]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Field>
        <Field label="资料名称">
          <TextInput
            accessibilityLabel="资料名称"
            onChangeText={setTitle}
            placeholder="比如：京东电子发票"
            placeholderTextColor={c.tertiaryLabel}
            style={[styles.input, t.body, { backgroundColor: c.fill, color: c.label }]}
            value={title}
          />
        </Field>
        <Field label="上传图片或填写链接">
          <Pressable
            accessibilityRole="button"
            onPress={() => void pickPhoto()}
            style={[styles.uploadButton, { backgroundColor: c.tintSoft, borderColor: c.tint }]}
          >
            <Upload color={c.tint} size={18} />
            <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]}>
              {localPhoto ? '已选择图片，点击更换' : '选择凭证或资料图片'}
            </Text>
          </Pressable>
          <Text style={[t.caption, { color: c.tertiaryLabel, textAlign: 'center' }]}>或者</Text>
          <TextInput
            accessibilityLabel="资料链接"
            autoCapitalize="none"
            inputMode="url"
            onChangeText={(value) => {
              setUrl(value);
              if (value) setLocalPhoto(null);
            }}
            placeholder="https://厂商说明书地址"
            placeholderTextColor={c.tertiaryLabel}
            style={[styles.input, t.body, { backgroundColor: c.fill, color: c.label }]}
            value={url}
          />
        </Field>
        {message ? <Text style={[t.footnote, { color: c.red }]}>{message}</Text> : null}
        <PrimaryButton
          disabled={!valid}
          loading={uploading || add.isPending}
          onPress={() => void submit()}
          title="保存资料"
        />
      </ScrollView>
    </Sheet>
  );
}

function PlanForm({
  asset,
  onClose,
  onSaved,
}: {
  asset: HomeAsset;
  onClose: () => void;
  onSaved: () => void;
}) {
  const c = useTheme();
  const add = useAddMaintenancePlan();
  const [title, setTitle] = useState('');
  const [frequency, setFrequency] = useState('180');
  const [nextDueDate, setNextDueDate] = useState(todayStr(30));
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const frequencyDays = Number(frequency);
  const valid =
    Boolean(title.trim()) &&
    Number.isInteger(frequencyDays) &&
    frequencyDays >= 1 &&
    frequencyDays <= 3650;

  const submit = async () => {
    if (!valid) return;
    setMessage(null);
    try {
      await add.mutateAsync({
        assetId: asset.id,
        title: title.trim(),
        frequencyDays,
        nextDueDate,
        note: note.trim() || null,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存维护计划失败');
    }
  };

  return (
    <Sheet onClose={onClose} subtitle={asset.name} title="新增维护计划">
      <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
        <Field label="维护事项">
          <TextInput
            accessibilityLabel="维护事项"
            onChangeText={setTitle}
            placeholder="比如：清洗滤网"
            placeholderTextColor={c.tertiaryLabel}
            style={[styles.input, t.body, { backgroundColor: c.fill, color: c.label }]}
            value={title}
          />
        </Field>
        <Field label="周期天数">
          <TextInput
            accessibilityLabel="维护周期天数"
            inputMode="numeric"
            onChangeText={setFrequency}
            placeholder="180"
            placeholderTextColor={c.tertiaryLabel}
            style={[styles.input, t.body, { backgroundColor: c.fill, color: c.label }]}
            value={frequency}
          />
        </Field>
        <Field label="首次到期日">
          <DateSelector allowPast onChange={setNextDueDate} value={nextDueDate} />
        </Field>
        <Field label="维护说明">
          <TextInput
            accessibilityLabel="维护说明"
            multiline
            onChangeText={setNote}
            placeholder="操作步骤、耗材型号等"
            placeholderTextColor={c.tertiaryLabel}
            style={[styles.input, styles.multiline, t.body, { backgroundColor: c.fill, color: c.label }]}
            value={note}
          />
        </Field>
        {message ? <Text style={[t.footnote, { color: c.red }]}>{message}</Text> : null}
        <PrimaryButton
          disabled={!valid}
          loading={add.isPending}
          onPress={() => void submit()}
          title="保存维护计划"
        />
      </ScrollView>
    </Sheet>
  );
}

function CompletionForm({
  asset,
  onClose,
  onSaved,
  plan,
}: {
  asset: HomeAsset;
  onClose: () => void;
  onSaved: (message: string) => void;
  plan: MaintenancePlan;
}) {
  const c = useTheme();
  const complete = useCompleteMaintenancePlan();
  const [performedOn, setPerformedOn] = useState(todayStr());
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const [key] = useState(idempotencyKey);
  const [message, setMessage] = useState<string | null>(null);
  const parsedCost = cost.trim() ? Number(cost) : null;
  const valid = parsedCost == null || (Number.isFinite(parsedCost) && parsedCost >= 0);
  const nextDue = addDays(performedOn, plan.frequencyDays);

  const submit = async () => {
    if (!valid) return;
    setMessage(null);
    try {
      const performedAt = new Date(`${performedOn}T12:00:00`).toISOString();
      const result = await complete.mutateAsync({
        assetId: asset.id,
        planId: plan.id,
        performedAt,
        cost: parsedCost,
        note: note.trim() || null,
        idempotencyKey: key,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved(
        result.alreadyCompleted
          ? '这次维护已经记录，没有重复推进日期'
          : `已完成维护，下次安排在 ${dateLabel(result.plan.nextDueDate)}`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '记录维护失败');
    }
  };

  return (
    <Sheet onClose={onClose} subtitle={`${asset.name} · ${plan.title}`} title="确认完成维护">
      <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
        <Field label="实际完成日期">
          <DateSelector allowPast onChange={setPerformedOn} value={performedOn} />
        </Field>
        <View style={[styles.forecast, { backgroundColor: c.greenSoft }]}>
          <Text style={[t.footnote, { color: c.green, fontWeight: '700' }]}>预计变化</Text>
          <Text style={[t.headline, { color: c.label, marginTop: 5 }]}>下一次：{dateLabel(nextDue)}</Text>
          <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>按 {plan.frequencyDays} 天周期从完成日重新计算</Text>
        </View>
        <Field label="本次费用">
          <TextInput
            accessibilityLabel="本次维护费用"
            inputMode="decimal"
            onChangeText={setCost}
            placeholder="可选"
            placeholderTextColor={c.tertiaryLabel}
            style={[styles.input, t.body, { backgroundColor: c.fill, color: c.label }]}
            value={cost}
          />
        </Field>
        <Field label="维护记录">
          <TextInput
            accessibilityLabel="维护记录"
            multiline
            onChangeText={setNote}
            placeholder="更换内容、发现的问题等"
            placeholderTextColor={c.tertiaryLabel}
            style={[styles.input, styles.multiline, t.body, { backgroundColor: c.fill, color: c.label }]}
            value={note}
          />
        </Field>
        {message ? <Text style={[t.footnote, { color: c.red }]}>{message}</Text> : null}
        <PrimaryButton
          disabled={!valid}
          icon={<CheckCircle2 color="#FFFFFF" size={18} />}
          loading={complete.isPending}
          onPress={() => void submit()}
          title="确认完成并推进日期"
        />
      </ScrollView>
    </Sheet>
  );
}

function AssetDetail({
  assetId,
  onClose,
  onEdit,
}: {
  assetId: string;
  onClose: () => void;
  onEdit: (asset: HomeAsset) => void;
}) {
  const c = useTheme();
  const router = useRouter();
  const { data: asset, isLoading } = useAsset(assetId);
  const upsert = useUpsertAsset();
  const updatePlan = useUpdateMaintenancePlan();
  const removeDocument = useRemoveAssetDocument();
  const accessDocument = useAssetDocumentAccess();
  const [documentOpen, setDocumentOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [completingPlan, setCompletingPlan] = useState<MaintenancePlan | null>(null);
  const [pendingDocument, setPendingDocument] = useState<AssetDocument | null>(null);
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null);
  const [statusConfirm, setStatusConfirm] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    type: 'success' | 'error';
  } | null>(null);

  const changeStatus = async () => {
    if (!asset) return;
    try {
      const nextStatus = asset.status === 'active' ? 'retired' : 'active';
      await upsert.mutateAsync({
        id: asset.id,
        name: asset.name,
        category: asset.category,
        status: nextStatus,
      });
      setStatusConfirm(false);
      setMessage({
        text:
          nextStatus === 'retired'
            ? '资产已停用，相关待发送提醒已取消'
            : '资产已恢复使用',
        type: 'success',
      });
    } catch (error) {
      setStatusConfirm(false);
      setMessage({
        text: error instanceof Error ? error.message : '更新状态失败',
        type: 'error',
      });
    }
  };

  const openDocument = async (document: AssetDocument) => {
    setOpeningDocumentId(document.id);
    try {
      const access = await accessDocument.mutateAsync(document.id);
      await Linking.openURL(photoUri(access.url) ?? access.url);
      setMessage({ text: `已打开资料「${document.title}」`, type: 'success' });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : '打开资料失败',
        type: 'error',
      });
    } finally {
      setOpeningDocumentId(null);
    }
  };

  return (
    <Sheet onClose={onClose} subtitle="档案、资料和维护记录" title={asset?.name ?? '家庭资产'}>
      {isLoading || !asset ? (
        <ActivityIndicator color={c.tint} style={{ marginVertical: 50 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
          <View style={styles.detailActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => onEdit(asset)}
              style={[styles.secondaryButton, { backgroundColor: c.fill }]}
            >
              <Pencil color={c.tint} size={16} />
              <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>编辑档案</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setStatusConfirm(true)}
              style={[styles.secondaryButton, { backgroundColor: c.fill }]}
            >
              {asset.status === 'active' ? (
                <Archive color={c.secondaryLabel} size={16} />
              ) : (
                <RotateCcw color={c.tint} size={16} />
              )}
              <Text style={[t.footnote, { color: c.secondaryLabel, fontWeight: '700' }]}>
                {asset.status === 'active' ? '停用资产' : '恢复使用'}
              </Text>
            </Pressable>
          </View>

          {message ? (
            <View
              style={[
                styles.messageBox,
                { backgroundColor: message.type === 'error' ? c.redSoft : c.greenSoft },
              ]}
            >
              <Text
                style={[
                  t.footnote,
                  { color: message.type === 'error' ? c.red : c.green },
                ]}
              >
                {message.text}
              </Text>
            </View>
          ) : null}

          <View style={[styles.infoBand, { backgroundColor: c.fill }]}>
            <View style={styles.infoCell}>
              <Text style={[t.caption, { color: c.secondaryLabel }]}>分类</Text>
              <Text style={[t.subhead, { color: c.label, fontWeight: '700', marginTop: 3 }]}>{CATEGORY_META[asset.category].label}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={[t.caption, { color: c.secondaryLabel }]}>位置</Text>
              <Text style={[t.subhead, { color: c.label, fontWeight: '700', marginTop: 3 }]}>{asset.location ?? '未记录'}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={[t.caption, { color: c.secondaryLabel }]}>购买日期</Text>
              <Text style={[t.subhead, { color: c.label, fontWeight: '700', marginTop: 3 }]}>{dateLabel(asset.purchaseDate)}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={[t.caption, { color: c.secondaryLabel }]}>保修到期</Text>
              <Text style={[t.subhead, { color: c.label, fontWeight: '700', marginTop: 3 }]}>{dateLabel(asset.warrantyExpiresOn)}</Text>
            </View>
          </View>

          {(asset.brand || asset.model || asset.serialNumber || asset.note) ? (
            <Card style={styles.identityCard}>
              {asset.brand || asset.model ? (
                <Text style={[t.subhead, { color: c.label }]}>{[asset.brand, asset.model].filter(Boolean).join(' · ')}</Text>
              ) : null}
              {asset.serialNumber ? <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 5 }]}>序列号：{asset.serialNumber}</Text> : null}
              {asset.note ? <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 8 }]}>{asset.note}</Text> : null}
            </Card>
          ) : null}

          <View style={styles.sectionHeaderRow}>
            <View>
              <Text style={[t.headline, { color: c.label }]}>维护计划</Text>
              <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>{asset.maintenancePlans.length} 项周期安排</Text>
            </View>
            {asset.status === 'active' ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setPlanOpen(true)}
                style={[styles.smallAdd, { backgroundColor: c.tintSoft }]}
              >
                <Plus color={c.tint} size={16} />
                <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>新增计划</Text>
              </Pressable>
            ) : null}
          </View>
          {asset.maintenancePlans.length ? (
            <View style={styles.stack}>
              {asset.maintenancePlans.map((plan) => {
                const due = dueState(plan.nextDueDate);
                return (
                  <Card key={plan.id} style={styles.planCard}>
                    <View style={styles.planTop}>
                      <View style={[styles.rowIcon, { backgroundColor: plan.isEnabled ? c.orangeSoft : c.fill }]}>
                        <Wrench color={plan.isEnabled ? c.orange : c.secondaryLabel} size={18} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]}>{plan.title}</Text>
                        <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>每 {plan.frequencyDays} 天 · 下次 {dateLabel(plan.nextDueDate)}</Text>
                      </View>
                      <View style={[styles.dueBadge, { backgroundColor: due.urgent ? c.redSoft : c.orangeSoft }]}>
                        <Text style={[t.caption, { color: due.urgent ? c.red : c.orange, fontWeight: '700' }]}>{plan.isEnabled ? due.label : '已停用'}</Text>
                      </View>
                    </View>
                    {plan.note ? <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 9 }]}>{plan.note}</Text> : null}
                    <View style={[styles.planActions, { borderTopColor: c.separator }]}>
                      <Pressable
                        accessibilityRole="button"
                        disabled={!plan.isEnabled || asset.status !== 'active'}
                        onPress={() => setCompletingPlan(plan)}
                        style={[styles.planAction, { opacity: plan.isEnabled ? 1 : 0.4 }]}
                      >
                        <CheckCircle2 color={c.green} size={16} />
                        <Text style={[t.footnote, { color: c.green, fontWeight: '700' }]}>完成维护</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        disabled={!plan.isEnabled || asset.status !== 'active'}
                        onPress={() => {
                          onClose();
                          router.push(`/reminders?sourceModule=maintenance&sourceId=${plan.id}`);
                        }}
                        style={[styles.planAction, { opacity: plan.isEnabled ? 1 : 0.4 }]}
                      >
                        <BellPlus color={c.tint} size={16} />
                        <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>设置提醒</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        disabled={updatePlan.isPending}
                        onPress={() =>
                          updatePlan.mutate(
                            {
                              assetId: asset.id,
                              planId: plan.id,
                              isEnabled: !plan.isEnabled,
                            },
                            {
                              onSuccess: () =>
                                setMessage({
                                  text: plan.isEnabled
                                    ? '维护计划已停用，相关待发送提醒已取消'
                                    : '维护计划已启用',
                                  type: 'success',
                                }),
                              onError: (error) =>
                                setMessage({
                                  text:
                                    error instanceof Error
                                      ? error.message
                                      : '更新维护计划失败',
                                  type: 'error',
                                }),
                            },
                          )
                        }
                        style={[
                          styles.planAction,
                          { opacity: updatePlan.isPending ? 0.45 : 1 },
                        ]}
                      >
                        {plan.isEnabled ? <Archive color={c.secondaryLabel} size={16} /> : <RotateCcw color={c.tint} size={16} />}
                        <Text style={[t.footnote, { color: c.secondaryLabel, fontWeight: '700' }]}>{plan.isEnabled ? '停用' : '启用'}</Text>
                      </Pressable>
                    </View>
                  </Card>
                );
              })}
            </View>
          ) : (
            <View style={[styles.inlineEmpty, { backgroundColor: c.fill }]}>
              <CalendarClock color={c.tertiaryLabel} size={22} />
              <Text style={[t.footnote, { color: c.secondaryLabel }]}>还没有维护计划</Text>
            </View>
          )}

          <View style={styles.sectionHeaderRow}>
            <View>
              <Text style={[t.headline, { color: c.label }]}>凭证与说明资料</Text>
              <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>{asset.documents.length} 份资料</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setDocumentOpen(true)}
              style={[styles.smallAdd, { backgroundColor: c.tintSoft }]}
            >
              <Plus color={c.tint} size={16} />
              <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>添加资料</Text>
            </Pressable>
          </View>
          {asset.documents.length ? (
            <Card style={styles.listCard}>
              {asset.documents.map((document) => (
                <View key={document.id} style={[styles.documentRow, { borderBottomColor: c.separator }]}>
                  <View style={[styles.rowIcon, { backgroundColor: c.blueSoft }]}>
                    {document.type === 'receipt' ? <ReceiptText color={c.blue} size={17} /> : <FileText color={c.blue} size={17} />}
                  </View>
                  <Pressable
                    accessibilityRole="link"
                    disabled={Boolean(openingDocumentId)}
                    onPress={() => void openDocument(document)}
                    style={{ flex: 1, minWidth: 0 }}
                  >
                    <Text numberOfLines={1} style={[t.subhead, { color: c.label, fontWeight: '700' }]}>{document.title}</Text>
                    <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>{DOCUMENT_META[document.type]} · {document.createdBy.name}</Text>
                  </Pressable>
                  {openingDocumentId === document.id ? (
                    <ActivityIndicator color={c.tint} size="small" />
                  ) : (
                    <ExternalLink color={c.tertiaryLabel} size={16} />
                  )}
                  <Pressable
                    accessibilityLabel={`删除资料${document.title}`}
                    accessibilityRole="button"
                    onPress={() => setPendingDocument(document)}
                    style={styles.iconButton}
                  >
                    <Trash2 color={c.red} size={16} />
                  </Pressable>
                </View>
              ))}
            </Card>
          ) : (
            <View style={[styles.inlineEmpty, { backgroundColor: c.fill }]}>
              <FileText color={c.tertiaryLabel} size={22} />
              <Text style={[t.footnote, { color: c.secondaryLabel }]}>可以上传凭证图片或保存说明书链接</Text>
            </View>
          )}

          {asset.maintenanceRecords.length ? (
            <>
              <View style={styles.sectionHeaderRow}>
                <View>
                  <Text style={[t.headline, { color: c.label }]}>维护记录</Text>
                  <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>不可修改的完成历史</Text>
                </View>
              </View>
              <Card style={styles.listCard}>
                {asset.maintenanceRecords.map((record) => {
                  const plan = asset.maintenancePlans.find((entry) => entry.id === record.planId);
                  return (
                    <View key={record.id} style={[styles.recordRow, { borderBottomColor: c.separator }]}>
                      <CheckCircle2 color={c.green} size={18} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]}>{plan?.title ?? '维护完成'}</Text>
                        <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>{new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date(record.performedAt))} · {record.performedBy.name}{record.cost ? ` · ¥${Number(record.cost)}` : ''}</Text>
                        <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>下次日期推进到 {dateLabel(record.nextDueDateAfter)}</Text>
                        {record.note ? <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 5 }]}>{record.note}</Text> : null}
                      </View>
                    </View>
                  );
                })}
              </Card>
            </>
          ) : null}
        </ScrollView>
      )}

      {asset && documentOpen ? <DocumentForm asset={asset} onClose={() => setDocumentOpen(false)} onSaved={() => { setDocumentOpen(false); setMessage({ text: '资产资料已保存', type: 'success' }); }} /> : null}
      {asset && planOpen ? <PlanForm asset={asset} onClose={() => setPlanOpen(false)} onSaved={() => { setPlanOpen(false); setMessage({ text: '维护计划已创建', type: 'success' }); }} /> : null}
      {asset && completingPlan ? <CompletionForm asset={asset} plan={completingPlan} onClose={() => setCompletingPlan(null)} onSaved={(value) => { setCompletingPlan(null); setMessage({ text: value, type: 'success' }); }} /> : null}
      <ConfirmDialog
        loading={removeDocument.isPending}
        message="只删除这条资料记录，不会修改资产和维护历史。"
        onCancel={() => setPendingDocument(null)}
        onConfirm={() => {
          if (!pendingDocument || !asset) return;
          removeDocument.mutate(
            { assetId: asset.id, documentId: pendingDocument.id },
            {
              onSuccess: () => {
                setPendingDocument(null);
                setMessage({ text: '资料记录已删除', type: 'success' });
              },
              onError: (error) => {
                setPendingDocument(null);
                setMessage({
                  text: error instanceof Error ? error.message : '删除资料失败',
                  type: 'error',
                });
              },
            },
          );
        }}
        title={pendingDocument ? `删除「${pendingDocument.title}」？` : '删除资料？'}
        visible={Boolean(pendingDocument)}
      />
      <ConfirmDialog
        confirmLabel={asset?.status === 'active' ? '确认停用' : '恢复使用'}
        destructive={asset?.status === 'active'}
        loading={upsert.isPending}
        message={asset?.status === 'active' ? '停用后保留全部档案和历史，并取消相关待发送提醒。' : '恢复后可以继续添加维护计划和设置提醒。'}
        onCancel={() => setStatusConfirm(false)}
        onConfirm={() => void changeStatus()}
        title={asset?.status === 'active' ? '停用这个资产？' : '恢复这个资产？'}
        visible={statusConfirm}
      />
    </Sheet>
  );
}

function AssetCard({ asset, onOpen }: { asset: HomeAsset; onOpen: () => void }) {
  const c = useTheme();
  const nextPlan = asset.maintenancePlans
    .filter((plan) => plan.isEnabled)
    .sort((left, right) => left.nextDueDate.localeCompare(right.nextDueDate))[0];
  const due = nextPlan ? dueState(nextPlan.nextDueDate) : null;
  return (
    <Pressable accessibilityRole="button" onPress={onOpen} style={styles.assetCell}>
      {({ pressed }) => (
        <Card style={[styles.assetCard, { backgroundColor: pressed ? c.cardPressed : c.card }]}>
          <View style={styles.assetCardTop}>
            <View style={[styles.assetMark, { backgroundColor: asset.status === 'active' ? c.tintSoft : c.fill }]}>
              <Text style={[t.headline, { color: asset.status === 'active' ? c.tint : c.secondaryLabel }]}>{CATEGORY_META[asset.category].short}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={2} style={[t.headline, { color: c.label }]}>{asset.name}</Text>
              <Text numberOfLines={1} style={[t.caption, { color: c.secondaryLabel, marginTop: 4 }]}>{[CATEGORY_META[asset.category].label, asset.location, asset.brand].filter(Boolean).join(' · ')}</Text>
            </View>
            <ChevronRight color={c.tertiaryLabel} size={18} />
          </View>
          <View style={[styles.assetCardBottom, { borderTopColor: c.separator }]}>
            {nextPlan && due ? (
              <>
                <CalendarClock color={due.urgent ? c.red : c.orange} size={16} />
                <Text numberOfLines={1} style={[t.footnote, { color: due.urgent ? c.red : c.secondaryLabel, flex: 1 }]}>{nextPlan.title} · {due.label}</Text>
              </>
            ) : (
              <>
                <Wrench color={c.tertiaryLabel} size={16} />
                <Text style={[t.footnote, { color: c.secondaryLabel, flex: 1 }]}>暂无维护计划</Text>
              </>
            )}
            <Text style={[t.caption, { color: c.tertiaryLabel }]}>{asset.documents.length} 份资料</Text>
          </View>
        </Card>
      )}
    </Pressable>
  );
}

export default function AssetsScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const params = useLocalSearchParams<{ assetId?: string }>();
  const parameterAssetId = firstParam(params.assetId);
  const { data: assets, isLoading, error } = useAssets('all');
  const [status, setStatus] = useState<'active' | 'all'>('active');
  const [category, setCategory] = useState<AssetCategory | 'all'>('all');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [editingAsset, setEditingAsset] = useState<HomeAsset | null | 'new'>(null);

  useEffect(() => {
    if (parameterAssetId) setSelectedAssetId(parameterAssetId);
  }, [parameterAssetId]);

  const activeAssets = assets?.filter((asset) => asset.status === 'active') ?? [];
  const duePlans = activeAssets.flatMap((asset) =>
    asset.maintenancePlans.filter(
      (plan) => plan.isEnabled && plan.nextDueDate <= todayStr(30),
    ),
  );
  const visibleAssets = useMemo(
    () =>
      (assets ?? []).filter(
        (asset) =>
          (status === 'all' || asset.status === 'active') &&
          (category === 'all' || asset.category === category),
      ),
    [assets, category, status],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <PageContainer style={[styles.page, desktop && styles.pageDesktop]}>
        <View style={styles.pageHeader}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[t.largeTitle, { color: c.label }]}>家庭资产</Text>
            <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 4 }]}>家电、家具、设备和维护资料</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => setEditingAsset('new')}
            style={[styles.addButton, { backgroundColor: c.tint }]}
          >
            <Plus color="#FFFFFF" size={19} />
            <Text style={[t.subhead, { color: '#FFFFFF', fontWeight: '700' }]}>新增资产</Text>
          </Pressable>
        </View>

        <View style={[styles.summaryBand, { borderColor: c.separator }]}>
          <View style={styles.summaryItem}>
            <Text style={[t.title2, { color: c.label }]}>{activeAssets.length}</Text>
            <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>使用中</Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: c.separator }]} />
          <View style={styles.summaryItem}>
            <Text style={[t.title2, { color: duePlans.length ? c.orange : c.label }]}>{duePlans.length}</Text>
            <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>30 天内维护</Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: c.separator }]} />
          <View style={styles.summaryItem}>
            <Text style={[t.title2, { color: c.label }]}>{activeAssets.reduce((sum, asset) => sum + asset.documents.length, 0)}</Text>
            <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>资料</Text>
          </View>
        </View>

        <View style={styles.controls}>
          <View style={{ width: 220, maxWidth: '100%' }}>
            <Segmented
              onChange={setStatus}
              options={[
                { label: '使用中', value: 'active' as const },
                { label: '全部', value: 'all' as const },
              ]}
              value={status}
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chips}>
              {(['all', ...Object.keys(CATEGORY_META)] as (AssetCategory | 'all')[]).map((value) => {
                const selected = category === value;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={value}
                    onPress={() => setCategory(value)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: selected ? c.tintSoft : c.card,
                        borderColor: selected ? c.tint : c.separator,
                      },
                    ]}
                  >
                    <Text style={[t.footnote, { color: selected ? c.tint : c.secondaryLabel, fontWeight: '700' }]}>{value === 'all' ? '全部分类' : CATEGORY_META[value].label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </View>

        <ScrollView contentContainerStyle={styles.assetGrid} showsVerticalScrollIndicator={false}>
          {isLoading ? <ActivityIndicator color={c.tint} style={{ marginTop: 60 }} /> : null}
          {error ? <Card style={styles.errorCard}><Text style={[t.subhead, { color: c.red }]}>资产加载失败，请检查 API 服务</Text></Card> : null}
          {!isLoading && !error && !visibleAssets.length ? (
            <View style={{ width: '100%' }}>
              <EmptyState emoji="🏠" title="还没有家庭资产" hint="从常用家电或需要定期维护的设备开始记录" />
            </View>
          ) : null}
          {visibleAssets.map((asset) => (
            <AssetCard asset={asset} key={asset.id} onOpen={() => setSelectedAssetId(asset.id)} />
          ))}
        </ScrollView>
      </PageContainer>

      {editingAsset ? (
        <AssetEditor
          asset={editingAsset === 'new' ? null : editingAsset}
          key={editingAsset === 'new' ? 'new' : editingAsset.id}
          onClose={() => setEditingAsset(null)}
          onSaved={(saved) => {
            setEditingAsset(null);
            setSelectedAssetId(saved.id);
          }}
        />
      ) : null}
      {selectedAssetId ? (
        <AssetDetail
          assetId={selectedAssetId}
          key={selectedAssetId}
          onClose={() => setSelectedAssetId(null)}
          onEdit={(asset) => {
            setSelectedAssetId(null);
            setEditingAsset(asset);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingTop: 12 },
  pageDesktop: { paddingTop: 26 },
  pageHeader: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  addButton: { minHeight: 44, borderRadius: radius.sm, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 7 },
  summaryBand: { marginTop: 18, minHeight: 82, borderTopWidth: 1, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center' },
  summaryItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  summaryDivider: { width: 1, height: 38 },
  controls: { marginTop: 18, gap: 12 },
  assetGrid: { paddingTop: 16, paddingBottom: 40, flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  assetCell: { width: 280, minWidth: 0, flexGrow: 1, maxWidth: 440 },
  assetCard: { minHeight: 132, padding: 14 },
  assetCardTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  assetMark: { width: 42, height: 42, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  assetCardBottom: { marginTop: 14, paddingTop: 11, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 7 },
  errorCard: { width: '100%', padding: 18 },
  overlay: { flex: 1, backgroundColor: 'rgba(17, 25, 20, 0.42)', alignItems: 'center', justifyContent: 'center', padding: 14 },
  sheet: { width: '100%', maxWidth: 680, maxHeight: '92%', borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  sheetHeader: { minHeight: 76, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconButton: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  formContent: { paddingHorizontal: 18, paddingBottom: 20, gap: 16 },
  detailContent: { paddingHorizontal: 18, paddingBottom: 24 },
  field: { flex: 1, minWidth: 210, gap: 7 },
  fieldLabel: { fontWeight: '700' },
  twoColumns: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  input: { minHeight: 46, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10 },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 36, borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  checkboxRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 9 },
  checkbox: { width: 24, height: 24, borderRadius: radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  uploadButton: { minHeight: 52, borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 },
  forecast: { borderRadius: radius.sm, padding: 14 },
  detailActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  secondaryButton: { minHeight: 38, borderRadius: radius.sm, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6 },
  messageBox: { borderRadius: radius.sm, padding: 11, marginBottom: 14 },
  infoBand: { borderRadius: radius.sm, padding: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  infoCell: { width: '46%', flexGrow: 1, minWidth: 125, padding: 5 },
  identityCard: { marginTop: 12, padding: 13 },
  sectionHeaderRow: { minHeight: 58, marginTop: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  smallAdd: { minHeight: 36, borderRadius: radius.sm, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5 },
  stack: { gap: 9 },
  planCard: { padding: 13 },
  planTop: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  rowIcon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  dueBadge: { minHeight: 28, borderRadius: radius.sm, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  planActions: { marginTop: 11, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  planAction: { minHeight: 34, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
  inlineEmpty: { minHeight: 62, borderRadius: radius.sm, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  listCard: { overflow: 'hidden' },
  documentRow: { minHeight: 66, paddingHorizontal: 11, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 9 },
  recordRow: { minHeight: 72, paddingHorizontal: 13, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
});
