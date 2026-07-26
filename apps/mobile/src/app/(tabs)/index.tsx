import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PressableScale, Segmented } from '../../components/ui';
import { api, photoUri } from '../../lib/api';
import { todayStr, useCart } from '../../lib/cart';
import { useAddMenuItems, useDishes } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { CATEGORY_EMOJI, radius, type as t, useTheme } from '../../lib/theme';
import type { Dish, Menu } from '../../lib/types';

const CATEGORIES = ['全部', '荤菜', '素菜', '汤', '主食', '甜品'];

export default function OrderScreen() {
  const c = useTheme();
  const router = useRouter();
  const { member } = useSession();
  const cart = useCart();
  const { data: dishes, isLoading } = useDishes();
  const addItems = useAddMenuItems();
  const [category, setCategory] = useState('全部');
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const dayOffset = cart.date === todayStr() ? 0 : 1;

  const filtered = useMemo(() => {
    let list = dishes ?? [];
    if (category !== '全部') list = list.filter((d) => d.category === category);
    if (search.trim()) list = list.filter((d) => d.name.includes(search.trim()));
    return list;
  }, [dishes, category, search]);

  const submit = async () => {
    if (!cart.entries.length) return;
    setSubmitting(true);
    try {
      const menu = await api<Menu>(
        `/menus?date=${cart.date}&mealType=${cart.mealType}`,
      );
      await addItems.mutateAsync({
        menuId: menu.id,
        items: cart.entries.map((e) => ({
          dishId: e.dish.id,
          note: e.note || undefined,
        })),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const count = cart.entries.length;
      cart.clear();
      Alert.alert(
        '点好啦 🎉',
        `${count} 道菜已加入${dayOffset === 0 ? '今天' : '明天'}${cart.mealType === 'lunch' ? '午餐' : '晚餐'}菜单`,
      );
    } catch (e) {
      Alert.alert('提交失败', e instanceof Error ? e.message : '稍后再试');
    } finally {
      setSubmitting(false);
    }
  };

  const renderDish = ({ item, index }: { item: Dish; index: number }) => {
    const inCart = cart.has(item.id);
    return (
      <Animated.View
        entering={FadeInDown.delay(Math.min(index, 8) * 40).springify().damping(18)}
        style={styles.gridItem}
      >
        <PressableScale
          onPress={() => router.push(`/dish/${item.id}`)}
          style={[
            styles.dishCard,
            { backgroundColor: c.card, borderColor: inCart ? c.tint : 'transparent' },
          ]}
        >
          {item.photoUrl ? (
            <Image
              source={{ uri: photoUri(item.photoUrl)! }}
              style={styles.dishPhoto}
              contentFit="cover"
              transition={200}
            />
          ) : (
            <View style={[styles.dishPhoto, { backgroundColor: c.fill, ...styles.center }]}>
              <Text style={{ fontSize: 40 }}>
                {CATEGORY_EMOJI[item.category] ?? '🍽️'}
              </Text>
            </View>
          )}
          <View style={{ padding: 10 }}>
            <Text style={[t.headline, { color: c.label }]} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 2 }]}>
              {'🔥'.repeat(item.difficulty)}
              {item.estMinutes ? ` · ${item.estMinutes}分钟` : ''}
            </Text>
          </View>
          {inCart ? (
            <View style={[styles.badge, { backgroundColor: c.tint }]}>
              <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '700' }}>✓</Text>
            </View>
          ) : null}
        </PressableScale>
      </Animated.View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <View style={styles.header}>
        <Text style={[t.largeTitle, { color: c.label }]}>点菜</Text>
        <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 2 }]}>
          {member?.name}，今天想吃点什么？
        </Text>
      </View>

      <View style={styles.controls}>
        <View style={{ flex: 1 }}>
          <Segmented
            options={[
              { label: '今天', value: todayStr() },
              { label: '明天', value: todayStr(1) },
            ]}
            value={cart.date}
            onChange={(d) => cart.setTarget(d, cart.mealType)}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Segmented
            options={[
              { label: '午餐', value: 'lunch' as const },
              { label: '晚餐', value: 'dinner' as const },
            ]}
            value={cart.mealType}
            onChange={(m) => cart.setTarget(cart.date, m)}
          />
        </View>
      </View>

      <TextInput
        style={[styles.search, { backgroundColor: c.fill, color: c.label }]}
        placeholder="搜索菜名"
        placeholderTextColor={c.tertiaryLabel}
        value={search}
        onChangeText={setSearch}
        clearButtonMode="while-editing"
      />

      <View style={styles.chips}>
        {CATEGORIES.map((cat) => {
          const active = cat === category;
          return (
            <Pressable
              key={cat}
              onPress={() => {
                void Haptics.selectionAsync();
                setCategory(cat);
              }}
              style={[
                styles.chip,
                { backgroundColor: active ? c.tint : c.fill },
              ]}
            >
              <Text
                style={[
                  t.subhead,
                  { color: active ? '#FFF' : c.label, fontWeight: active ? '600' : '400' },
                ]}
              >
                {cat}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 48 }} />
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderDish}
          keyExtractor={(d) => d.id}
          numColumns={2}
          columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
          contentContainerStyle={{ gap: 12, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {cart.entries.length > 0 ? (
        <Animated.View
          entering={FadeInUp.springify().damping(18)}
          style={[styles.cartBar, { backgroundColor: c.card, shadowColor: '#000' }]}
        >
          <View>
            <Text style={[t.headline, { color: c.label }]}>
              已点 {cart.entries.length} 道
            </Text>
            <Text style={[t.footnote, { color: c.secondaryLabel }]} numberOfLines={1}>
              {cart.entries.map((e) => e.dish.name).join('、')}
            </Text>
          </View>
          <PressableScale
            onPress={() => void submit()}
            disabled={submitting}
            style={[styles.submitBtn, { backgroundColor: c.tint }]}
          >
            {submitting ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={[t.headline, { color: '#FFF' }]}>提交</Text>
            )}
          </PressableScale>
        </Animated.View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 8 },
  controls: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    marginTop: 14,
  },
  search: {
    marginHorizontal: 16,
    marginTop: 10,
    height: 38,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    marginVertical: 12,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  gridItem: { flex: 1 },
  dishCard: {
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 2,
  },
  dishPhoto: { width: '100%', height: 110 },
  center: { alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 12,
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  submitBtn: {
    paddingHorizontal: 24,
    height: 42,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
});
