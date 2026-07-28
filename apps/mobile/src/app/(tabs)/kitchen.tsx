import * as Haptics from 'expo-haptics';
import { UtensilsCrossed } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageContainer, useDesktopLayout } from '../../components/app-shell';
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
  useGenerateShoppingList,
  useMenusOfDate,
  useUpdateMenuItem,
} from '../../lib/queries';
import { CATEGORY_EMOJI, radius, type as t, useTheme } from '../../lib/theme';
import type { MenuItem, MenuItemStatus } from '../../lib/types';

const STATUS_META: Record<
  MenuItemStatus,
  { label: string; colorKey: 'orange' | 'tint' | 'green' | 'secondaryLabel' }
> = {
  pending: { label: '待接单', colorKey: 'orange' },
  accepted: { label: '已接单', colorKey: 'tint' },
  cooking: { label: '做菜中', colorKey: 'orange' },
  done: { label: '已上桌', colorKey: 'green' },
  rejected: { label: '已划掉', colorKey: 'secondaryLabel' },
};

// 每个状态可执行的下一步操作
const ACTIONS: Partial<
  Record<MenuItemStatus, { label: string; to: MenuItemStatus }[]>
> = {
  pending: [
    { label: '接单', to: 'accepted' },
    { label: '划掉', to: 'rejected' },
  ],
  accepted: [
    { label: '开做', to: 'cooking' },
    { label: '划掉', to: 'rejected' },
  ],
  cooking: [{ label: '上桌 ✓', to: 'done' }],
  rejected: [{ label: '恢复', to: 'pending' }],
};

function MenuItemRow({ item }: { item: MenuItem }) {
  const c = useTheme();
  const update = useUpdateMenuItem();
  const [confirmingReject, setConfirmingReject] = useState(false);
  const meta = STATUS_META[item.status];
  const dimmed = item.status === 'rejected';

  const changeStatus = async (status: MenuItemStatus) => {
    try {
      await update.mutateAsync({ id: item.id, status });
      if (status === 'done') {
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
      }
    } catch (error) {
      Alert.alert(
        '操作失败',
        error instanceof Error ? error.message : '请稍后再试',
      );
    } finally {
      if (status === 'rejected') setConfirmingReject(false);
    }
  };

  const selectAction = (status: MenuItemStatus) => {
    if (status === 'rejected') {
      setConfirmingReject(true);
      return;
    }
    void changeStatus(status);
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
        <View style={{ flex: 1, marginLeft: 10 }}>
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
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <Text
            style={[t.caption, { color: c[meta.colorKey], fontWeight: '600' }]}
          >
            {meta.label}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {(ACTIONS[item.status] ?? []).map((action) => (
              <PressableScale
                key={action.to}
                disabled={update.isPending}
                onPress={() => selectAction(action.to)}
                style={[
                  styles.actionBtn,
                  {
                    backgroundColor:
                      action.to === 'rejected' ? c.fill : c.tint,
                    opacity: update.isPending ? 0.5 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    t.footnote,
                    {
                      color:
                        action.to === 'rejected' ? c.secondaryLabel : '#FFF',
                      fontWeight: '600',
                    },
                  ]}
                >
                  {action.label}
                </Text>
              </PressableScale>
            ))}
          </View>
        </View>
      </View>

      <ConfirmDialog
        confirmLabel="划掉"
        loading={update.isPending}
        message="划掉后会从有效菜单和购物清单统计中移除，之后仍可恢复。"
        onCancel={() => {
          if (!update.isPending) setConfirmingReject(false);
        }}
        onConfirm={() => void changeStatus('rejected')}
        title={`划掉「${item.dish.name}」？`}
        visible={confirmingReject}
      />
    </>
  );
}

export default function KitchenScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const [date, setDate] = useState(todayStr());
  const { data: menus, isLoading } = useMenusOfDate(date);
  const generate = useGenerateShoppingList();

  const totalItems =
    menus?.reduce(
      (sum, m) => sum + m.items.filter((i) => i.status !== 'rejected').length,
      0,
    ) ?? 0;
  const hasAnyItems = menus?.some((menu) => menu.items.length > 0) ?? false;

  const onGenerate = async () => {
    try {
      const list = await generate.mutateAsync(date);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        '清单已生成 🧾',
        list.length
          ? `共 ${list.length} 项食材，去「购物清单」页查看`
          : '接单的菜都不缺食材（常备调料不进清单）',
      );
    } catch (e) {
      Alert.alert('生成失败', e instanceof Error ? e.message : '稍后再试');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <PageContainer
        maxWidth={900}
        style={[styles.page, desktop && styles.pageDesktop]}
      >
        <View style={styles.header}>
          <Text style={[t.largeTitle, { color: c.label }]}>菜单安排</Text>
          <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 4 }]}>查看接单进度并准备购物清单</Text>
        </View>

        <View style={styles.dateControl}>
          <DateSelector value={date} onChange={setDate} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
        {isLoading ? <ActivityIndicator style={{ marginTop: 48 }} /> : null}

        {menus?.map((menu) => {
          const activeCount = menu.items.filter((item) => item.status !== 'rejected').length;
          return (
            <View key={menu.id}>
              <SectionHeader
                title={mealLabel(menu.mealType)}
                right={
                  activeCount ? (
                    <View style={[styles.orderedBadge, { backgroundColor: c.tint }]}>
                      <UtensilsCrossed color="#FFFFFF" size={13} />
                      <Text style={styles.orderedBadgeText}>已点 {activeCount} 道</Text>
                    </View>
                  ) : undefined
                }
              />
              <Card
                style={
                  activeCount
                    ? { borderColor: c.tint, borderWidth: 1.5, overflow: 'hidden' }
                    : undefined
                }
              >
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
                  menu.items.map((item, i) => (
                    <Animated.View
                      key={item.id}
                      entering={FadeInDown.delay(i * 40).springify().damping(18)}
                    >
                      <MenuItemRow item={item} />
                    </Animated.View>
                  ))
                )}
              </Card>
            </View>
          );
        })}

        {!isLoading && !hasAnyItems ? (
          <EmptyState
            emoji="🍳"
            title="这天还没有安排"
            hint="等家人去「点菜」页下单吧"
          />
        ) : null}

        {totalItems > 0 ? (
          <View style={{ marginTop: 24 }}>
            <PressableScale
              onPress={() => void onGenerate()}
              disabled={generate.isPending}
              style={[styles.generateBtn, { backgroundColor: c.green }]}
            >
              {generate.isPending ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={[t.headline, { color: '#FFF' }]}>
                  🧾 生成购物清单（按已接单的菜）
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
  dateControl: { marginTop: 14 },
  scrollContent: { paddingBottom: 32 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.full,
  },
  orderedBadge: {
    height: 26,
    borderRadius: radius.full,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  orderedBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  generateBtn: {
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
