import * as Haptics from 'expo-haptics';
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
import {
  Card,
  EmptyState,
  PressableScale,
  SectionHeader,
  Segmented,
} from '../../components/ui';
import { todayStr } from '../../lib/cart';
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
const ACTIONS: Partial<Record<MenuItemStatus, { label: string; to: MenuItemStatus }[]>> = {
  pending: [
    { label: '接单', to: 'accepted' },
    { label: '划掉', to: 'rejected' },
  ],
  accepted: [
    { label: '开做', to: 'cooking' },
    { label: '划掉', to: 'rejected' },
  ],
  cooking: [{ label: '上桌 ✓', to: 'done' }],
};

function MenuItemRow({ item }: { item: MenuItem }) {
  const c = useTheme();
  const update = useUpdateMenuItem();
  const meta = STATUS_META[item.status];
  const dimmed = item.status === 'rejected';

  return (
    <View style={[styles.itemRow, { borderBottomColor: c.separator }]}>
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
        <Text style={[t.caption, { color: c[meta.colorKey], fontWeight: '600' }]}>
          {meta.label}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {(ACTIONS[item.status] ?? []).map((action) => (
            <PressableScale
              key={action.to}
              onPress={() => {
                if (action.to === 'done') {
                  void Haptics.notificationAsync(
                    Haptics.NotificationFeedbackType.Success,
                  );
                }
                update.mutate({ id: item.id, status: action.to });
              }}
              style={[
                styles.actionBtn,
                {
                  backgroundColor:
                    action.to === 'rejected' ? c.fill : c.tint,
                },
              ]}
            >
              <Text
                style={[
                  t.footnote,
                  {
                    color: action.to === 'rejected' ? c.secondaryLabel : '#FFF',
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
  );
}

export default function KitchenScreen() {
  const c = useTheme();
  const [date, setDate] = useState(todayStr());
  const { data: menus, isLoading, refetch } = useMenusOfDate(date);
  const generate = useGenerateShoppingList();

  const totalItems =
    menus?.reduce(
      (sum, m) => sum + m.items.filter((i) => i.status !== 'rejected').length,
      0,
    ) ?? 0;

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
      <View style={styles.header}>
        <Text style={[t.largeTitle, { color: c.label }]}>今日菜单</Text>
      </View>

      <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
        <Segmented
          options={[
            { label: '今天', value: todayStr() },
            { label: '明天', value: todayStr(1) },
          ]}
          value={date}
          onChange={setDate}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? <ActivityIndicator style={{ marginTop: 48 }} /> : null}

        {menus?.map((menu) => (
          <View key={menu.id}>
            <SectionHeader
              title={menu.mealType === 'lunch' ? '午餐' : '晚餐'}
            />
            <Card>
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
        ))}

        {!isLoading && totalItems === 0 ? (
          <EmptyState
            emoji="🍳"
            title="厨房今天很清闲"
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 8 },
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
  generateBtn: {
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
