import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  FileText,
  MapPin,
  Package,
  Pencil,
  ReceiptText,
  ShieldCheck,
  ShieldX,
  Sparkles,
  Wrench,
} from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  PageContainer,
  useLayoutMode,
} from '../../components/app-shell';
import { Card, PressableScale } from '../../components/ui';
import { photoUri } from '../../lib/api';
import { parseDate, todayStr } from '../../lib/date';
import {
  useAsset,
  useAssetDocumentAccess,
} from '../../lib/queries';
import { useSession } from '../../lib/session';
import { radius, type as t, useTheme } from '../../lib/theme';
import type {
  AssetCategory,
  AssetDocumentType,
  MaintenancePlan,
} from '../../lib/types';

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  appliance: '家电',
  furniture: '家具',
  electronics: '数码',
  tool: '工具',
  subscription: '订阅',
  other: '其他',
};

const WARRANTY_CATEGORIES: AssetCategory[] = [
  'appliance',
  'electronics',
  'tool',
];

const DOCUMENT_LABELS: Record<AssetDocumentType, string> = {
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

function dayDifference(value: string) {
  return Math.round(
    (parseDate(value).getTime() - parseDate(todayStr()).getTime()) / 86_400_000,
  );
}

function warrantyState(expiresOn: string | null) {
  if (!expiresOn) {
    return {
      label: '未记录保修期限',
      detail: '可在资产档案中补充保修到期日',
      tone: 'neutral' as const,
    };
  }
  const days = dayDifference(expiresOn);
  if (days < 0) {
    return {
      label: '保修已到期',
      detail: `已过期 ${Math.abs(days)} 天`,
      tone: 'expired' as const,
    };
  }
  if (days === 0) {
    return {
      label: '保修今天到期',
      detail: '如需报修，请尽快联系售后',
      tone: 'warning' as const,
    };
  }
  return {
    label: '在保修期内',
    detail: `还剩 ${days} 天`,
    tone: days <= 30 ? ('warning' as const) : ('active' as const),
  };
}

function renewalState(renewsOn: string | null) {
  if (!renewsOn) {
    return {
      label: '未记录续费日期',
      detail: '可在资产档案中补充下次续费日期',
      tone: 'neutral' as const,
    };
  }
  const days = dayDifference(renewsOn);
  if (days < 0) {
    return {
      label: '续费日期已过',
      detail: `已过期 ${Math.abs(days)} 天，请确认订阅状态`,
      tone: 'expired' as const,
    };
  }
  if (days === 0) {
    return {
      label: '今天续费',
      detail: '请确认是否续费或取消订阅',
      tone: 'warning' as const,
    };
  }
  return {
    label: `${days} 天后续费`,
    detail: days <= 14 ? '订阅即将续费' : '订阅仍在有效期内',
    tone: days <= 14 ? ('warning' as const) : ('active' as const),
  };
}

function maintenanceState(plan: MaintenancePlan) {
  if (!plan.isEnabled) return { label: '已停用', urgent: false };
  const days = dayDifference(plan.nextDueDate);
  if (days < 0) return { label: `逾期 ${Math.abs(days)} 天`, urgent: true };
  if (days === 0) return { label: '今天到期', urgent: true };
  if (days <= 30) return { label: `${days} 天后`, urgent: false };
  return { label: dateLabel(plan.nextDueDate), urgent: false };
}

function InfoItem({ label, value }: { label: string; value: string }) {
  const c = useTheme();
  return (
    <View style={styles.infoItem}>
      <Text style={[t.caption, { color: c.secondaryLabel }]}>{label}</Text>
      <Text style={[t.subhead, styles.infoValue, { color: c.label }]}>
        {value}
      </Text>
    </View>
  );
}

export default function AssetDetailScreen() {
  const c = useTheme();
  const layout = useLayoutMode();
  const compact = layout === 'compact';
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = firstParam(params.id);
  const { member, ready } = useSession();
  const { data: asset, isLoading, error } = useAsset(
    id ?? null,
    ready && Boolean(member && id),
  );
  const accessDocument = useAssetDocumentAccess();
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);

  const warranty = useMemo(
    () => warrantyState(asset?.warrantyExpiresOn ?? null),
    [asset?.warrantyExpiresOn],
  );
  const renewal = useMemo(
    () => renewalState(asset?.renewsOn ?? null),
    [asset?.renewsOn],
  );

  if (!ready) return null;
  if (!member) return <Redirect href="/login" />;

  const openDocument = async (documentId: string) => {
    setOpeningDocumentId(documentId);
    setDocumentError(null);
    try {
      const access = await accessDocument.mutateAsync(documentId);
      await Linking.openURL(photoUri(access.url) ?? access.url);
    } catch (openError) {
      setDocumentError(
        openError instanceof Error ? openError.message : '资料暂时无法打开，请稍后重试',
      );
    } finally {
      setOpeningDocumentId(null);
    }
  };

  const WarrantyIcon =
    warranty.tone === 'active'
      ? ShieldCheck
      : warranty.tone === 'expired'
        ? ShieldX
        : CircleAlert;
  const expiry = asset?.category === 'subscription' ? renewal : warranty;
  const expiryColors =
    expiry.tone === 'active'
      ? { background: c.greenSoft, foreground: c.green }
      : expiry.tone === 'warning'
        ? { background: c.orangeSoft, foreground: c.orange }
        : expiry.tone === 'expired'
          ? { background: c.redSoft, foreground: c.red }
          : { background: c.fill, foreground: c.secondaryLabel };
  const showExpiry =
    asset?.category === 'subscription' ||
    Boolean(asset && WARRANTY_CATEGORIES.includes(asset.category));
  const ExpiryIcon =
    asset?.category === 'subscription' ? CalendarClock : WarrantyIcon;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bg }]} edges={['top', 'bottom']}>
      <PageContainer maxWidth={840} style={styles.page}>
        <View style={styles.header}>
          <PressableScale
            accessibilityLabel="返回家庭资产"
            haptic={false}
            onPress={() => router.back()}
            style={[styles.iconButton, { backgroundColor: c.card }]}
            testID="asset-detail-back"
          >
            <ArrowLeft color={c.label} size={20} />
          </PressableScale>
          <View style={styles.headerCopy}>
            <Text style={[t.footnote, styles.eyebrow, { color: c.tint }]}>家庭资产</Text>
            <Text
              accessibilityRole="header"
              style={[compact ? t.title1 : t.largeTitle, { color: c.label }]}
              testID="asset-detail-name"
            >
              {asset?.name ?? '资产详情'}
            </Text>
          </View>
          {asset ? (
            <PressableScale
              accessibilityLabel={`管理资产${asset.name}`}
              haptic={false}
              onPress={() =>
                router.push({
                  pathname: '/home-assets',
                  params: { assetId: asset.id },
                })
              }
              style={[styles.iconButton, { backgroundColor: c.card }]}
              testID="asset-detail-manage"
            >
              <Pencil color={c.tint} size={19} />
            </PressableScale>
          ) : null}
        </View>

        {isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={c.tint} />
            <Text style={[t.subhead, { color: c.secondaryLabel }]}>正在读取资产档案</Text>
          </View>
        ) : error || !asset ? (
          <Card style={styles.errorCard}>
            <CircleAlert color={c.red} size={24} />
            <View style={styles.flexCopy}>
              <Text style={[t.headline, { color: c.label }]}>资产详情加载失败</Text>
              <Text style={[t.footnote, styles.errorCopy, { color: c.secondaryLabel }]}>
                {error instanceof Error ? error.message : '这项资产可能已被移除'}
              </Text>
            </View>
          </Card>
        ) : (
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.identityRow}>
              <View style={[styles.assetIcon, { backgroundColor: c.tintSoft }]}>
                <Package color={c.tint} size={24} />
              </View>
              <View style={styles.flexCopy}>
                <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]}>
                  {CATEGORY_LABELS[asset.category]}
                  {asset.status === 'retired' ? ' · 已停用' : ' · 使用中'}
                </Text>
                <View style={styles.metaLine}>
                  <MapPin color={c.tertiaryLabel} size={15} />
                  <Text style={[t.footnote, styles.flexCopy, { color: c.secondaryLabel }]}>
                    {asset.location ?? '未记录存放位置'}
                  </Text>
                </View>
              </View>
            </View>

            {showExpiry ? (
              <Card
                style={[
                  styles.warrantyCard,
                  { backgroundColor: expiryColors.background },
                ]}
              >
                <View style={styles.warrantyTop}>
                  <View style={[styles.warrantyIcon, { backgroundColor: c.card }]}>
                    <ExpiryIcon color={expiryColors.foreground} size={22} />
                  </View>
                  <View style={styles.flexCopy}>
                    <Text
                      style={[t.headline, { color: expiryColors.foreground }]}
                      testID={
                        asset.category === 'subscription'
                          ? 'asset-renewal-status'
                          : 'asset-warranty-status'
                      }
                    >
                      {expiry.label}
                    </Text>
                    <Text
                      style={[
                        t.footnote,
                        styles.warrantyDetail,
                        { color: expiryColors.foreground },
                      ]}
                    >
                      {expiry.detail}
                    </Text>
                  </View>
                </View>
                <View style={[styles.warrantyDate, { borderTopColor: c.separator }]}>
                  <Text style={[t.caption, { color: c.secondaryLabel }]}>
                    {asset.category === 'subscription' ? '续费日期' : '保修到期日'}
                  </Text>
                  <Text style={[t.subhead, styles.flexCopy, { color: c.label, fontWeight: '700' }]}>
                    {dateLabel(
                      asset.category === 'subscription'
                        ? asset.renewsOn
                        : asset.warrantyExpiresOn,
                    )}
                  </Text>
                </View>
              </Card>
            ) : null}

            <PressableScale
              accessibilityLabel={`向小管家询问${asset.name}`}
              haptic={false}
              onPress={() =>
                router.push({
                  pathname: '/assistant',
                  params: {
                    route: `/asset/${asset.id}`,
                    entityType: 'asset',
                    entityId: asset.id,
                  },
                })
              }
              style={[styles.assistantEntry, { backgroundColor: c.tintSoft }]}
              testID="asset-ask-assistant"
            >
              <View style={[styles.assistantIcon, { backgroundColor: c.card }]}>
                <Sparkles color={c.tint} size={18} />
              </View>
              <Text style={[t.subhead, styles.assistantCopy, { color: c.tint }]}>
                问小管家这个资产
              </Text>
              <ChevronRight color={c.tint} size={18} />
            </PressableScale>

            <View style={styles.sectionHeading}>
              <ReceiptText color={c.secondaryLabel} size={19} />
              <Text style={[t.headline, styles.flexCopy, { color: c.label }]}>资产信息</Text>
            </View>
            <Card style={[styles.infoCard, compact && styles.infoCardCompact]}>
              <InfoItem label="品牌" value={asset.brand ?? '未记录'} />
              <InfoItem label="型号" value={asset.model ?? '未记录'} />
              <InfoItem label="序列号" value={asset.serialNumber ?? '未记录'} />
              <InfoItem label="购入日期" value={dateLabel(asset.purchaseDate)} />
              <InfoItem
                label="购入价格"
                value={asset.purchasePrice ? `¥${Number(asset.purchasePrice).toLocaleString('zh-CN')}` : '未记录'}
              />
              <InfoItem label="当前状态" value={asset.status === 'active' ? '使用中' : '已停用'} />
            </Card>
            {asset.note ? (
              <Card style={styles.noteCard}>
                <Text style={[t.caption, { color: c.secondaryLabel }]}>备注</Text>
                <Text style={[t.subhead, styles.noteCopy, { color: c.label }]}>{asset.note}</Text>
              </Card>
            ) : null}

            <View style={styles.sectionHeading}>
              <Wrench color={c.secondaryLabel} size={19} />
              <View style={styles.flexCopy}>
                <Text style={[t.headline, { color: c.label }]}>维保计划</Text>
                <Text style={[t.caption, styles.sectionSubtitle, { color: c.secondaryLabel }]}>
                  {asset.maintenancePlans.length} 项周期安排
                </Text>
              </View>
            </View>
            {asset.maintenancePlans.length ? (
              <View style={styles.stack}>
                {asset.maintenancePlans.map((plan) => {
                  const due = maintenanceState(plan);
                  return (
                    <Card key={plan.id} style={styles.planCard}>
                      <View style={styles.planTop}>
                        <View
                          style={[
                            styles.planIcon,
                            { backgroundColor: due.urgent ? c.redSoft : c.orangeSoft },
                          ]}
                        >
                          <CalendarClock color={due.urgent ? c.red : c.orange} size={19} />
                        </View>
                        <View style={styles.flexCopy}>
                          <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]}>
                            {plan.title}
                          </Text>
                          <Text style={[t.footnote, styles.planMeta, { color: c.secondaryLabel }]}>
                            每 {plan.frequencyDays} 天 · 下次 {dateLabel(plan.nextDueDate)}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.statusBadge,
                            { backgroundColor: due.urgent ? c.redSoft : c.orangeSoft },
                          ]}
                        >
                          <Text
                            style={[
                              t.caption,
                              { color: due.urgent ? c.red : c.orange, fontWeight: '700' },
                            ]}
                          >
                            {due.label}
                          </Text>
                        </View>
                      </View>
                      {plan.note ? (
                        <Text style={[t.footnote, styles.planNote, { color: c.secondaryLabel }]}>
                          {plan.note}
                        </Text>
                      ) : null}
                    </Card>
                  );
                })}
              </View>
            ) : (
              <View style={[styles.emptyBand, { backgroundColor: c.fill }]}>
                <Wrench color={c.tertiaryLabel} size={18} />
                <Text style={[t.footnote, styles.flexCopy, { color: c.secondaryLabel }]}>暂无维保计划</Text>
              </View>
            )}

            <View style={styles.sectionHeading}>
              <FileText color={c.secondaryLabel} size={19} />
              <View style={styles.flexCopy}>
                <Text style={[t.headline, { color: c.label }]}>关联文档</Text>
                <Text style={[t.caption, styles.sectionSubtitle, { color: c.secondaryLabel }]}>
                  {asset.documents.length} 份资料
                </Text>
              </View>
            </View>
            {documentError ? (
              <View style={[styles.messageBand, { backgroundColor: c.redSoft }]}>
                <CircleAlert color={c.red} size={18} />
                <Text style={[t.footnote, styles.flexCopy, { color: c.red }]}>{documentError}</Text>
              </View>
            ) : null}
            {asset.documents.length ? (
              <View style={styles.stack}>
                {asset.documents.map((document) => {
                  const opening = openingDocumentId === document.id;
                  return (
                    <PressableScale
                      accessibilityLabel={`打开资料${document.title}`}
                      disabled={opening}
                      haptic={false}
                      key={document.id}
                      onPress={() => void openDocument(document.id)}
                      style={[styles.documentRow, { backgroundColor: c.card, borderColor: c.separator }]}
                      testID={`asset-document-${document.id}`}
                    >
                      <View style={[styles.documentIcon, { backgroundColor: c.blueSoft }]}>
                        {opening ? (
                          <ActivityIndicator color={c.blue} size="small" />
                        ) : (
                          <FileText color={c.blue} size={19} />
                        )}
                      </View>
                      <View style={styles.flexCopy}>
                        <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]}>
                          {document.title}
                        </Text>
                        <Text style={[t.caption, styles.documentMeta, { color: c.secondaryLabel }]}>
                          {DOCUMENT_LABELS[document.type]} · {document.createdBy.name}
                        </Text>
                      </View>
                      <ExternalLink color={c.tertiaryLabel} size={18} />
                    </PressableScale>
                  );
                })}
              </View>
            ) : (
              <View style={[styles.emptyBand, { backgroundColor: c.fill }]}>
                <FileText color={c.tertiaryLabel} size={18} />
                <Text style={[t.footnote, styles.flexCopy, { color: c.secondaryLabel }]}>暂无关联资料</Text>
              </View>
            )}
          </ScrollView>
        )}
      </PageContainer>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  page: { flex: 1, paddingTop: 12 },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { fontWeight: '700' },
  iconButton: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  centerState: { flex: 1, minHeight: 240, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorCard: { marginTop: 24, padding: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  errorCopy: { marginTop: 4, lineHeight: 19 },
  content: { paddingTop: 16, paddingBottom: 32 },
  flexCopy: { flex: 1, minWidth: 0 },
  identityRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12 },
  assetIcon: { width: 48, height: 48, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  metaLine: { marginTop: 5, flexDirection: 'row', alignItems: 'center', gap: 5 },
  warrantyCard: { marginTop: 16, padding: 16 },
  warrantyTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  warrantyIcon: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  warrantyDetail: { marginTop: 3, lineHeight: 19 },
  warrantyDate: { marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 12 },
  assistantEntry: { minHeight: 52, marginTop: 12, borderRadius: radius.md, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  assistantIcon: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  assistantCopy: { flex: 1, minWidth: 0, fontWeight: '700' },
  sectionHeading: { minHeight: 58, paddingTop: 20, flexDirection: 'row', alignItems: 'center', gap: 9 },
  sectionSubtitle: { marginTop: 2 },
  infoCard: { padding: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  infoCardCompact: { flexDirection: 'column' },
  infoItem: { flex: 1, minWidth: 180 },
  infoValue: { marginTop: 4, fontWeight: '700' },
  noteCard: { marginTop: 10, padding: 14 },
  noteCopy: { marginTop: 5, lineHeight: 22 },
  stack: { gap: 9 },
  planCard: { padding: 14 },
  planTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  planIcon: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  planMeta: { marginTop: 4, lineHeight: 19 },
  statusBadge: { minHeight: 28, maxWidth: 112, borderRadius: radius.sm, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  planNote: { marginTop: 10, lineHeight: 19 },
  emptyBand: { minHeight: 56, borderRadius: radius.sm, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 9 },
  messageBand: { minHeight: 48, marginBottom: 9, borderRadius: radius.sm, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9 },
  documentRow: { minHeight: 68, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  documentIcon: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  documentMeta: { marginTop: 3 },
});
