import {
  ArrowRight,
  BookOpenText,
  CheckCircle2,
  Clock3,
  CookingPot,
  ShoppingCart,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageContainer, useDesktopLayout } from '../../components/app-shell';
import { Card } from '../../components/ui';
import { mealLabel, todayStr } from '../../lib/date';
import { useDishes, useMenusOfDate, useShoppingList } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { CATEGORY_EMOJI, Palette, radius, type as t, useTheme } from '../../lib/theme';
import type { MealType, Menu } from '../../lib/types';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 11) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function fullDate() {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());
}

function MetricCard({
  icon: Icon,
  iconColor,
  iconBackground,
  value,
  label,
}: {
  icon: LucideIcon;
  iconColor: string;
  iconBackground: string;
  value: number;
  label: string;
}) {
  const c = useTheme();
  return (
    <Card style={styles.metricCard}>
      <View style={[styles.metricIcon, { backgroundColor: iconBackground }]}>
        <Icon size={19} color={iconColor} />
      </View>
      <Text style={[styles.metricValue, { color: c.label }]}>{value}</Text>
      <Text style={[t.footnote, { color: c.secondaryLabel }]} numberOfLines={1}>
        {label}
      </Text>
    </Card>
  );
}

function MealSection({
  mealType,
  menu,
  palette,
}: {
  mealType: MealType;
  menu?: Menu;
  palette: Palette;
}) {
  const label = mealLabel(mealType);
  const activeItems = menu?.items.filter((item) => item.status !== 'rejected') ?? [];

  return (
    <View style={styles.mealSection}>
      <View style={styles.mealHeading}>
        <Text style={[t.subhead, { color: palette.label, fontWeight: '700' }]}>{label}</Text>
        <Text style={[t.caption, { color: palette.secondaryLabel }]}>
          {activeItems.length ? `${activeItems.length} 道` : '待安排'}
        </Text>
      </View>
      {activeItems.length ? (
        activeItems.slice(0, 4).map((item) => (
          <View key={item.id} style={styles.mealItem}>
            <Text style={styles.mealEmoji}>
              {CATEGORY_EMOJI[item.dish.category] ?? '🍽️'}
            </Text>
            <Text style={[t.subhead, { color: palette.label, flex: 1 }]} numberOfLines={1}>
              {item.dish.name}
            </Text>
            <Text style={[t.caption, { color: palette.secondaryLabel }]}>
              {item.status === 'done' ? '已上桌' : item.status === 'cooking' ? '制作中' : '已点'}
            </Text>
          </View>
        ))
      ) : (
        <View style={[styles.emptyMeal, { backgroundColor: palette.fill }]}>
          <Clock3 color={palette.tertiaryLabel} size={17} />
          <Text style={[t.footnote, { color: palette.secondaryLabel }]}>还没有点菜</Text>
        </View>
      )}
    </View>
  );
}

export default function HomeScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const { member } = useSession();
  const date = todayStr();
  const { data: menus, isLoading: menusLoading } = useMenusOfDate(date);
  const { data: shopping, isLoading: shoppingLoading } = useShoppingList(date);
  const { data: dishes } = useDishes();

  const menuItems =
    menus?.reduce(
      (total, menu) => total + menu.items.filter((item) => item.status !== 'rejected').length,
      0,
    ) ?? 0;
  const shoppingTotal = shopping?.length ?? 0;
  const shoppingDone = shopping?.filter((item) => item.checked).length ?? 0;
  const shoppingPending = shoppingTotal - shoppingDone;
  const progress = shoppingTotal ? shoppingDone / shoppingTotal : 0;
  const breakfast = menus?.find((menu) => menu.mealType === 'breakfast');
  const lunch = menus?.find((menu) => menu.mealType === 'lunch');
  const dinner = menus?.find((menu) => menu.mealType === 'dinner');

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <PageContainer style={[styles.content, desktop && styles.contentDesktop]}>
          <View style={[styles.hero, desktop && styles.heroDesktop]}>
            <View style={{ flex: 1 }}>
              <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>家庭今日概览</Text>
              <Text style={[t.largeTitle, { color: c.label, marginTop: 6 }]}>
                {greeting()}，{member?.name}
              </Text>
              <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 6 }]}>{fullDate()}</Text>
            </View>
            <Pressable
              onPress={() => router.push('/order')}
              style={({ pressed }) => [
                styles.orderButton,
                { backgroundColor: pressed ? c.cardPressed : c.tint },
              ]}
            >
              <UtensilsCrossed color="#FFFFFF" size={18} />
              <Text style={[t.subhead, { color: '#FFFFFF', fontWeight: '700' }]}>开始点菜</Text>
              <ArrowRight color="#FFFFFF" size={17} />
            </Pressable>
          </View>

          <View style={styles.metrics}>
            <MetricCard
              icon={CookingPot}
              iconColor={c.tint}
              iconBackground={c.tintSoft}
              value={menuItems}
              label="今日菜品"
            />
            <MetricCard
              icon={ShoppingCart}
              iconColor={c.orange}
              iconBackground={c.orangeSoft}
              value={shoppingPending}
              label="待购物"
            />
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push('/recipes')}
              style={styles.metricLink}
            >
              <MetricCard
                icon={BookOpenText}
                iconColor={c.blue}
                iconBackground={c.blueSoft}
                value={dishes?.length ?? 0}
                label="家庭菜谱"
              />
            </Pressable>
          </View>

          <View style={[styles.mainGrid, desktop && styles.mainGridDesktop]}>
            <View style={styles.menuColumn}>
              <View style={styles.sectionTitleRow}>
                <View>
                  <Text style={[t.title2, { color: c.label }]}>今天吃什么</Text>
                  <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>早餐、午餐和晚餐安排</Text>
                </View>
                <Pressable onPress={() => router.push('/kitchen')} style={styles.textLink}>
                  <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]}>查看菜单</Text>
                  <ArrowRight color={c.tint} size={16} />
                </Pressable>
              </View>
              <Card style={styles.menuCard}>
                {menusLoading ? (
                  <ActivityIndicator color={c.tint} style={styles.loader} />
                ) : (
                  <View style={[styles.meals, desktop && styles.mealsDesktop]}>
                    <MealSection mealType="breakfast" menu={breakfast} palette={c} />
                    <View
                      style={[
                        desktop ? styles.mealDividerDesktop : styles.mealDivider,
                        { backgroundColor: c.separator },
                      ]}
                    />
                    <MealSection mealType="lunch" menu={lunch} palette={c} />
                    <View
                      style={[
                        desktop ? styles.mealDividerDesktop : styles.mealDivider,
                        { backgroundColor: c.separator },
                      ]}
                    />
                    <MealSection mealType="dinner" menu={dinner} palette={c} />
                  </View>
                )}
              </Card>
            </View>

            <View style={styles.shoppingColumn}>
              <View style={styles.sectionTitleRow}>
                <View>
                  <Text style={[t.title2, { color: c.label }]}>购物进度</Text>
                  <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>今天的采购清单</Text>
                </View>
                <Pressable onPress={() => router.push('/shopping')} style={styles.textLink}>
                  <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]}>去购物</Text>
                  <ArrowRight color={c.tint} size={16} />
                </Pressable>
              </View>
              <Card style={styles.shoppingCard}>
                {shoppingLoading ? (
                  <ActivityIndicator color={c.tint} style={styles.loader} />
                ) : (
                  <>
                    <View style={styles.shoppingSummary}>
                      <View style={[styles.shoppingIcon, { backgroundColor: c.orangeSoft }]}>
                        <ShoppingCart color={c.orange} size={24} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[t.title1, { color: c.label }]}>
                          {shoppingDone}/{shoppingTotal}
                        </Text>
                        <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 2 }]}>已完成</Text>
                      </View>
                    </View>
                    <View style={[styles.progressTrack, { backgroundColor: c.fill }]}>
                      <View
                        style={[
                          styles.progressValue,
                          { backgroundColor: c.orange, width: `${Math.round(progress * 100)}%` },
                        ]}
                      />
                    </View>
                    <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 16 }]}>
                      {shoppingTotal
                        ? shoppingPending
                          ? `还有 ${shoppingPending} 项需要购买`
                          : '今天的采购已经完成'
                        : '今天还没有购物项目'}
                    </Text>
                  </>
                )}
              </Card>
            </View>
          </View>
        </PageContainer>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingTop: 18, paddingBottom: 40 },
  contentDesktop: { paddingTop: 32 },
  hero: { gap: 18 },
  heroDesktop: { flexDirection: 'row', alignItems: 'center' },
  orderButton: {
    height: 44,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  metrics: { flexDirection: 'row', gap: 12, marginTop: 24 },
  metricCard: { flex: 1, minWidth: 0, minHeight: 116, padding: 14 },
  metricLink: { flex: 1, minWidth: 0 },
  metricIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricValue: { fontSize: 25, fontWeight: '700', marginTop: 12 },
  mainGrid: { gap: 24, marginTop: 32 },
  mainGridDesktop: { flexDirection: 'row', alignItems: 'stretch' },
  menuColumn: { flex: 1.65, minWidth: 0 },
  shoppingColumn: { flex: 1, minWidth: 0 },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  textLink: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  menuCard: { minHeight: 230, padding: 18 },
  meals: { gap: 14 },
  mealsDesktop: { flexDirection: 'row', gap: 18 },
  mealSection: { flex: 1, minWidth: 0 },
  mealHeading: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  mealItem: { height: 38, flexDirection: 'row', alignItems: 'center', gap: 8 },
  mealEmoji: { fontSize: 20 },
  emptyMeal: {
    minHeight: 96,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  mealDivider: { height: 1 },
  mealDividerDesktop: { width: 1 },
  shoppingCard: { minHeight: 230, padding: 20 },
  shoppingSummary: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  shoppingIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: { height: 7, borderRadius: 4, overflow: 'hidden', marginTop: 28 },
  progressValue: { height: '100%', borderRadius: 4 },
  loader: { marginVertical: 72 },
});
