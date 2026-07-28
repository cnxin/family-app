import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import {
  Check,
  Clock3,
  Plus,
  Search,
  ShoppingBasket,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageContainer, useDesktopLayout } from '../../components/app-shell';
import { DateSelector } from '../../components/date-selector';
import { Card, PrimaryButton, Segmented } from '../../components/ui';
import { api, photoUri } from '../../lib/api';
import { useCart } from '../../lib/cart';
import { mealLabel, relativeDateLabel } from '../../lib/date';
import { useAddMenuItems, useDishes } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { CATEGORY_EMOJI, radius, type as t, useTheme } from '../../lib/theme';
import type { Dish, Menu } from '../../lib/types';

const CATEGORIES = ['全部', '荤菜', '素菜', '汤', '主食', '甜品'];

function CartPanel({ onSubmit, submitting }: { onSubmit: () => void; submitting: boolean }) {
  const c = useTheme();
  const cart = useCart();

  return (
    <Card style={styles.cartPanel}>
      <View style={styles.cartHeader}>
        <View>
          <Text style={[t.title2, { color: c.label }]}>你的菜单</Text>
          <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 4 }]}>
            {relativeDateLabel(cart.date)} · {mealLabel(cart.mealType)}
          </Text>
        </View>
        <View style={[styles.countBadge, { backgroundColor: c.tintSoft }]}>
          <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>
            {cart.entries.length} 道
          </Text>
        </View>
      </View>

      {cart.entries.length ? (
        <ScrollView style={styles.cartList} showsVerticalScrollIndicator={false}>
          {cart.entries.map((entry) => (
            <View key={entry.dish.id} style={[styles.cartItem, { borderBottomColor: c.separator }]}>
              <View style={[styles.cartItemEmoji, { backgroundColor: c.fill }]}>
                <Text style={{ fontSize: 20 }}>
                  {CATEGORY_EMOJI[entry.dish.category] ?? '🍽️'}
                </Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]} numberOfLines={1}>
                  {entry.dish.name}
                </Text>
                <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]} numberOfLines={1}>
                  {entry.note || entry.dish.category}
                </Text>
              </View>
              <Pressable
                accessibilityLabel={`移除${entry.dish.name}`}
                accessibilityRole="button"
                onPress={() => cart.remove(entry.dish.id)}
                style={({ pressed }) => [
                  styles.removeButton,
                  { backgroundColor: pressed ? c.redSoft : 'transparent' },
                ]}
              >
                <Trash2 color={c.red} size={17} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.emptyCart}>
          <View style={[styles.emptyCartIcon, { backgroundColor: c.tintSoft }]}>
            <ShoppingBasket color={c.tint} size={27} />
          </View>
          <Text style={[t.headline, { color: c.label, marginTop: 14 }]}>菜单还是空的</Text>
          <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 5, textAlign: 'center' }]}>
            从菜品列表中选择今天想吃的菜
          </Text>
        </View>
      )}

      <View style={[styles.cartFooter, { borderTopColor: c.separator }]}>
        {cart.entries.length ? (
          <Pressable
            accessibilityRole="button"
            onPress={cart.clear}
            style={styles.clearButton}
          >
            <Trash2 color={c.secondaryLabel} size={15} />
            <Text style={[t.footnote, { color: c.secondaryLabel, fontWeight: '600' }]}>清空</Text>
          </Pressable>
        ) : null}
        <PrimaryButton
          title="提交菜单"
          onPress={onSubmit}
          disabled={!cart.entries.length}
          loading={submitting}
          icon={!submitting ? <Check color="#FFFFFF" size={18} /> : undefined}
        />
      </View>
    </Card>
  );
}

export default function OrderScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { member } = useSession();
  const cart = useCart();
  const { data: dishes, isLoading, error } = useDishes();
  const addItems = useAddMenuItems();
  const [category, setCategory] = useState('全部');
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const columns = desktop ? (width >= 1720 ? 4 : 3) : 2;

  const filtered = useMemo(() => {
    let list = dishes ?? [];
    if (category !== '全部') list = list.filter((dish) => dish.category === category);
    if (search.trim()) list = list.filter((dish) => dish.name.includes(search.trim()));
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
        items: cart.entries.map((entry) => ({
          dishId: entry.dish.id,
          note: entry.note || undefined,
        })),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const count = cart.entries.length;
      cart.clear();
      Alert.alert(
        '菜单已提交',
        `${count} 道菜已经加入${relativeDateLabel(cart.date)}${mealLabel(cart.mealType)}`,
      );
    } catch (submitError) {
      Alert.alert('提交失败', submitError instanceof Error ? submitError.message : '稍后再试');
    } finally {
      setSubmitting(false);
    }
  };

  const renderDish = ({ item, index }: { item: Dish; index: number }) => {
    const inCart = cart.has(item.id);
    const maxWidth = columns === 4 ? '24%' : columns === 3 ? '31.8%' : '48.4%';
    return (
      <Animated.View
        entering={FadeInDown.delay(Math.min(index, 8) * 35).springify().damping(19)}
        style={[styles.gridItem, { maxWidth }]}
      >
        <Card
          style={[
            styles.dishCard,
            { borderColor: inCart ? c.tint : c.separator },
          ]}
        >
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push(`/dish/${item.id}`)}
          >
            {item.photoUrl ? (
              <Image
                source={{ uri: photoUri(item.photoUrl)! }}
                style={[styles.dishPhoto, desktop && styles.dishPhotoDesktop]}
                contentFit="cover"
                transition={200}
              />
            ) : (
              <View
                style={[
                  styles.dishPhoto,
                  desktop && styles.dishPhotoDesktop,
                  styles.dishPlaceholder,
                  { backgroundColor: c.fill },
                ]}
              >
                <Text style={{ fontSize: desktop ? 44 : 36 }}>
                  {CATEGORY_EMOJI[item.category] ?? '🍽️'}
                </Text>
              </View>
            )}
            <View style={styles.dishInfo}>
              <Text style={[t.headline, { color: c.label }]} numberOfLines={1}>
                {item.name}
              </Text>
              <View style={styles.dishMeta}>
                <Clock3 color={c.secondaryLabel} size={14} />
                <Text style={[t.caption, { color: c.secondaryLabel }]}>
                  {item.estMinutes ? `${item.estMinutes} 分钟` : '时间灵活'}
                </Text>
                <Text style={[t.caption, { color: c.tertiaryLabel }]}>· 难度 {item.difficulty}</Text>
              </View>
            </View>
          </Pressable>
          <Pressable
            accessibilityLabel={inCart ? `移除${item.name}` : `添加${item.name}`}
            accessibilityRole="button"
            onPress={() => {
              void Haptics.selectionAsync();
              if (inCart) cart.remove(item.id);
              else cart.add(item);
            }}
            style={({ pressed }) => [
              styles.addButton,
              {
                backgroundColor: inCart ? c.tint : pressed ? c.tintSoft : c.card,
                borderColor: inCart ? c.tint : c.separator,
              },
            ]}
          >
            {inCart ? <Check color="#FFFFFF" size={17} /> : <Plus color={c.tint} size={18} />}
          </Pressable>
        </Card>
      </Animated.View>
    );
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <PageContainer style={[styles.content, desktop && styles.contentDesktop]}>
        <View style={[styles.header, desktop && styles.headerDesktop]}>
          <View style={{ flex: 1 }}>
            <Text style={[t.largeTitle, { color: c.label }]}>点菜</Text>
            <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 4 }]}>
              {member?.name}，这顿想吃点什么？
            </Text>
          </View>
          <View style={[styles.dishCount, { backgroundColor: c.card, borderColor: c.separator }]}>
            <UtensilsCrossed color={c.tint} size={17} />
            <Text style={[t.footnote, { color: c.secondaryLabel }]}>共 {dishes?.length ?? 0} 道家常菜</Text>
          </View>
        </View>

        <View style={[styles.controls, desktop && styles.controlsDesktop]}>
          <DateSelector
            value={cart.date}
            onChange={(date) => cart.setTarget(date, cart.mealType)}
          />
          <View style={styles.mealGroup}>
            <Segmented
              options={[
                { label: '早餐', value: 'breakfast' as const },
                { label: '午餐', value: 'lunch' as const },
                { label: '晚餐', value: 'dinner' as const },
              ]}
              value={cart.mealType}
              onChange={(mealType) => cart.setTarget(cart.date, mealType)}
            />
          </View>
          <View
            style={[
              styles.searchBox,
              { backgroundColor: c.card, borderColor: c.separator },
              desktop && styles.searchBoxDesktop,
            ]}
          >
            <Search color={c.tertiaryLabel} size={18} />
            <TextInput
              style={[styles.searchInput, { color: c.label }]}
              placeholder="搜索菜名"
              placeholderTextColor={c.tertiaryLabel}
              value={search}
              onChangeText={setSearch}
              clearButtonMode="while-editing"
            />
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categories}
          style={styles.categoriesScroll}
        >
          {CATEGORIES.map((item) => {
            const active = item === category;
            return (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setCategory(item);
                }}
                style={({ pressed }) => [
                  styles.categoryButton,
                  {
                    backgroundColor: active ? c.tint : pressed ? c.fillStrong : c.card,
                    borderColor: active ? c.tint : c.separator,
                  },
                ]}
              >
                <Text
                  style={[
                    t.footnote,
                    { color: active ? '#FFFFFF' : c.label, fontWeight: active ? '700' : '600' },
                  ]}
                >
                  {item}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={[styles.workspace, desktop && styles.workspaceDesktop]}>
          <View style={styles.dishList}>
            {isLoading ? (
              <ActivityIndicator color={c.tint} style={{ marginTop: 80 }} />
            ) : error ? (
              <View style={styles.listMessage}>
                <Text style={[t.headline, { color: c.red }]}>菜品加载失败</Text>
                <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 5 }]}>请检查 API 服务</Text>
              </View>
            ) : (
              <FlatList
                key={`dish-grid-${columns}`}
                data={filtered}
                renderItem={renderDish}
                keyExtractor={(dish) => dish.id}
                numColumns={columns}
                columnWrapperStyle={styles.gridRow}
                contentContainerStyle={{ gap: 12, paddingBottom: desktop ? 20 : 120 }}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  <View style={styles.listMessage}>
                    <Search color={c.tertiaryLabel} size={25} />
                    <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 8 }]}>没有匹配的菜品</Text>
                  </View>
                }
              />
            )}
          </View>

          {desktop ? <CartPanel onSubmit={() => void submit()} submitting={submitting} /> : null}
        </View>

        {!desktop && cart.entries.length ? (
          <Animated.View
            entering={FadeInUp.springify().damping(18)}
            style={[
              styles.mobileCart,
              { backgroundColor: c.card, borderColor: c.separator },
            ]}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.headline, { color: c.label }]}>已选 {cart.entries.length} 道菜</Text>
              <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]} numberOfLines={1}>
                {cart.entries.map((entry) => entry.dish.name).join('、')}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => void submit()}
              disabled={submitting}
              style={[styles.mobileSubmit, { backgroundColor: c.tint }]}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Check color="#FFFFFF" size={17} />
                  <Text style={[t.subhead, { color: '#FFFFFF', fontWeight: '700' }]}>提交</Text>
                </>
              )}
            </Pressable>
          </Animated.View>
        ) : null}
      </PageContainer>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1, paddingTop: 8 },
  contentDesktop: { paddingTop: 22, paddingBottom: 20 },
  header: { gap: 12 },
  headerDesktop: { flexDirection: 'row', alignItems: 'center' },
  dishCount: {
    height: 36,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 7,
  },
  controls: { gap: 10, marginTop: 16 },
  controlsDesktop: { flexDirection: 'row', alignItems: 'center' },
  mealGroup: { width: 270, maxWidth: '100%' },
  searchBox: {
    height: 40,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchBoxDesktop: { flex: 1, maxWidth: 360 },
  searchInput: { flex: 1, height: '100%', fontSize: 15, paddingVertical: 0 },
  categoriesScroll: { flexGrow: 0, marginTop: 14, marginBottom: 14 },
  categories: { gap: 8, paddingRight: 8 },
  categoryButton: {
    minWidth: 62,
    height: 34,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workspace: { flex: 1, minHeight: 0 },
  workspaceDesktop: { flexDirection: 'row', gap: 18 },
  dishList: { flex: 1, minWidth: 0 },
  gridRow: { gap: 12 },
  gridItem: { flex: 1, minWidth: 0 },
  dishCard: { overflow: 'hidden', position: 'relative' },
  dishPhoto: { width: '100%', height: 106 },
  dishPhotoDesktop: { height: 132 },
  dishPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  dishInfo: { paddingHorizontal: 12, paddingVertical: 11, paddingRight: 46 },
  dishMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  addButton: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listMessage: { alignItems: 'center', justifyContent: 'center', paddingVertical: 80 },
  cartPanel: { width: 320, minHeight: 0, padding: 18 },
  cartHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  countBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: radius.full },
  cartList: { flex: 1, marginTop: 18 },
  cartItem: {
    minHeight: 62,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cartItemEmoji: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButton: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCart: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  emptyCartIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartFooter: { borderTopWidth: 1, paddingTop: 14, gap: 10 },
  clearButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 5 },
  mobileCart: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    minHeight: 66,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  mobileSubmit: {
    height: 40,
    borderRadius: radius.sm,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
});
