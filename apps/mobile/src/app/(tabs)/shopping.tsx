import * as Haptics from 'expo-haptics';
import { Minus, PackageCheck, Plus, Trash2, X } from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { InventoryPanel } from '../../components/inventory-panel';
import {
  AdaptiveDialog,
  Card,
  ConfirmDialog,
  EmptyState,
  IconButton,
  PressableScale,
  SectionHeader,
  Segmented,
} from '../../components/ui';
import { todayStr } from '../../lib/date';
import {
  useAddManualShoppingItem,
  useCheckShoppingItem,
  useDeleteShoppingItem,
  useConfirmShoppingReceipt,
  useInventory,
  useShoppingList,
  useShoppingInventoryPreview,
} from '../../lib/queries';
import { radius, type as t, useTheme } from '../../lib/theme';
import type { ShoppingItem } from '../../lib/types';

function quantityLabel(value: string | null) {
  return value == null ? '0' : String(Number(value));
}

function ItemRow({
  item,
  onConfirmStock,
  onDelete,
}: {
  item: ShoppingItem;
  onConfirmStock: () => void;
  onDelete: () => void;
}) {
  const c = useTheme();
  const check = useCheckShoppingItem();
  const name = item.ingredient?.name ?? item.customName ?? '未知';
  const hasInventoryBreakdown =
    (item.source === 'auto' || item.source === 'maintenance') &&
    item.requiredQty != null &&
    item.availableQty != null;
  const unit = item.unit ? ` ${item.unit}` : '';
  const inventoryBreakdown = hasInventoryBreakdown
    ? `${item.source === 'maintenance' ? '资产维护 · ' : ''}需要 ${quantityLabel(item.requiredQty)}${unit} · 库存 ${quantityLabel(item.availableQty)}${unit} · 建议买 ${quantityLabel(item.totalQty)}${unit}`
    : null;

  return (
    <View style={[styles.itemRow, { borderBottomColor: c.separator }]}>
      <PressableScale
        accessibilityLabel={`${item.checked ? '取消勾选' : '勾选'}${name}`}
        haptic={false}
        onPress={() => {
          void Haptics.impactAsync(
            item.checked
              ? Haptics.ImpactFeedbackStyle.Light
              : Haptics.ImpactFeedbackStyle.Medium,
          );
          check.mutate({ id: item.id, checked: !item.checked });
        }}
        style={styles.itemToggle}
      >
        <View
          style={[
            styles.checkbox,
            {
              borderColor: item.checked ? c.green : c.fillStrong,
              backgroundColor: item.checked ? c.green : 'transparent',
            },
          ]}
        >
          {item.checked ? (
            <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '700' }}>✓</Text>
          ) : null}
        </View>
        <View style={styles.itemText}>
          <Text
            style={[
              t.body,
              {
                color: item.checked ? c.tertiaryLabel : c.label,
                textDecorationLine: item.checked ? 'line-through' : 'none',
              },
            ]}
          >
            {name}
          </Text>
          {hasInventoryBreakdown ? (
            <Text
              style={[
                t.caption,
                styles.itemBreakdown,
                { color: item.checked ? c.tertiaryLabel : c.secondaryLabel },
              ]}
            >
              {inventoryBreakdown}
            </Text>
          ) : null}
        </View>
        {!hasInventoryBreakdown && item.totalQty ? (
          <Text style={[t.subhead, { color: c.secondaryLabel }]}>
            {Number(item.totalQty)} {item.unit ?? ''}
          </Text>
        ) : null}
      </PressableScale>
      {item.inventoryConfirmation ? (
        <View
          style={[
            styles.stockStatus,
            {
              backgroundColor: item.inventoryConfirmation.reversedAt
                ? c.fill
                : c.greenSoft,
            },
          ]}
        >
          <Text
            style={[
              t.caption,
              {
                color: item.inventoryConfirmation.reversedAt
                  ? c.secondaryLabel
                  : c.green,
                fontWeight: '700',
              },
            ]}
          >
            {item.inventoryConfirmation.reversedAt
              ? '入库已撤销'
              : `已入库 +${Number(item.inventoryConfirmation.delta)}`}
          </Text>
        </View>
      ) : item.checked ? (
        <PressableScale
          accessibilityLabel={`确认${name}入库`}
          haptic={false}
          onPress={onConfirmStock}
          style={[styles.stockButton, { backgroundColor: c.greenSoft }]}
        >
          <PackageCheck color={c.green} size={16} />
          <Text style={[t.caption, { color: c.green, fontWeight: '700' }]}>入库</Text>
        </PressableScale>
      ) : null}
      <PressableScale
        accessibilityLabel={`删除${name}`}
        haptic={false}
        onPress={onDelete}
        style={styles.deleteButton}
      >
        <Trash2 color={c.red} size={17} />
      </PressableScale>
    </View>
  );
}

function StockConfirmDialog({
  item,
  onClose,
  onSuccess,
}: {
  item: ShoppingItem;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const c = useTheme();
  const { data: inventory } = useInventory();
  const [selectedInventoryId, setSelectedInventoryId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const automaticInventoryId =
    item.inventoryItemId ??
    inventory?.find(
      (candidate) =>
        candidate.ingredientId === item.ingredient?.id &&
        candidate.unit === item.unit,
    )?.id;
  const effectiveInventoryId = selectedInventoryId ?? automaticInventoryId ?? null;
  const preview = useShoppingInventoryPreview(
    item.id,
    effectiveInventoryId,
    true,
  );
  const confirm = useConfirmShoppingReceipt();

  const data = preview.data;
  const name = item.ingredient?.name ?? item.customName ?? '这件物品';
  const selected = data?.selectedInventoryItem;
  const submit = async () => {
    if (!data?.canConfirm || !selected) return;
    setError(null);
    try {
      const result = await confirm.mutateAsync({
        shoppingItemId: item.id,
        inventoryItemId: selected.id,
      });
      const transaction = result.transactions[0];
      onSuccess(
        result.alreadyConfirmed
          ? `「${name}」已经确认入库，没有重复增加库存`
          : `已入库 ${Number(transaction.delta)} ${transaction.unit}，当前 ${Number(transaction.quantityAfter)} ${transaction.unit}`,
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '入库失败');
    }
  };

  return (
    <AdaptiveDialog
      accessibilityLabel={`确认${name}入库`}
      maxWidth={480}
      onClose={onClose}
      visible
    >
          <View style={styles.stockDialogHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.title2, { color: c.label }]}>确认「{name}」入库</Text>
              <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>
                采购数量 {quantityLabel(item.totalQty)} {item.unit ?? ''}
              </Text>
            </View>
            <IconButton
              accessibilityLabel="关闭"
              backgroundColor="transparent"
              color={c.secondaryLabel}
              icon={X}
              onPress={onClose}
            />
          </View>

          {preview.isLoading ? <ActivityIndicator style={{ marginVertical: 28 }} /> : null}

          {!preview.isLoading && data ? (
            <ScrollView
              contentContainerStyle={styles.stockDialogContent}
              showsVerticalScrollIndicator={false}
              style={styles.stockDialogScroll}
            >
              <Text style={[t.footnote, { color: c.secondaryLabel, fontWeight: '700' }]}>库存项</Text>
              {data.candidates.length ? (
                <View style={styles.stockCandidates}>
                  {data.candidates.map((candidate) => {
                    const active = selected?.id === candidate.id;
                    return (
                      <Pressable
                        accessibilityLabel={`选择库存${candidate.name}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        key={candidate.id}
                        onPress={() => setSelectedInventoryId(candidate.id)}
                        style={[
                          styles.stockCandidate,
                          {
                            backgroundColor: active ? c.tintSoft : c.fill,
                            borderColor: active ? c.tint : c.separator,
                          },
                        ]}
                      >
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]}>
                            {candidate.name}
                          </Text>
                          <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>
                            当前 {Number(candidate.quantity)} {candidate.unit}
                          </Text>
                        </View>
                        {active ? <PackageCheck color={c.tint} size={18} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <View style={[styles.stockNotice, { backgroundColor: c.orangeSoft }]}>
                  <Text style={[t.footnote, { color: c.orange }]}>
                    没有相同单位的对应库存项，本项将暂不入库。
                  </Text>
                </View>
              )}

              {selected && data.quantityBefore != null && data.quantityAfter != null ? (
                <View style={[styles.stockForecast, { backgroundColor: c.greenSoft }]}>
                  <Text style={[t.footnote, { color: c.green, fontWeight: '700' }]}>预计变化</Text>
                  <Text style={[t.headline, { color: c.label, marginTop: 5 }]}>
                    {selected.name}：{data.quantityBefore} → {data.quantityAfter} {selected.unit}
                  </Text>
                </View>
              ) : null}

              {error ?? (preview.error instanceof Error ? preview.error.message : null) ? (
                <Text style={[t.footnote, { color: c.red }]}>
                  {error ?? (preview.error instanceof Error ? preview.error.message : '预览失败')}
                </Text>
              ) : null}
            </ScrollView>
          ) : null}

          <View style={styles.stockActions}>
            <Pressable
              accessibilityRole="button"
              disabled={confirm.isPending}
              onPress={onClose}
              style={[styles.stockAction, { backgroundColor: c.fill }]}
            >
              <Text style={[t.headline, { color: c.label }]}>暂不入库</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!data?.canConfirm || confirm.isPending}
              onPress={() => void submit()}
              style={[
                styles.stockAction,
                { backgroundColor: data?.canConfirm ? c.green : c.fillStrong },
              ]}
            >
              {confirm.isPending ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={[t.headline, { color: '#FFFFFF' }]}>确认入库</Text>
              )}
            </Pressable>
          </View>
    </AdaptiveDialog>
  );
}

export default function ShoppingScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const [view, setView] = useState<'shopping' | 'inventory'>('shopping');
  const [date, setDate] = useState(todayStr());
  const { data: items, isLoading } = useShoppingList(date);
  const addManual = useAddManualShoppingItem();
  const removeItem = useDeleteShoppingItem();
  const [pendingDelete, setPendingDelete] = useState<ShoppingItem | null>(null);
  const [stockingItem, setStockingItem] = useState<ShoppingItem | null>(null);
  const [manualName, setManualName] = useState('');
  const [manualQty, setManualQty] = useState('1');
  const [manualUnit, setManualUnit] = useState('份');
  const [manualMessage, setManualMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  const [stockMessage, setStockMessage] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, ShoppingItem[]>();
    for (const item of items ?? []) {
      const key =
        item.source === 'maintenance'
          ? '维护耗材'
          : (item.ingredient?.category ?? '手动添加');
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [items]);

  const total = items?.length ?? 0;
  const done = items?.filter((i) => i.checked).length ?? 0;

  const parsedManualQty = Number(manualQty);
  const manualValid =
    Boolean(manualName.trim()) &&
    Number.isFinite(parsedManualQty) &&
    parsedManualQty > 0 &&
    Boolean(manualUnit.trim());

  const adjustManualQty = (offset: number) => {
    const current = Number(manualQty) || 1;
    const next = Math.max(0.1, Math.round((current + offset) * 10) / 10);
    setManualQty(String(next));
  };

  const submitManual = async () => {
    const name = manualName.trim();
    const unit = manualUnit.trim();
    if (!manualValid) return;
    setManualMessage(null);
    try {
      await addManual.mutateAsync({
        date,
        customName: name,
        totalQty: parsedManualQty,
        unit,
      });
      setManualName('');
      setManualQty('1');
      setManualMessage({ text: `已添加「${name}」`, error: false });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setManualMessage({
        text: error instanceof Error ? error.message : '添加失败，请稍后再试',
        error: true,
      });
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <PageContainer
        maxWidth={900}
        style={[styles.page, desktop && styles.pageDesktop]}
      >
        <View style={styles.header}>
          <Text style={[t.largeTitle, { color: c.label }]}>采购与库存</Text>
          {view === 'shopping' && total > 0 ? (
            <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 2 }]}>
              已买 {done}/{total}
            </Text>
          ) : null}
        </View>

        <View style={styles.viewControl}>
          <Segmented
            onChange={setView}
            options={[
              { label: '购物清单', value: 'shopping' as const },
              { label: '家庭库存', value: 'inventory' as const },
            ]}
            value={view}
          />
        </View>

        {view === 'shopping' ? (
          <>
            <View style={styles.dateControl}>
              <DateSelector value={date} onChange={setDate} />
            </View>

            <ScrollView
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
        {isLoading ? <ActivityIndicator style={{ marginTop: 48 }} /> : null}

        {!isLoading && total === 0 ? (
          <EmptyState
            emoji="🧾"
            title="清单是空的"
            hint="在「菜单安排」接单后生成清单，或在下面手动添加"
          />
        ) : null}

        {groups.map(([category, list]) => (
          <View key={category}>
            <SectionHeader title={category} />
            <Card>
              {list.map((item) => (
                <ItemRow
                  item={item}
                  key={item.id}
                  onConfirmStock={() => {
                    setStockMessage(null);
                    setStockingItem(item);
                  }}
                  onDelete={() => setPendingDelete(item)}
                />
              ))}
            </Card>
          </View>
        ))}

        {stockMessage ? (
          <View style={[styles.manualMessage, { backgroundColor: c.greenSoft }]}>
            <Text style={[t.footnote, { color: c.green }]}>{stockMessage}</Text>
          </View>
        ) : null}

        <SectionHeader title="手动添加" />
        <Card style={[styles.manualForm, desktop && styles.manualFormDesktop]}>
          <TextInput
            accessibilityLabel="物品名称"
            style={[
              t.body,
              styles.manualName,
              { backgroundColor: c.fill, color: c.label },
            ]}
            placeholder="比如：垃圾袋、酱油"
            placeholderTextColor={c.tertiaryLabel}
            value={manualName}
            onChangeText={setManualName}
            returnKeyType="next"
          />

          <View style={styles.manualControls}>
            <View
              style={[
                styles.stepper,
                { backgroundColor: c.fill, borderColor: c.separator },
              ]}
            >
              <PressableScale
                haptic={false}
                accessibilityLabel="减少数量"
                disabled={parsedManualQty <= 0.1}
                onPress={() => adjustManualQty(-1)}
                style={styles.stepButton}
              >
                <Minus color={c.secondaryLabel} size={17} />
              </PressableScale>
              <TextInput
                accessibilityLabel="数量"
                keyboardType="decimal-pad"
                onChangeText={setManualQty}
                selectTextOnFocus
                style={[styles.quantityInput, t.subhead, { color: c.label }]}
                value={manualQty}
              />
              <PressableScale
                haptic={false}
                accessibilityLabel="增加数量"
                onPress={() => adjustManualQty(1)}
                style={styles.stepButton}
              >
                <Plus color={c.secondaryLabel} size={17} />
              </PressableScale>
            </View>

            <TextInput
              accessibilityLabel="单位"
              maxLength={8}
              onChangeText={setManualUnit}
              onSubmitEditing={() => void submitManual()}
              placeholder="单位"
              placeholderTextColor={c.tertiaryLabel}
              returnKeyType="done"
              style={[
                styles.unitInput,
                t.subhead,
                { backgroundColor: c.fill, color: c.label },
              ]}
              value={manualUnit}
            />

            <PressableScale
              accessibilityLabel="添加购物物品"
              disabled={!manualValid || addManual.isPending}
              onPress={() => void submitManual()}
              style={[
                styles.addBtn,
                { backgroundColor: manualValid ? c.tint : c.fill },
              ]}
            >
              {addManual.isPending ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Plus color={manualValid ? '#FFFFFF' : c.tertiaryLabel} size={20} />
              )}
            </PressableScale>
          </View>
        </Card>
        {manualMessage ? (
          <View
            style={[
              styles.manualMessage,
              { backgroundColor: manualMessage.error ? c.redSoft : c.tintSoft },
            ]}
          >
            <Text style={[t.footnote, { color: manualMessage.error ? c.red : c.tint }]}>
              {manualMessage.text}
            </Text>
          </View>
        ) : null}
            </ScrollView>
          </>
        ) : (
          <InventoryPanel />
        )}
      </PageContainer>

      <ConfirmDialog
        confirmLabel="删除"
        loading={removeItem.isPending}
        message="删除后该物品会从这一天的购物清单中移除。"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          removeItem.mutate(pendingDelete.id, {
            onSuccess: () => setPendingDelete(null),
            onError: (error) => {
              setPendingDelete(null);
              setManualMessage({
                text: error instanceof Error ? error.message : '删除失败',
                error: true,
              });
            },
          });
        }}
        title={pendingDelete ? `删除「${pendingDelete.ingredient?.name ?? pendingDelete.customName}」？` : '删除购物项？'}
        visible={Boolean(pendingDelete)}
      />
      {stockingItem ? (
        <StockConfirmDialog
          item={stockingItem}
          key={stockingItem.id}
          onClose={() => setStockingItem(null)}
          onSuccess={(message) => {
            setStockingItem(null);
            setStockMessage(message);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingTop: 8 },
  pageDesktop: { paddingTop: 22 },
  header: { paddingTop: 0 },
  viewControl: { width: 300, maxWidth: '100%', marginTop: 14 },
  dateControl: { marginTop: 14 },
  scrollContent: { paddingBottom: 32 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemToggle: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingVertical: 12,
  },
  itemText: { flex: 1, minWidth: 0, marginLeft: 12 },
  itemBreakdown: { marginTop: 3, lineHeight: 17 },
  deleteButton: {
    width: 44,
    height: 44,
    marginHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stockButton: {
    minHeight: 44,
    borderRadius: radius.sm,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  stockStatus: {
    minHeight: 30,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stockDialogHeader: {
    minHeight: 72,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stockDialogScroll: { flexShrink: 1 },
  stockDialogContent: { paddingHorizontal: 18, paddingBottom: 16, gap: 12 },
  stockCandidates: { gap: 8 },
  stockCandidate: {
    minHeight: 58,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stockNotice: { borderRadius: radius.sm, padding: 12 },
  stockForecast: { borderRadius: radius.sm, padding: 13 },
  stockActions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  stockAction: {
    flex: 1,
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualForm: { padding: 12, gap: 10 },
  manualFormDesktop: { flexDirection: 'row', alignItems: 'center' },
  manualName: {
    flex: 1,
    minWidth: 0,
    height: 44,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 0,
  },
  manualControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepper: {
    height: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  quantityInput: { width: 46, textAlign: 'center', paddingVertical: 0 },
  unitInput: {
    width: 70,
    height: 44,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 0,
    textAlign: 'center',
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualMessage: { marginTop: 10, borderRadius: radius.sm, padding: 10 },
});
