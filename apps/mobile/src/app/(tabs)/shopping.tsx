import * as Haptics from 'expo-haptics';
import { Minus, Plus, Trash2 } from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
  Card,
  ConfirmDialog,
  EmptyState,
  PressableScale,
  SectionHeader,
  Segmented,
} from '../../components/ui';
import { todayStr } from '../../lib/date';
import {
  useAddManualShoppingItem,
  useCheckShoppingItem,
  useDeleteShoppingItem,
  useShoppingList,
} from '../../lib/queries';
import { radius, type as t, useTheme } from '../../lib/theme';
import type { ShoppingItem } from '../../lib/types';

function quantityLabel(value: string | null) {
  return value == null ? '0' : String(Number(value));
}

function ItemRow({ item, onDelete }: { item: ShoppingItem; onDelete: () => void }) {
  const c = useTheme();
  const check = useCheckShoppingItem();
  const name = item.ingredient?.name ?? item.customName ?? '未知';
  const hasInventoryBreakdown =
    item.source === 'auto' &&
    item.requiredQty != null &&
    item.availableQty != null;
  const unit = item.unit ? ` ${item.unit}` : '';
  const inventoryBreakdown = hasInventoryBreakdown
    ? `需要 ${quantityLabel(item.requiredQty)}${unit} · 库存 ${quantityLabel(item.availableQty)}${unit} · 建议买 ${quantityLabel(item.totalQty)}${unit}`
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

export default function ShoppingScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const [view, setView] = useState<'shopping' | 'inventory'>('shopping');
  const [date, setDate] = useState(todayStr());
  const { data: items, isLoading } = useShoppingList(date);
  const addManual = useAddManualShoppingItem();
  const removeItem = useDeleteShoppingItem();
  const [pendingDelete, setPendingDelete] = useState<ShoppingItem | null>(null);
  const [manualName, setManualName] = useState('');
  const [manualQty, setManualQty] = useState('1');
  const [manualUnit, setManualUnit] = useState('份');
  const [manualMessage, setManualMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, ShoppingItem[]>();
    for (const item of items ?? []) {
      const key = item.ingredient?.category ?? '手动添加';
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
                  onDelete={() => setPendingDelete(item)}
                />
              ))}
            </Card>
          </View>
        ))}

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
          });
        }}
        title={pendingDelete ? `删除「${pendingDelete.ingredient?.name ?? pendingDelete.customName}」？` : '删除购物项？'}
        visible={Boolean(pendingDelete)}
      />
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
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualForm: { padding: 12, gap: 10 },
  manualFormDesktop: { flexDirection: 'row', alignItems: 'center' },
  manualName: {
    flex: 1,
    minWidth: 0,
    height: 40,
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
    height: 40,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepButton: { width: 36, height: 38, alignItems: 'center', justifyContent: 'center' },
  quantityInput: { width: 46, textAlign: 'center', paddingVertical: 0 },
  unitInput: {
    width: 70,
    height: 40,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 0,
    textAlign: 'center',
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualMessage: { marginTop: 10, borderRadius: radius.sm, padding: 10 },
});
