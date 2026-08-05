import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Bell,
  BellPlus,
  BookOpenText,
  Check,
  ChefHat,
  ChevronDown,
  ChevronUp,
  History,
  LockKeyhole,
  PackageMinus,
  UtensilsCrossed,
} from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ModuleBackButton,
  PageContainer,
  useDesktopLayout,
} from '../../components/app-shell';
import { DateSelector } from '../../components/date-selector';
import {
  Card,
  ConfirmDialog,
  EmptyState,
  PressableScale,
  SectionHeader,
} from '../../components/ui';
import { mealLabel, todayStr } from '../../lib/date';
import {
  useAssignMenuChef,
  useConfirmMenuConsumption,
  useCompleteMenu,
  useGenerateShoppingList,
  useMarkNotificationRead,
  useMembers,
  useNotifications,
  useRecipe,
  useMenuEvents,
  useMenuInventoryPreview,
  useMenusOfDate,
  useUpdateMenuItem,
} from '../../lib/queries';
import { useSession } from '../../lib/session';
import { CATEGORY_EMOJI, radius, type as t, useTheme } from '../../lib/theme';
import type {
  AppNotification,
  Member,
  Menu,
  MenuEvent,
  MenuItem,
  MenuItemStatus,
} from '../../lib/types';

const STATUS_META: Record<
  MenuItemStatus,
  { label: string; colorKey: 'orange' | 'tint' | 'green' | 'secondaryLabel' }
> = {
  pending: { label: '待认领', colorKey: 'orange' },
  accepted: { label: '已认领', colorKey: 'tint' },
  cooking: { label: '做菜中', colorKey: 'orange' },
  done: { label: '已上桌', colorKey: 'green' },
  rejected: { label: '已划掉', colorKey: 'secondaryLabel' },
};

interface ItemAction {
  key: string;
  label: string;
  status?: MenuItemStatus;
  claim?: boolean;
  destructive?: boolean;
}

function actionsFor(
  item: MenuItem,
  memberId: string,
  locked: boolean,
): ItemAction[] {
  if (locked) return [];
  if (item.status === 'pending') {
    return [
      { key: 'claim', label: '我来做', status: 'accepted', claim: true },
      { key: 'reject', label: '划掉', status: 'rejected', destructive: true },
    ];
  }
  if (item.status === 'accepted') {
    return [
      item.assignedToId === memberId
        ? { key: 'cook', label: '开做', status: 'cooking' }
        : { key: 'reclaim', label: '换我来做', claim: true },
      { key: 'reject', label: '划掉', status: 'rejected', destructive: true },
    ];
  }
  if (item.status === 'cooking') {
    return [
      { key: 'done', label: '上桌', status: 'done' },
      { key: 'reject', label: '划掉', status: 'rejected', destructive: true },
    ];
  }
  if (item.status === 'rejected') {
    return [{ key: 'restore', label: '恢复', status: 'pending' }];
  }
  return [];
}

function RejectDialog({
  item,
  loading,
  onCancel,
  onConfirm,
  visible,
}: {
  item: MenuItem;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  visible: boolean;
}) {
  const c = useTheme();
  const [reason, setReason] = useState('');
  const reasonRequired = item.status === 'accepted' || item.status === 'cooking';
  const valid = !reasonRequired || Boolean(reason.trim());

  useEffect(() => {
    if (visible) setReason('');
  }, [visible]);

  return (
    <Modal
      animationType="fade"
      onRequestClose={() => {
        if (!loading) onCancel();
      }}
      transparent
      visible={visible}
    >
      <View style={styles.dialogOverlay}>
        <Pressable
          accessibilityLabel="关闭划掉窗口"
          accessibilityRole="button"
          onPress={() => {
            if (!loading) onCancel();
          }}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.rejectDialog,
            { backgroundColor: c.card, borderColor: c.separator },
          ]}
        >
          <Text style={[t.title2, { color: c.label }]}>划掉「{item.dish.name}」？</Text>
          <Text
            style={[
              t.subhead,
              { color: c.secondaryLabel, marginTop: 8, lineHeight: 22 },
            ]}
          >
            {reasonRequired
              ? '这道菜已经有人准备，请填写原因。'
              : '划掉后会移出有效菜单，之后仍可恢复。'}
          </Text>
          <TextInput
            autoFocus
            editable={!loading}
            maxLength={200}
            multiline
            onChangeText={setReason}
            placeholder={reasonRequired ? '填写划掉原因' : '原因（选填）'}
            placeholderTextColor={c.tertiaryLabel}
            style={[
              styles.reasonInput,
              {
                backgroundColor: c.fill,
                borderColor: c.separator,
                color: c.label,
              },
            ]}
            value={reason}
          />
          <View style={styles.dialogActions}>
            <PressableScale
              disabled={loading}
              haptic={false}
              onPress={onCancel}
              style={[styles.dialogButton, { backgroundColor: c.fill }]}
            >
              <Text style={[t.headline, { color: c.label }]}>取消</Text>
            </PressableScale>
            <PressableScale
              disabled={!valid || loading}
              onPress={() => onConfirm(reason.trim())}
              style={[
                styles.dialogButton,
                { backgroundColor: c.red, opacity: valid ? 1 : 0.4 },
              ]}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={[t.headline, { color: '#FFFFFF' }]}>划掉</Text>
              )}
            </PressableScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function MenuItemRow({
  item,
  locked,
  member,
}: {
  item: MenuItem;
  locked: boolean;
  member: Member;
}) {
  const c = useTheme();
  const update = useUpdateMenuItem();
  const [confirmingReject, setConfirmingReject] = useState(false);
  const [choosingRecipe, setChoosingRecipe] = useState(false);
  const { data: recipeDish, isLoading: recipesLoading } = useRecipe(
    item.dishId,
    choosingRecipe,
  );
  const meta = STATUS_META[item.status];
  const dimmed = item.status === 'rejected';
  const actions = actionsFor(item, member.id, locked);

  const applyChange = async (input: {
    status?: MenuItemStatus;
    assignedToId?: string;
    reason?: string;
    recipeVariantId?: string;
  }) => {
    try {
      await update.mutateAsync({ id: item.id, ...input });
      if (input.status === 'done') {
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
      }
      if (input.recipeVariantId) setChoosingRecipe(false);
    } catch (error) {
      Alert.alert(
        '操作失败',
        error instanceof Error ? error.message : '请稍后再试',
      );
    } finally {
      if (input.status === 'rejected') setConfirmingReject(false);
    }
  };

  const selectAction = (action: ItemAction) => {
    if (action.destructive) {
      setConfirmingReject(true);
      return;
    }
    if (action.claim) {
      void applyChange({
        assignedToId: member.id,
        status: action.status,
      });
      return;
    }
    void applyChange({ status: action.status });
  };

  return (
    <>
      <View
        style={[
          styles.itemRow,
          {
            borderBottomColor: c.separator,
            backgroundColor: dimmed ? 'transparent' : c.tintSoft,
          },
        ]}
      >
        <Text style={{ fontSize: 28 }}>
          {CATEGORY_EMOJI[item.dish.category] ?? '🍽️'}
        </Text>
        <View style={styles.itemDetails}>
          <Text
            style={[
              t.headline,
              {
                color: dimmed ? c.tertiaryLabel : c.label,
                textDecorationLine: dimmed ? 'line-through' : 'none',
              },
            ]}
          >
            {item.dish.name}
          </Text>
          <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 2 }]}>
            {item.requestedBy.avatarEmoji} {item.requestedBy.name} 点的
            {item.note ? ` · ${item.note}` : ''}
          </Text>
          {item.statusReason ? (
            <Text style={[t.caption, { color: c.red, marginTop: 3 }]}>
              原因：{item.statusReason}
            </Text>
          ) : item.assignedTo ? (
            <Text style={[t.caption, { color: c.tint, marginTop: 3 }]}>
              {item.assignedTo.avatarEmoji} {item.assignedTo.name} 负责
            </Text>
          ) : null}
          {item.recipeSnapshot ? (
            <Pressable
              accessibilityRole="button"
              disabled={locked}
              onPress={() => setChoosingRecipe(true)}
              style={styles.recipeChoice}
            >
              <BookOpenText color={c.secondaryLabel} size={14} />
              <Text
                numberOfLines={1}
                style={[t.caption, { color: c.secondaryLabel, flex: 1 }]}
              >
                {item.recipeSnapshot.authorName
                  ? `${item.recipeSnapshot.authorName} · ${item.recipeSnapshot.name}`
                  : `家庭默认 · ${item.recipeSnapshot.name}`}
              </Text>
              {!locked ? <ChevronDown color={c.tertiaryLabel} size={14} /> : null}
            </Pressable>
          ) : null}
        </View>
        <View style={styles.itemStatus}>
          <Text
            style={[t.caption, { color: c[meta.colorKey], fontWeight: '600' }]}
          >
            {meta.label}
          </Text>
          {actions.length ? (
            <View style={styles.itemActions}>
              {actions.map((action) => (
                <PressableScale
                  disabled={update.isPending}
                  key={action.key}
                  onPress={() => selectAction(action)}
                  style={[
                    styles.actionBtn,
                    {
                      backgroundColor: action.destructive ? c.fill : c.tint,
                      opacity: update.isPending ? 0.5 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      t.footnote,
                      {
                        color: action.destructive
                          ? c.secondaryLabel
                          : '#FFFFFF',
                        fontWeight: '600',
                      },
                    ]}
                  >
                    {action.label}
                  </Text>
                </PressableScale>
              ))}
            </View>
          ) : null}
        </View>
      </View>

      <RejectDialog
        item={item}
        loading={update.isPending}
        onCancel={() => {
          if (!update.isPending) setConfirmingReject(false);
        }}
        onConfirm={(reason) =>
          void applyChange({ status: 'rejected', reason: reason || undefined })
        }
        visible={confirmingReject}
      />
      <Modal
        animationType="fade"
        onRequestClose={() => setChoosingRecipe(false)}
        transparent
        visible={choosingRecipe}
      >
        <View style={styles.dialogOverlay}>
          <Pressable
            accessibilityLabel="关闭做法选择"
            accessibilityRole="button"
            onPress={() => setChoosingRecipe(false)}
            style={StyleSheet.absoluteFill}
          />
          <View
            accessibilityViewIsModal
            style={[
              styles.recipeDialog,
              { backgroundColor: c.card, borderColor: c.separator },
            ]}
          >
            <Text style={[t.title2, { color: c.label }]}>选择「{item.dish.name}」的做法</Text>
            <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 6 }]}>
              本餐采购会按所选做法中的食材计算
            </Text>
            {recipesLoading ? (
              <ActivityIndicator color={c.tint} style={{ marginVertical: 28 }} />
            ) : (
              <ScrollView style={styles.recipeOptions}>
                {(recipeDish?.recipeVariants ?? []).map((variant) => {
                  const active = item.recipeVariantId === variant.id;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      disabled={update.isPending}
                      key={variant.id}
                      onPress={() =>
                        void applyChange({ recipeVariantId: variant.id })
                      }
                      style={[
                        styles.recipeOption,
                        {
                          backgroundColor: active ? c.tintSoft : c.bg,
                          borderColor: active ? c.tint : c.separator,
                        },
                      ]}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[t.headline, { color: c.label }]}>
                          {variant.isDefault
                            ? '家庭默认'
                            : `${variant.author?.avatarEmoji ?? '👤'} ${variant.author?.name ?? '家庭成员'}`}
                        </Text>
                        <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>
                          {variant.name}
                          {variant.estMinutes ? ` · 约 ${variant.estMinutes} 分钟` : ''}
                        </Text>
                      </View>
                      {active ? <Check color={c.tint} size={19} /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

function eventDescription(event: MenuEvent) {
  const actor = event.actor.name;
  const dish = event.menuItem?.dish.name;
  if (event.type === 'item_ordered') return `${actor} 点了「${dish ?? '一道菜'}」`;
  if (event.type === 'item_assigned') {
    return event.toValue
      ? `${actor} 将「${dish ?? '这道菜'}」交给 ${event.toValue}`
      : `${actor} 取消了「${dish ?? '这道菜'}」的认领`;
  }
  if (event.type === 'item_note_changed') {
    return `${actor} 更新了「${dish ?? '这道菜'}」的备注`;
  }
  if (event.type === 'meal_chef_assigned') {
    return event.toValue
      ? `${actor} 将本餐主厨设为 ${event.toValue}`
      : `${actor} 清除了本餐主厨`;
  }
  if (event.type === 'menu_completed') return `${actor} 结束并锁定了本餐`;
  if (event.toValue === 'accepted') return `${actor} 认领了「${dish ?? '这道菜'}」`;
  if (event.toValue === 'cooking') return `${actor} 开始制作「${dish ?? '这道菜'}」`;
  if (event.toValue === 'done') return `${actor} 将「${dish ?? '这道菜'}」标记为上桌`;
  if (event.toValue === 'pending') return `${actor} 恢复了「${dish ?? '这道菜'}」`;
  if (event.toValue === 'rejected') return `${actor} 划掉了「${dish ?? '这道菜'}」`;
  return `${actor} 更新了菜单`;
}

function eventTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function MealMenuSection({
  member,
  members,
  menu,
  onRemind,
}: {
  member: Member;
  members: Member[];
  menu: Menu;
  onRemind: () => void;
}) {
  const c = useTheme();
  const assignChef = useAssignMenuChef();
  const complete = useCompleteMenu();
  const confirmConsumption = useConfirmMenuConsumption();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmingComplete, setConfirmingComplete] = useState(false);
  const [confirmingConsumption, setConfirmingConsumption] = useState(false);
  const inventoryPreview = useMenuInventoryPreview(menu.id, menu.status === 'done');
  const { data: events, isLoading: eventsLoading } = useMenuEvents(
    menu.id,
    historyOpen,
  );
  const activeItems = menu.items.filter((item) => item.status !== 'rejected');
  const remaining = activeItems.filter((item) => item.status !== 'done').length;
  const locked = menu.status === 'done';
  const canComplete = activeItems.length > 0 && remaining === 0;
  const consumptionMessage = inventoryPreview.data?.rows
    .map((row) => {
      if (row.status === 'ready') {
        const allocations = [
          ...row.batchAllocations.map(
            (batch) =>
              `${batch.expiresOn ? `${batch.expiresOn} 到期` : `${batch.receivedOn} 入库`} -${batch.quantity}`,
          ),
          ...(row.untrackedQuantity > 0
            ? [`未分批库存 -${row.untrackedQuantity}`]
            : []),
        ];
        return `${row.inventoryItemName}：${row.quantityBefore} → ${row.quantityAfter} ${row.unit}（-${row.quantity}）${allocations.length ? `\n先进先出：${allocations.join('；')}` : ''}`;
      }
      if (row.status === 'missing_inventory') {
        return `${row.ingredientName}：未建立库存，本次跳过`;
      }
      if (row.status === 'unit_mismatch') {
        return `${row.ingredientName}：需要 ${row.unit}，现有单位 ${row.availableUnits.join('、')}`;
      }
      return `${row.inventoryItemName}：库存 ${row.quantityBefore} ${row.unit}，需要 ${row.quantity} ${row.unit}`;
    })
    .join('\n');

  const chooseChef = (chefId: string | null) => {
    assignChef.mutate(
      { menuId: menu.id, chefId },
      {
        onError: (error) =>
          Alert.alert(
            '设置失败',
            error instanceof Error ? error.message : '请稍后再试',
          ),
      },
    );
  };

  return (
    <>
      <View>
        <SectionHeader
          right={
            <View style={styles.sectionHeaderActions}>
              {!locked && activeItems.length && menu.date >= todayStr() ? (
                <Pressable
                  accessibilityLabel={`提醒${mealLabel(menu.mealType)}菜单`}
                  accessibilityRole="button"
                  onPress={onRemind}
                  style={({ pressed }) => [
                    styles.headerReminderButton,
                    { backgroundColor: pressed ? c.tintSoft : c.fill },
                  ]}
                >
                  <BellPlus color={c.tint} size={15} />
                </Pressable>
              ) : null}
              {locked ? (
                <View style={[styles.lockedBadge, { backgroundColor: c.fill }]}>
                  <LockKeyhole color={c.secondaryLabel} size={13} />
                  <Text style={[styles.badgeText, { color: c.secondaryLabel }]}>已结束</Text>
                </View>
              ) : activeItems.length ? (
                <View style={[styles.orderedBadge, { backgroundColor: c.tint }]}>
                  <UtensilsCrossed color="#FFFFFF" size={13} />
                  <Text style={styles.orderedBadgeText}>已点 {activeItems.length} 道</Text>
                </View>
              ) : null}
            </View>
          }
          title={mealLabel(menu.mealType)}
        />
        <Card
          style={
            activeItems.length
              ? { borderColor: locked ? c.separator : c.tint, borderWidth: 1.5, overflow: 'hidden' }
              : { overflow: 'hidden' }
          }
        >
          <View style={[styles.chefRow, { borderBottomColor: c.separator }]}>
            <View style={styles.chefLabel}>
              <ChefHat color={c.secondaryLabel} size={17} />
              <Text style={[t.footnote, { color: c.secondaryLabel, fontWeight: '600' }]}>
                本餐主厨
              </Text>
            </View>
            {locked ? (
              <Text style={[t.subhead, { color: c.label, fontWeight: '600' }]}>
                {menu.chef
                  ? `${menu.chef.avatarEmoji} ${menu.chef.name}`
                  : '未指定'}
              </Text>
            ) : (
              <View style={styles.chefOptions}>
                {[null, ...members].map((option) => {
                  const id = option?.id ?? null;
                  const active = menu.chefId === id;
                  return (
                    <PressableScale
                      disabled={assignChef.isPending}
                      haptic={false}
                      key={id ?? 'none'}
                      onPress={() => chooseChef(id)}
                      style={[
                        styles.chefOption,
                        {
                          backgroundColor: active ? c.tint : c.fill,
                          opacity: assignChef.isPending ? 0.55 : 1,
                        },
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        style={[
                          t.caption,
                          {
                            color: active ? '#FFFFFF' : c.label,
                            fontWeight: '600',
                          },
                        ]}
                      >
                        {option ? `${option.avatarEmoji} ${option.name}` : '未指定'}
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>
            )}
          </View>

          {menu.items.length === 0 ? (
            <Text
              style={[
                t.subhead,
                { color: c.tertiaryLabel, padding: 16, textAlign: 'center' },
              ]}
            >
              还没人点菜
            </Text>
          ) : (
            menu.items.map((item, index) => (
              <Animated.View
                entering={FadeInDown.delay(index * 40).springify().damping(18)}
                key={item.id}
              >
                <MenuItemRow item={item} locked={locked} member={member} />
              </Animated.View>
            ))
          )}

          <View style={[styles.menuFooter, { borderTopColor: c.separator }]}>
            <PressableScale
              haptic={false}
              onPress={() => setHistoryOpen((open) => !open)}
              style={styles.footerAction}
            >
              <History color={c.secondaryLabel} size={15} />
              <Text style={[t.footnote, { color: c.secondaryLabel, fontWeight: '600' }]}>
                操作记录
              </Text>
              {historyOpen ? (
                <ChevronUp color={c.secondaryLabel} size={14} />
              ) : (
                <ChevronDown color={c.secondaryLabel} size={14} />
              )}
            </PressableScale>

            {locked ? (
              <View style={styles.lockedActions}>
                <Text style={[t.footnote, { color: c.secondaryLabel }]}>
                  {menu.completedBy ? `${menu.completedBy.name} 已锁定` : '已锁定'}
                </Text>
                {inventoryPreview.isLoading ? (
                  <ActivityIndicator size="small" />
                ) : inventoryPreview.data?.confirmed ? (
                  <View
                    style={[
                      styles.inventoryState,
                      {
                        backgroundColor: inventoryPreview.data.reversed
                          ? c.fill
                          : c.greenSoft,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        t.caption,
                        {
                          color: inventoryPreview.data.reversed
                            ? c.secondaryLabel
                            : c.green,
                          fontWeight: '700',
                        },
                      ]}
                    >
                      {inventoryPreview.data.reversed ? '扣库已撤销' : '已确认扣库'}
                    </Text>
                  </View>
                ) : (
                  <PressableScale
                    accessibilityLabel={`确认${mealLabel(menu.mealType)}扣库`}
                    haptic={false}
                    onPress={() => {
                      if (inventoryPreview.data?.canConfirm) {
                        setConfirmingConsumption(true);
                      } else {
                        Alert.alert(
                          '暂时不能扣库',
                          consumptionMessage || '本餐没有可匹配扣减的库存项。',
                        );
                      }
                    }}
                    style={[styles.consumeButton, { backgroundColor: c.orangeSoft }]}
                  >
                    <PackageMinus color={c.orange} size={15} />
                    <Text style={[t.caption, { color: c.orange, fontWeight: '700' }]}>确认扣库</Text>
                  </PressableScale>
                )}
              </View>
            ) : canComplete ? (
              <PressableScale
                onPress={() => setConfirmingComplete(true)}
                style={[styles.completeButton, { backgroundColor: c.green }]}
              >
                <Check color="#FFFFFF" size={15} />
                <Text style={[t.footnote, { color: '#FFFFFF', fontWeight: '700' }]}>
                  结束本餐
                </Text>
              </PressableScale>
            ) : activeItems.length ? (
              <Text style={[t.footnote, { color: c.secondaryLabel }]}>
                还有 {remaining} 道未上桌
              </Text>
            ) : null}
          </View>

          {historyOpen ? (
            <View style={[styles.historyPanel, { borderTopColor: c.separator }]}>
              {eventsLoading ? <ActivityIndicator /> : null}
              {!eventsLoading && !events?.length ? (
                <Text style={[t.footnote, { color: c.tertiaryLabel }]}>暂无记录</Text>
              ) : null}
              {events?.map((event) => (
                <View key={event.id} style={styles.historyRow}>
                  <View style={[styles.historyDot, { backgroundColor: c.tint }]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[t.footnote, { color: c.label }]}>
                      {eventDescription(event)}
                    </Text>
                    {event.reason ? (
                      <Text style={[t.caption, { color: c.red, marginTop: 2 }]}>
                        原因：{event.reason}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[t.caption, { color: c.tertiaryLabel }]}>
                    {eventTime(event.createdAt)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      </View>

      <ConfirmDialog
        confirmLabel="结束并锁定"
        destructive={false}
        loading={complete.isPending}
        message="结束后这餐的主厨、菜品和状态将变为只读。"
        onCancel={() => {
          if (!complete.isPending) setConfirmingComplete(false);
        }}
        onConfirm={() => {
          complete.mutate(menu.id, {
            onSuccess: () => {
              setConfirmingComplete(false);
              void Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              );
            },
            onError: (error) => {
              setConfirmingComplete(false);
              Alert.alert(
                '结束失败',
                error instanceof Error ? error.message : '请稍后再试',
              );
            },
          });
        }}
        title={`结束${mealLabel(menu.mealType)}？`}
        visible={confirmingComplete}
      />
      <ConfirmDialog
        confirmLabel="确认扣减"
        destructive={false}
        loading={confirmConsumption.isPending}
        message={
          consumptionMessage ||
          (inventoryPreview.isLoading
            ? '正在计算库存变化。'
            : '本餐没有可匹配扣减的库存项。')
        }
        onCancel={() => {
          if (!confirmConsumption.isPending) setConfirmingConsumption(false);
        }}
        onConfirm={() => {
          confirmConsumption.mutate(menu.id, {
            onSuccess: (result) => {
              setConfirmingConsumption(false);
              void Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              );
              if (result.alreadyConfirmed) {
                Alert.alert('已经确认', '本餐没有重复扣减库存。');
              }
            },
            onError: (error) => {
              Alert.alert(
                '扣库失败',
                error instanceof Error ? error.message : '请稍后再试',
              );
            },
          });
        }}
        title={`确认${mealLabel(menu.mealType)}扣库？`}
        visible={confirmingConsumption}
      />
    </>
  );
}

function NotificationPanel({ notifications }: { notifications: AppNotification[] }) {
  const c = useTheme();
  const markRead = useMarkNotificationRead();
  if (!notifications.length) return null;

  return (
    <View>
      <SectionHeader title={`菜单提醒（${notifications.length}）`} />
      <Card style={{ overflow: 'hidden' }}>
        {notifications.map((notification) => (
          <View
            key={notification.id}
            style={[styles.notificationRow, { borderBottomColor: c.separator }]}
          >
            <View style={[styles.notificationIcon, { backgroundColor: c.orangeSoft }]}>
              <Bell color={c.orange} size={17} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.subhead, { color: c.label, fontWeight: '600' }]}>
                {notification.title}
              </Text>
              <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>
                {notification.body ?? '打开菜单查看详情'}
              </Text>
            </View>
            <PressableScale
              accessibilityLabel="标记提醒为已读"
              disabled={markRead.isPending}
              haptic={false}
              onPress={() => markRead.mutate(notification.id)}
              style={[styles.readButton, { backgroundColor: c.fill }]}
            >
              <Check color={c.tint} size={15} />
              <Text style={[t.caption, { color: c.tint, fontWeight: '700' }]}>知道了</Text>
            </PressableScale>
          </View>
        ))}
      </Card>
    </View>
  );
}

export default function KitchenScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const { member } = useSession();
  const params = useLocalSearchParams<{ date?: string | string[] }>();
  const parameterDate = Array.isArray(params.date) ? params.date[0] : params.date;
  const initialDate =
    parameterDate && /^\d{4}-\d{2}-\d{2}$/.test(parameterDate)
      ? parameterDate
      : todayStr();
  const [date, setDate] = useState(initialDate);
  const { data: members } = useMembers();
  const { data: menus, isLoading } = useMenusOfDate(date);
  const { data: allNotifications } = useNotifications();
  const notifications = allNotifications?.filter(
    (notification) => notification.module === 'menu',
  );
  const generate = useGenerateShoppingList();

  useEffect(() => {
    if (parameterDate && /^\d{4}-\d{2}-\d{2}$/.test(parameterDate)) {
      setDate(parameterDate);
    }
  }, [parameterDate]);

  const totalItems =
    menus?.reduce(
      (sum, menu) =>
        sum + menu.items.filter((item) => item.status !== 'rejected').length,
      0,
    ) ?? 0;
  const hasAnyItems = menus?.some((menu) => menu.items.length > 0) ?? false;
  const hasOpenItems =
    menus?.some(
      (menu) =>
        menu.status === 'open' &&
        menu.items.some((item) => item.status !== 'rejected'),
    ) ?? false;

  const onGenerate = async () => {
    try {
      const list = await generate.mutateAsync(date);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        '清单已生成',
        list.length
          ? `共 ${list.length} 项食材，去「购物清单」页查看`
          : '接单的菜都不缺食材（常备调料不进清单）',
      );
    } catch (error) {
      Alert.alert(
        '生成失败',
        error instanceof Error ? error.message : '请稍后再试',
      );
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <PageContainer
        maxWidth={900}
        style={[styles.page, desktop && styles.pageDesktop]}
      >
        <ModuleBackButton href="/canteen" label="家庭食堂" />
        <View style={[styles.header, !desktop && styles.headerMobile]}>
          <Text style={[t.largeTitle, { color: c.label }]}>菜单安排</Text>
          <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 4 }]}>
            分配主厨、认领菜品并查看进度
          </Text>
        </View>

        <View style={styles.dateControl}>
          <DateSelector value={date} onChange={setDate} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {notifications ? (
            <NotificationPanel notifications={notifications} />
          ) : null}

          {isLoading ? <ActivityIndicator style={{ marginTop: 48 }} /> : null}

          {member
            ? menus?.map((menu) => (
                <MealMenuSection
                  key={menu.id}
                  member={member}
                  members={members ?? []}
                  menu={menu}
                  onRemind={() =>
                    router.push({
                      pathname: '/reminders',
                      params: { sourceModule: 'menu', sourceId: menu.id },
                    })
                  }
                />
              ))
            : null}

          {!isLoading && !hasAnyItems ? (
            <EmptyState
              emoji="🍳"
              hint="等家人去「点菜」页下单吧"
              title="这天还没有安排"
            />
          ) : null}

          {totalItems > 0 && hasOpenItems ? (
            <View style={{ marginTop: 24 }}>
              <PressableScale
                disabled={generate.isPending}
                onPress={() => void onGenerate()}
                style={[styles.generateBtn, { backgroundColor: c.green }]}
              >
                {generate.isPending ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={[t.headline, { color: '#FFFFFF' }]}>
                    生成购物清单（按已认领的菜）
                  </Text>
                )}
              </PressableScale>
            </View>
          ) : null}
        </ScrollView>
      </PageContainer>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingTop: 8 },
  pageDesktop: { paddingTop: 22 },
  header: { paddingTop: 0 },
  headerMobile: { marginTop: 12 },
  dateControl: { marginTop: 14 },
  scrollContent: { paddingBottom: 32 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemDetails: { flex: 1, minWidth: 0, marginLeft: 10 },
  recipeChoice: {
    minHeight: 28,
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: 260,
  },
  itemStatus: { alignItems: 'flex-end', gap: 7, marginLeft: 8, maxWidth: 154 },
  itemActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 6,
  },
  actionBtn: {
    minHeight: 30,
    paddingHorizontal: 11,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recipeDialog: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '72%',
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 18,
  },
  recipeOptions: { marginTop: 14 },
  recipeOption: {
    minHeight: 62,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: 11,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  chefRow: {
    minHeight: 54,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  chefLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chefOptions: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 6,
  },
  chefOption: {
    maxWidth: 132,
    minHeight: 30,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  headerReminderButton: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderedBadge: {
    height: 26,
    borderRadius: radius.full,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  lockedBadge: {
    height: 26,
    borderRadius: radius.full,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  badgeText: { fontSize: 11, fontWeight: '800' },
  orderedBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  menuFooter: {
    minHeight: 48,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  footerAction: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  completeButton: {
    minHeight: 32,
    borderRadius: radius.sm,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  lockedActions: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 7,
  },
  consumeButton: {
    minHeight: 32,
    borderRadius: radius.sm,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  inventoryState: {
    minHeight: 30,
    borderRadius: radius.sm,
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyPanel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 9,
  },
  historyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  historyDot: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  notificationRow: {
    minHeight: 66,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  notificationIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readButton: {
    minHeight: 32,
    borderRadius: radius.sm,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  generateBtn: {
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogOverlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 25, 20, 0.38)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  rejectDialog: {
    width: '100%',
    maxWidth: 440,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 20,
  },
  reasonInput: {
    minHeight: 92,
    maxHeight: 150,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  dialogActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  dialogButton: {
    flex: 1,
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
