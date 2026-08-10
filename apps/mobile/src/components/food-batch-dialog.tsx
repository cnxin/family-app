import {
  CalendarClock,
  Check,
  PackageOpen,
  X,
} from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { todayStr } from '../lib/date';
import {
  useCreateInventoryBatch,
  useUpdateInventoryBatch,
} from '../lib/queries';
import type { InventoryBatch, InventoryItem } from '../lib/types';
import { radius, type as t, useTheme } from '../lib/theme';
import {
  AdaptiveDialog,
  IconButton,
  PressableScale,
  PrimaryButton,
} from './ui';

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function optionalDate(value: string) {
  return value.trim() ? value.trim() : null;
}

export function FoodBatchDialog({
  batch,
  inventory,
  onClose,
  onSuccess,
}: {
  batch?: InventoryBatch | null;
  inventory: InventoryItem[];
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const c = useTheme();
  const create = useCreateInventoryBatch();
  const update = useUpdateInventoryBatch();
  const candidates = useMemo(
    () =>
      inventory.filter(
        (item) =>
          item.id === batch?.inventoryItemId ||
          (item.batchSummary?.untrackedQuantity ?? Number(item.quantity)) > 0,
      ),
    [batch?.inventoryItemId, inventory],
  );
  const [inventoryItemId, setInventoryItemId] = useState(
    batch?.inventoryItemId ?? candidates[0]?.id ?? '',
  );
  const selected = inventory.find((item) => item.id === inventoryItemId) ?? null;
  const maxQuantity = selected
    ? selected.batchSummary?.untrackedQuantity ?? Number(selected.quantity)
    : 0;
  const [quantity, setQuantity] = useState(
    batch ? String(Number(batch.quantity)) : String(Math.min(1, maxQuantity || 1)),
  );
  const [receivedOn, setReceivedOn] = useState(batch?.receivedOn ?? todayStr());
  const [productionDate, setProductionDate] = useState(batch?.productionDate ?? '');
  const [expiresOn, setExpiresOn] = useState(batch?.expiresOn ?? '');
  const [openedOn, setOpenedOn] = useState(batch?.openedOn ?? '');
  const [error, setError] = useState<string | null>(null);
  const parsedQuantity = Number(quantity);
  const datesValid = [receivedOn, productionDate, expiresOn, openedOn].every(
    (value, index) => (index > 0 && !value.trim()) || isDate(value.trim()),
  );
  const valid = batch
    ? datesValid
    : Boolean(selected) &&
      Number.isFinite(parsedQuantity) &&
      parsedQuantity > 0 &&
      parsedQuantity <= maxQuantity &&
      datesValid;
  const pending = create.isPending || update.isPending;

  const save = async () => {
    if (!valid || !selected) return;
    setError(null);
    const dates = {
      receivedOn: receivedOn.trim(),
      productionDate: optionalDate(productionDate),
      expiresOn: optionalDate(expiresOn),
      openedOn: optionalDate(openedOn),
    };
    try {
      if (batch) {
        await update.mutateAsync({
          id: batch.id,
          expectedVersion: batch.version,
          ...dates,
        });
        onSuccess(`已更新「${selected.name}」批次日期`);
      } else {
        await create.mutateAsync({
          inventoryItemId: selected.id,
          quantity: parsedQuantity,
          ...dates,
        });
        onSuccess(
          `已登记 ${parsedQuantity} ${selected.unit}「${selected.name}」批次`,
        );
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存批次失败');
    }
  };

  return (
    <AdaptiveDialog
      accessibilityLabel={batch ? '编辑食品批次' : '登记食品批次'}
      maxWidth={520}
      onClose={onClose}
      testID="food-batch-dialog"
      visible
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}
      >
        <View style={styles.header}>
          <View style={[styles.headerIcon, { backgroundColor: c.greenSoft }]}>
            <PackageOpen color={c.green} size={21} />
          </View>
          <View style={styles.headerCopy}>
            <Text style={[t.title2, { color: c.label }]}>
              {batch ? '编辑食品批次' : '登记食品批次'}
            </Text>
            <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>
              批次数量不会重复增加总库存
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

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={styles.scroll}
        >
          <Text style={[t.footnote, styles.label, { color: c.secondaryLabel }]}>库存项</Text>
          <View style={styles.inventoryOptions}>
            {candidates.map((item) => {
              const active = item.id === inventoryItemId;
              const untracked =
                item.batchSummary?.untrackedQuantity ?? Number(item.quantity);
              return (
                <Pressable
                  accessibilityLabel={`选择${item.name}批次`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  disabled={Boolean(batch)}
                  key={item.id}
                  onPress={() => {
                    setInventoryItemId(item.id);
                    setQuantity(String(Math.min(1, untracked)));
                  }}
                  style={[
                    styles.inventoryOption,
                    {
                      backgroundColor: active ? c.tintSoft : c.fill,
                      borderColor: active ? c.tint : c.separator,
                    },
                  ]}
                >
                  <View style={styles.inventoryOptionCopy}>
                    <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]}>
                      {item.name}
                    </Text>
                    <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>
                      未分批 {untracked} {item.unit}
                    </Text>
                  </View>
                  {active ? <Check color={c.tint} size={18} /> : null}
                </Pressable>
              );
            })}
          </View>
          {!candidates.length ? (
            <View style={[styles.notice, { backgroundColor: c.orangeSoft }]}>
              <Text style={[t.footnote, { color: c.orange }]}>当前没有可登记的未分批库存</Text>
            </View>
          ) : null}

          {!batch ? (
            <>
              <Text style={[t.footnote, styles.label, { color: c.secondaryLabel }]}>本批数量</Text>
              <View style={styles.quantityRow}>
                <TextInput
                  accessibilityLabel="批次数量"
                  keyboardType="decimal-pad"
                  onChangeText={setQuantity}
                  selectTextOnFocus
                  style={[styles.input, t.body, { backgroundColor: c.fill, color: c.label }]}
                  value={quantity}
                />
                <Text style={[t.subhead, { color: c.secondaryLabel }]}>{selected?.unit ?? ''}</Text>
              </View>
              {selected && parsedQuantity > maxQuantity ? (
                <Text style={[t.footnote, { color: c.red, marginTop: 6 }]}>
                  最多可登记 {maxQuantity} {selected.unit}
                </Text>
              ) : null}
            </>
          ) : (
            <View style={[styles.fixedQuantity, { backgroundColor: c.fill }]}>
              <Text style={[t.footnote, { color: c.secondaryLabel }]}>当前批次余量</Text>
              <Text style={[t.headline, { color: c.label, marginTop: 3 }]}>
                {Number(batch.quantity)} {selected?.unit}
              </Text>
            </View>
          )}

          <View style={styles.dateHeading}>
            <CalendarClock color={c.tint} size={18} />
            <Text style={[t.headline, { color: c.label }]}>日期信息</Text>
          </View>
          <View style={styles.dateGrid}>
            {[
              ['入库日期', '批次入库日期', receivedOn, setReceivedOn],
              ['生产日期（可选）', '批次生产日期', productionDate, setProductionDate],
              ['到期日期（可选）', '批次到期日期', expiresOn, setExpiresOn],
              ['开封日期（可选）', '批次开封日期', openedOn, setOpenedOn],
            ].map(([label, accessibilityLabel, value, setter]) => (
              <View key={label as string} style={styles.dateField}>
                <Text style={[t.footnote, styles.label, { color: c.secondaryLabel }]}>
                  {label as string}
                </Text>
                <TextInput
                  accessibilityLabel={accessibilityLabel as string}
                  autoCapitalize="none"
                  maxLength={10}
                  onChangeText={setter as (value: string) => void}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={c.tertiaryLabel}
                  style={[styles.input, t.body, { backgroundColor: c.fill, color: c.label }]}
                  value={value as string}
                />
              </View>
            ))}
          </View>
          <View style={styles.quickDates}>
            {[7, 30, 90].map((days) => (
              <PressableScale
                accessibilityLabel={`到期日期设为${days}天后`}
                haptic={false}
                key={days}
                onPress={() => setExpiresOn(addDays(receivedOn, days))}
                style={[styles.quickDate, { backgroundColor: c.fill }]}
              >
                <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>
                  {days} 天后
                </Text>
              </PressableScale>
            ))}
          </View>

          {!datesValid ? (
            <Text style={[t.footnote, { color: c.red }]}>请使用有效的 YYYY-MM-DD 日期</Text>
          ) : null}
          {error ? <Text style={[t.footnote, { color: c.red }]}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={pending}
            onPress={onClose}
            style={[styles.action, { backgroundColor: c.fill }]}
          >
            <Text style={[t.headline, { color: c.label }]}>取消</Text>
          </Pressable>
          <PrimaryButton
            disabled={!valid}
            loading={pending}
            onPress={() => void save()}
            style={styles.save}
            title={batch ? '保存日期' : '登记批次'}
          />
        </View>
      </KeyboardAvoidingView>
    </AdaptiveDialog>
  );
}

const styles = StyleSheet.create({
  keyboard: { flex: 1, minHeight: 0 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11,
    paddingBottom: 14,
    paddingHorizontal: 18,
  },
  headerIcon: {
    alignItems: 'center',
    borderRadius: 21,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  scroll: { flex: 1, minHeight: 0 },
  content: { paddingBottom: 16, paddingHorizontal: 18 },
  label: { fontWeight: '700', marginBottom: 6, marginTop: 12 },
  inventoryOptions: { gap: 8 },
  inventoryOption: {
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 58,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  inventoryOptionCopy: { flex: 1, minWidth: 0 },
  notice: { borderRadius: radius.sm, marginTop: 8, padding: 12 },
  quantityRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  input: {
    borderRadius: radius.sm,
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  fixedQuantity: { borderRadius: radius.sm, marginTop: 14, padding: 12 },
  dateHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 20,
  },
  dateGrid: { gap: 2 },
  dateField: { minWidth: 0 },
  quickDates: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  quickDate: {
    alignItems: 'center',
    borderRadius: radius.full,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  actions: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    padding: 14,
  },
  action: {
    alignItems: 'center',
    borderRadius: radius.sm,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  save: { flex: 1 },
});
