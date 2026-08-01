import {
  AlertTriangle,
  History,
  Link2,
  Minus,
  Package,
  Plus,
  ShoppingCart,
  Trash2,
  RotateCcw,
  X,
} from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
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
  useAddManualShoppingItem,
  useDeleteInventoryItem,
  useIngredients,
  useInventory,
  useInventoryTransactions,
  useReverseInventoryTransaction,
  useShoppingList,
  useUpsertInventoryItem,
} from '../lib/queries';
import type {
  Ingredient,
  InventoryCategory,
  InventoryItem,
  InventoryTransaction,
} from '../lib/types';
import { radius, type as t, useTheme } from '../lib/theme';
import {
  Card,
  ConfirmDialog,
  EmptyState,
  PressableScale,
  PrimaryButton,
  SectionHeader,
} from './ui';

const CATEGORIES: InventoryCategory[] = [
  '调料',
  '主食',
  '饮料',
  '零食',
  '日用品',
  '其他',
];

const CATEGORY_EMOJI: Record<InventoryCategory, string> = {
  调料: '🧂',
  主食: '🍚',
  饮料: '🥛',
  零食: '🍪',
  日用品: '🧻',
  其他: '📦',
};

function inventoryInput(item: InventoryItem, quantity = Number(item.quantity)) {
  return {
    id: item.id,
    ingredientId: item.ingredientId,
    name: item.name,
    category: item.category,
    quantity,
    unit: item.unit,
    lowStockThreshold: Number(item.lowStockThreshold),
    restockQuantity: Number(item.restockQuantity),
  };
}

function inventoryCategoryForIngredient(ingredient: Ingredient): InventoryCategory {
  if (ingredient.category === '调料' || ingredient.category === '主食') {
    return ingredient.category;
  }
  return '其他';
}

function InventoryEditor({
  item,
  onClose,
  onRequestDelete,
}: {
  item: InventoryItem | null;
  onClose: () => void;
  onRequestDelete: (item: InventoryItem) => void;
}) {
  const c = useTheme();
  const upsert = useUpsertInventoryItem();
  const { data: ingredients } = useIngredients();
  const [ingredientId, setIngredientId] = useState<string | null>(
    item?.ingredientId ?? null,
  );
  const [ingredientSearch, setIngredientSearch] = useState('');
  const [name, setName] = useState(item?.name ?? '');
  const [category, setCategory] = useState<InventoryCategory>(item?.category ?? '调料');
  const [quantity, setQuantity] = useState(item ? String(Number(item.quantity)) : '0');
  const [unit, setUnit] = useState(item?.unit ?? '份');
  const [threshold, setThreshold] = useState(
    item ? String(Number(item.lowStockThreshold)) : '1',
  );
  const [restockQuantity, setRestockQuantity] = useState(
    item ? String(Number(item.restockQuantity)) : '1',
  );
  const [error, setError] = useState<string | null>(null);
  const selectedIngredient =
    ingredients?.find((ingredient) => ingredient.id === ingredientId) ??
    (ingredientId && item?.ingredientId === ingredientId ? item.ingredient : null);
  const ingredientResults = useMemo(() => {
    const keyword = ingredientSearch.trim().toLocaleLowerCase('zh-CN');
    if (!keyword) return [];
    return (ingredients ?? [])
      .filter(
        (ingredient) =>
          ingredient.id !== ingredientId &&
          ingredient.name.toLocaleLowerCase('zh-CN').includes(keyword),
      )
      .slice(0, 8);
  }, [ingredientId, ingredientSearch, ingredients]);

  const values = [quantity, threshold, restockQuantity].map(Number);
  const valid =
    Boolean(name.trim()) &&
    Boolean(unit.trim()) &&
    values.every(Number.isFinite) &&
    values[0] >= 0 &&
    values[1] >= 0 &&
    values[2] > 0;

  const save = async () => {
    if (!valid) return;
    setError(null);
    try {
      await upsert.mutateAsync({
        id: item?.id,
        ingredientId,
        name: name.trim(),
        category,
        quantity: values[0],
        unit: unit.trim(),
        lowStockThreshold: values[1],
        restockQuantity: values[2],
      });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败');
    }
  };

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.editorOverlay}
      >
        <Pressable
          accessibilityLabel="关闭库存编辑"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[styles.editor, { backgroundColor: c.card, borderColor: c.separator }]}
        >
          <View style={styles.editorHeader}>
            <View>
              <Text style={[t.title2, { color: c.label }]}>
                {item ? '编辑库存' : '新增库存'}
              </Text>
              <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>设置余量与补货提醒</Text>
            </View>
            <PressableScale
              accessibilityLabel="关闭"
              haptic={false}
              onPress={onClose}
              style={styles.closeButton}
            >
              <X color={c.secondaryLabel} size={20} />
            </PressableScale>
          </View>

          <ScrollView
            contentContainerStyle={styles.editorContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>关联食材</Text>
            {selectedIngredient ? (
              <View
                style={[
                  styles.linkedIngredient,
                  { backgroundColor: c.tintSoft, borderColor: c.tint },
                ]}
              >
                <Link2 color={c.tint} size={17} />
                <View style={styles.linkedIngredientText}>
                  <Text style={[t.body, { color: c.label, fontWeight: '700' }]}>
                    {selectedIngredient.name}
                  </Text>
                  <Text style={[t.caption, { color: c.secondaryLabel }]}>
                    {selectedIngredient.category} · {selectedIngredient.defaultUnit}
                  </Text>
                </View>
                <PressableScale
                  accessibilityLabel={`取消关联${selectedIngredient.name}`}
                  haptic={false}
                  onPress={() => {
                    setIngredientId(null);
                    setIngredientSearch('');
                  }}
                  style={styles.unlinkIngredient}
                >
                  <X color={c.secondaryLabel} size={17} />
                </PressableScale>
              </View>
            ) : (
              <>
                <TextInput
                  accessibilityLabel="搜索关联食材"
                  autoFocus={!item}
                  onChangeText={setIngredientSearch}
                  placeholder="搜索菜谱中的食材（可选）"
                  placeholderTextColor={c.tertiaryLabel}
                  style={[styles.input, t.body, { backgroundColor: c.fill, color: c.label }]}
                  value={ingredientSearch}
                />
                {ingredientSearch.trim() ? (
                  <View style={[styles.ingredientResults, { borderColor: c.separator }]}>
                    {ingredientResults.length ? (
                      ingredientResults.map((ingredient) => (
                        <Pressable
                          accessibilityLabel={`关联食材${ingredient.name}`}
                          accessibilityRole="button"
                          key={ingredient.id}
                          onPress={() => {
                            setIngredientId(ingredient.id);
                            setIngredientSearch('');
                            setName(ingredient.name);
                            setUnit(ingredient.defaultUnit);
                            setCategory(inventoryCategoryForIngredient(ingredient));
                          }}
                          style={({ pressed }) => [
                            styles.ingredientResult,
                            {
                              backgroundColor: pressed ? c.fill : c.card,
                              borderBottomColor: c.separator,
                            },
                          ]}
                        >
                          <Text style={[t.body, { color: c.label, fontWeight: '700' }]}>
                            {ingredient.name}
                          </Text>
                          <Text style={[t.caption, { color: c.secondaryLabel }]}>
                            {ingredient.category} · {ingredient.defaultUnit}
                          </Text>
                        </Pressable>
                      ))
                    ) : (
                      <Text style={[t.footnote, styles.noIngredientResult, { color: c.secondaryLabel }]}>
                        没有匹配的食材
                      </Text>
                    )}
                  </View>
                ) : null}
              </>
            )}

            <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>名称</Text>
            <TextInput
              accessibilityLabel="库存名称"
              onChangeText={setName}
              placeholder="比如：大米、酱油、牛奶"
              placeholderTextColor={c.tertiaryLabel}
              style={[styles.input, t.body, { backgroundColor: c.fill, color: c.label }]}
              value={name}
            />

            <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>分类</Text>
            <View style={styles.categoryChips}>
              {CATEGORIES.map((value) => {
                const selected = value === category;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={value}
                    onPress={() => setCategory(value)}
                    style={[
                      styles.categoryChip,
                      { backgroundColor: selected ? c.tint : c.fill },
                    ]}
                  >
                    <Text style={[t.footnote, { color: selected ? '#FFFFFF' : c.label, fontWeight: '700' }]}>
                      {CATEGORY_EMOJI[value]} {value}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.formGrid}>
              <View style={styles.formField}>
                <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>当前余量</Text>
                <TextInput
                  accessibilityLabel="当前余量"
                  keyboardType="decimal-pad"
                  onChangeText={setQuantity}
                  selectTextOnFocus
                  style={[styles.input, t.body, { backgroundColor: c.fill, color: c.label }]}
                  value={quantity}
                />
              </View>
              <View style={styles.formField}>
                <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>单位</Text>
                <TextInput
                  accessibilityLabel="库存单位"
                  maxLength={16}
                  onChangeText={setUnit}
                  placeholder="袋、瓶、斤"
                  placeholderTextColor={c.tertiaryLabel}
                  style={[styles.input, t.body, { backgroundColor: c.fill, color: c.label }]}
                  value={unit}
                />
              </View>
              <View style={styles.formField}>
                <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>低于此数提醒</Text>
                <TextInput
                  accessibilityLabel="低库存提醒数量"
                  keyboardType="decimal-pad"
                  onChangeText={setThreshold}
                  selectTextOnFocus
                  style={[styles.input, t.body, { backgroundColor: c.fill, color: c.label }]}
                  value={threshold}
                />
              </View>
              <View style={styles.formField}>
                <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>每次补货数量</Text>
                <TextInput
                  accessibilityLabel="每次补货数量"
                  keyboardType="decimal-pad"
                  onChangeText={setRestockQuantity}
                  selectTextOnFocus
                  style={[styles.input, t.body, { backgroundColor: c.fill, color: c.label }]}
                  value={restockQuantity}
                />
              </View>
            </View>

            {error ? (
              <Text style={[t.footnote, { color: c.red, marginTop: 12 }]}>{error}</Text>
            ) : null}

            <View style={styles.editorActions}>
              {item ? (
                <PressableScale
                  accessibilityLabel={`删除库存${item.name}`}
                  haptic={false}
                  onPress={() => onRequestDelete(item)}
                  style={[styles.deleteInventoryButton, { backgroundColor: c.redSoft }]}
                >
                  <Trash2 color={c.red} size={18} />
                </PressableScale>
              ) : null}
              <PrimaryButton
                disabled={!valid}
                loading={upsert.isPending}
                onPress={() => void save()}
                style={{ flex: 1 }}
                title="保存库存"
              />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function InventoryPanel() {
  const c = useTheme();
  const { data: items, isLoading } = useInventory();
  const { data: shoppingItems } = useShoppingList(todayStr());
  const upsert = useUpsertInventoryItem();
  const { data: transactions } = useInventoryTransactions();
  const reverse = useReverseInventoryTransaction();
  const remove = useDeleteInventoryItem();
  const addShoppingItem = useAddManualShoppingItem();
  const [filter, setFilter] = useState<'全部' | InventoryCategory>('全部');
  const [editor, setEditor] = useState<InventoryItem | 'new' | null>(null);
  const [pendingDelete, setPendingDelete] = useState<InventoryItem | null>(null);
  const [pendingReverse, setPendingReverse] =
    useState<InventoryTransaction | null>(null);
  const [restocking, setRestocking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const lowItems = (items ?? []).filter(
    (item) => Number(item.quantity) <= Number(item.lowStockThreshold),
  );
  const shoppingNames = useMemo(
    () =>
      new Set(
        (shoppingItems ?? []).map(
          (item) => item.ingredient?.name ?? item.customName ?? '',
        ),
      ),
    [shoppingItems],
  );
  const needsShopping = lowItems.filter((item) => !shoppingNames.has(item.name));

  const groups = useMemo(() => {
    const visible =
      filter === '全部' ? items ?? [] : (items ?? []).filter((item) => item.category === filter);
    const map = new Map<InventoryCategory, InventoryItem[]>();
    for (const item of visible) {
      map.set(item.category, [...(map.get(item.category) ?? []), item]);
    }
    return [...map.entries()];
  }, [filter, items]);

  const adjust = (item: InventoryItem, offset: number) => {
    const next = Math.max(0, Math.round((Number(item.quantity) + offset) * 100) / 100);
    setMessage(null);
    upsert.mutate(inventoryInput(item, next), {
      onSuccess: () =>
        setMessage(
          `${item.name} 已调整：${Number(item.quantity)} → ${next} ${item.unit}`,
        ),
      onError: (error) =>
        setMessage(error instanceof Error ? error.message : '库存调整失败'),
    });
  };

  const transactionLabel = (transaction: InventoryTransaction) => {
    if (transaction.type === 'receipt') return '入库';
    if (transaction.type === 'consumption') return '扣库';
    if (transaction.type === 'adjustment') return '调整';
    return '撤销';
  };

  const pendingReverseRows = pendingReverse
    ? (transactions ?? []).filter(
        (transaction) =>
          transaction.operationId === pendingReverse.operationId &&
          transaction.type === pendingReverse.type,
      )
    : [];
  const pendingReverseMessage = pendingReverse
    ? [
        pendingReverse.sourceType === 'menu'
          ? '同一餐的关联库存会整组恢复，并追加反向流水；历史流水不会删除。'
          : '将追加反向流水恢复这次库存变化；历史流水不会删除。',
        ...(pendingReverseRows.length ? pendingReverseRows : [pendingReverse]).map(
          (transaction) =>
            `${transaction.inventoryItem.name}：${Number(transaction.quantityAfter)} → ${Number(transaction.quantityBefore)} ${transaction.unit}`,
        ),
      ].join('\n')
    : '';

  const addRestockItems = async (targets: InventoryItem[]) => {
    if (!targets.length) return;
    setRestocking(true);
    setMessage(null);
    try {
      for (const item of targets) {
        await addShoppingItem.mutateAsync({
          date: todayStr(),
          customName: item.name,
          totalQty: Number(item.restockQuantity),
          unit: item.unit,
        });
      }
      setMessage(`已把 ${targets.length} 项加入今天的购物清单`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加入购物清单失败');
    } finally {
      setRestocking(false);
    }
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.panelContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.summaryRow}>
          <Card style={styles.summaryCard}>
            <View style={[styles.summaryIcon, { backgroundColor: c.tintSoft }]}>
              <Package color={c.tint} size={20} />
            </View>
            <View>
              <Text style={[t.title2, { color: c.label }]}>{items?.length ?? 0}</Text>
              <Text style={[t.caption, { color: c.secondaryLabel }]}>库存种类</Text>
            </View>
          </Card>
          <Card style={styles.summaryCard}>
            <View style={[styles.summaryIcon, { backgroundColor: c.orangeSoft }]}>
              <AlertTriangle color={c.orange} size={20} />
            </View>
            <View>
              <Text style={[t.title2, { color: lowItems.length ? c.orange : c.label }]}>
                {lowItems.length}
              </Text>
              <Text style={[t.caption, { color: c.secondaryLabel }]}>待补货</Text>
            </View>
          </Card>
        </View>

        <View style={styles.panelActions}>
          <PressableScale
            accessibilityLabel="新增库存"
            onPress={() => setEditor('new')}
            style={[styles.newButton, { backgroundColor: c.tint }]}
          >
            <Plus color="#FFFFFF" size={18} />
            <Text style={[t.subhead, { color: '#FFFFFF', fontWeight: '700' }]}>新增库存</Text>
          </PressableScale>
          {needsShopping.length ? (
            <PressableScale
              accessibilityLabel="将全部待补货加入购物清单"
              disabled={restocking}
              haptic={false}
              onPress={() => void addRestockItems(needsShopping)}
              style={[styles.restockAllButton, { backgroundColor: c.orangeSoft }]}
            >
              {restocking ? (
                <ActivityIndicator color={c.orange} size="small" />
              ) : (
                <ShoppingCart color={c.orange} size={18} />
              )}
              <Text style={[t.subhead, { color: c.orange, fontWeight: '700' }]}>
                补货 {needsShopping.length} 项
              </Text>
            </PressableScale>
          ) : null}
        </View>

        {message ? (
          <View style={[styles.message, { backgroundColor: c.tintSoft }]}>
            <Text style={[t.footnote, { color: c.tint }]}>{message}</Text>
          </View>
        ) : null}

        <ScrollView
          contentContainerStyle={styles.filters}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {(['全部', ...CATEGORIES] as const).map((category) => {
            const selected = filter === category;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={category}
                onPress={() => setFilter(category)}
                style={[
                  styles.filterButton,
                  {
                    backgroundColor: selected ? c.tint : c.card,
                    borderColor: selected ? c.tint : c.separator,
                  },
                ]}
              >
                <Text style={[t.footnote, { color: selected ? '#FFFFFF' : c.label, fontWeight: '700' }]}>
                  {category}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {isLoading ? <ActivityIndicator color={c.tint} style={{ marginTop: 56 }} /> : null}
        {!isLoading && !(items?.length ?? 0) ? (
          <EmptyState
            emoji="📦"
            hint="先记录大米、调料和饮料，余量不足时会提醒补货"
            title="还没有库存记录"
          />
        ) : null}

        {groups.map(([category, list]) => (
          <View key={category}>
            <SectionHeader title={`${CATEGORY_EMOJI[category]} ${category}`} />
            <Card>
              {list.map((item) => {
                const low = Number(item.quantity) <= Number(item.lowStockThreshold);
                const inShopping = shoppingNames.has(item.name);
                return (
                  <View
                    key={item.id}
                    style={[
                      styles.inventoryRow,
                      { borderBottomColor: c.separator },
                      low && { backgroundColor: c.orangeSoft },
                    ]}
                  >
                    <Pressable
                      accessibilityLabel={`编辑库存${item.name}`}
                      accessibilityRole="button"
                      onPress={() => setEditor(item)}
                      style={styles.inventoryMain}
                    >
                      <Text style={styles.inventoryEmoji}>{CATEGORY_EMOJI[item.category]}</Text>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={styles.inventoryNameRow}>
                          <Text style={[t.body, { color: c.label, fontWeight: '700' }]} numberOfLines={1}>
                            {item.name}
                          </Text>
                          {item.ingredient ? <Link2 color={c.tint} size={13} /> : null}
                          {low ? (
                            <View style={[styles.lowBadge, { backgroundColor: c.orange }]}>
                              <Text style={styles.lowBadgeText}>待补货</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>
                          剩余 {Number(item.quantity)} {item.unit} · {Number(item.lowStockThreshold)} 以下提醒
                        </Text>
                      </View>
                    </Pressable>

                    <View style={styles.inventoryControls}>
                      <PressableScale
                        accessibilityLabel={`减少${item.name}库存`}
                        disabled={Number(item.quantity) <= 0 || upsert.isPending}
                        haptic={false}
                        onPress={() => adjust(item, -1)}
                        style={[styles.iconAction, { backgroundColor: c.card }]}
                      >
                        <Minus color={c.secondaryLabel} size={16} />
                      </PressableScale>
                      <PressableScale
                        accessibilityLabel={`增加${item.name}库存`}
                        disabled={upsert.isPending}
                        haptic={false}
                        onPress={() => adjust(item, 1)}
                        style={[styles.iconAction, { backgroundColor: c.card }]}
                      >
                        <Plus color={c.tint} size={17} />
                      </PressableScale>
                      {low ? (
                        <PressableScale
                          accessibilityLabel={inShopping ? `${item.name}已在购物清单` : `补货${item.name}`}
                          disabled={inShopping || restocking}
                          haptic={false}
                          onPress={() => void addRestockItems([item])}
                          style={[
                            styles.iconAction,
                            { backgroundColor: inShopping ? c.fill : c.orange },
                          ]}
                        >
                          <ShoppingCart color={inShopping ? c.tertiaryLabel : '#FFFFFF'} size={16} />
                        </PressableScale>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </Card>
          </View>
        ))}

        {(transactions?.length ?? 0) > 0 ? (
          <View>
            <SectionHeader title="库存流水" />
            <Card>
              {transactions?.slice(0, 30).map((transaction) => {
                const positive = Number(transaction.delta) > 0;
                return (
                  <View
                    key={transaction.id}
                    style={[
                      styles.transactionRow,
                      { borderBottomColor: c.separator },
                    ]}
                  >
                    <View
                      style={[
                        styles.transactionIcon,
                        { backgroundColor: positive ? c.greenSoft : c.orangeSoft },
                      ]}
                    >
                      {transaction.type === 'reversal' ? (
                        <RotateCcw color={positive ? c.green : c.orange} size={16} />
                      ) : (
                        <History color={positive ? c.green : c.orange} size={16} />
                      )}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]}>
                        {transaction.inventoryItem.name} · {transactionLabel(transaction)}
                      </Text>
                      <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>
                        {Number(transaction.quantityBefore)} → {Number(transaction.quantityAfter)} {transaction.unit}
                        {' · '}{transaction.actorName}{' · '}
                        {new Intl.DateTimeFormat('zh-CN', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        }).format(new Date(transaction.createdAt))}
                      </Text>
                      {transaction.reversedAt ? (
                        <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>已撤销</Text>
                      ) : null}
                    </View>
                    {transaction.canReverse ? (
                      <PressableScale
                        accessibilityLabel={`撤销${transaction.inventoryItem.name}${transactionLabel(transaction)}`}
                        haptic={false}
                        onPress={() => setPendingReverse(transaction)}
                        style={[styles.reverseButton, { backgroundColor: c.fill }]}
                      >
                        <RotateCcw color={c.tint} size={16} />
                        <Text style={[t.caption, { color: c.tint, fontWeight: '700' }]}>撤销</Text>
                      </PressableScale>
                    ) : null}
                  </View>
                );
              })}
            </Card>
          </View>
        ) : null}
      </ScrollView>

      {editor ? (
        <InventoryEditor
          item={editor === 'new' ? null : editor}
          key={editor === 'new' ? 'new' : editor.id}
          onClose={() => setEditor(null)}
          onRequestDelete={(item) => {
            setEditor(null);
            setPendingDelete(item);
          }}
        />
      ) : null}

      <ConfirmDialog
        confirmLabel="删除库存"
        loading={remove.isPending}
        message={`删除后不会影响已有购物清单。`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          remove.mutate(pendingDelete.id, {
            onSuccess: () => setPendingDelete(null),
            onError: (error) => {
              setPendingDelete(null);
              setMessage(error instanceof Error ? error.message : '删除库存失败');
            },
          });
        }}
        title={pendingDelete ? `删除「${pendingDelete.name}」？` : '删除库存？'}
        visible={Boolean(pendingDelete)}
      />
      <ConfirmDialog
        confirmLabel="确认撤销"
        destructive={false}
        loading={reverse.isPending}
        message={pendingReverseMessage}
        onCancel={() => setPendingReverse(null)}
        onConfirm={() => {
          if (!pendingReverse) return;
          reverse.mutate(pendingReverse.id, {
            onSuccess: (result) => {
              setPendingReverse(null);
              setMessage(
                result.alreadyReversed
                  ? '这次库存操作已经撤销，没有重复变化'
                  : '库存操作已通过反向流水撤销',
              );
            },
            onError: (error) => {
              setPendingReverse(null);
              setMessage(error instanceof Error ? error.message : '撤销失败');
            },
          });
        }}
        title={pendingReverse ? `撤销这次${transactionLabel(pendingReverse)}？` : '撤销库存操作？'}
        visible={Boolean(pendingReverse)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  panelContent: { paddingBottom: 36 },
  summaryRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  summaryCard: {
    flex: 1,
    minHeight: 82,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  summaryIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  newButton: {
    height: 42,
    borderRadius: radius.sm,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  restockAllButton: {
    height: 42,
    borderRadius: radius.sm,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  message: { marginTop: 12, borderRadius: radius.sm, padding: 11 },
  filters: { gap: 8, paddingRight: 8, marginTop: 16 },
  filterButton: {
    height: 34,
    minWidth: 58,
    paddingHorizontal: 13,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inventoryRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingRight: 10,
  },
  inventoryMain: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  inventoryEmoji: { fontSize: 23 },
  inventoryNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  lowBadge: { borderRadius: radius.full, paddingHorizontal: 6, paddingVertical: 2 },
  lowBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  inventoryControls: { flexDirection: 'row', gap: 6, marginLeft: 6 },
  iconAction: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transactionRow: {
    minHeight: 68,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  transactionIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reverseButton: {
    minHeight: 34,
    borderRadius: radius.sm,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  editorOverlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 25, 20, 0.38)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  editor: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '92%',
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  editorHeader: {
    minHeight: 70,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  editorContent: { paddingHorizontal: 18, paddingBottom: 18 },
  fieldLabel: { marginTop: 12, marginBottom: 6, fontWeight: '700' },
  input: {
    height: 42,
    borderRadius: radius.sm,
    paddingHorizontal: 11,
    paddingVertical: 0,
  },
  linkedIngredient: {
    minHeight: 50,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingLeft: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  linkedIngredientText: { flex: 1, minWidth: 0 },
  unlinkIngredient: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ingredientResults: {
    marginTop: 6,
    borderWidth: 1,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  ingredientResult: {
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  noIngredientResult: { paddingHorizontal: 12, paddingVertical: 14 },
  categoryChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  categoryChip: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 7 },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  formField: { width: '48%', flexGrow: 1, minWidth: 140 },
  editorActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  deleteInventoryButton: {
    width: 50,
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
