import {
  ArrowRight,
  BookOpenText,
  CookingPot,
  ShoppingCart,
  UtensilsCrossed,
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
import {
  ModuleBackButton,
  PageContainer,
  useDesktopLayout,
} from '../../../components/app-shell';
import {
  GroupedList,
  GroupedNavigationRow,
  PressableScale,
} from '../../../components/ui';
import { mealLabel, todayStr } from '../../../lib/date';
import {
  useDishes,
  useMenusOfDate,
  useShoppingList,
} from '../../../lib/queries';
import { useSession } from '../../../lib/session';
import { radius, type as t, useTheme } from '../../../lib/theme';
import type { MealType, Menu } from '../../../lib/types';

function MealRow({ mealType, menu }: { mealType: MealType; menu?: Menu }) {
  const c = useTheme();
  const items = menu?.items.filter((item) => item.status !== 'rejected') ?? [];
  return (
    <View style={[styles.mealRow, { borderBottomColor: c.separator }]}>
      <View style={[styles.mealLabel, { backgroundColor: c.fill }]}>
        <Text style={[t.footnote, { color: c.secondaryLabel, fontWeight: '700' }]}>
          {mealLabel(mealType)}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {items.length ? (
          <Text numberOfLines={2} style={[t.subhead, { color: c.label, fontWeight: '600' }]}>
            {items
              .slice(0, 4)
              .map((item) => item.dish.name)
              .join(' · ')}
          </Text>
        ) : (
          <Text style={[t.subhead, { color: c.tertiaryLabel }]}>暂未安排</Text>
        )}
      </View>
      <Text style={[t.caption, { color: c.secondaryLabel }]}>{items.length} 道</Text>
    </View>
  );
}

export default function CanteenHomeScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const { member } = useSession();
  const consumer = member?.role === 'member';
  const adminDesktop = desktop && !consumer;
  const today = todayStr();
  const { data: menus, isLoading } = useMenusOfDate(today);
  const { data: dishes } = useDishes();
  const { data: shopping } = useShoppingList(today);
  const menuItems =
    menus?.reduce(
      (sum, menu) => sum + menu.items.filter((item) => item.status !== 'rejected').length,
      0,
    ) ?? 0;
  const shoppingPending = shopping?.filter((item) => !item.checked).length ?? 0;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <PageContainer
          maxWidth={consumer ? 720 : 1120}
          style={[
            styles.page,
            adminDesktop && styles.pageDesktop,
            consumer && styles.pageConsumer,
          ]}
        >
          {!consumer ? <ModuleBackButton href="/" label="家庭首页" /> : null}
          <View
            style={[
              styles.header,
              adminDesktop && styles.headerDesktop,
            ]}
            testID={consumer ? 'consumer-canteen-header' : undefined}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.footnote, { color: c.secondaryLabel, fontWeight: '600' }]}>今天吃什么</Text>
              <Text
                accessibilityRole="header"
                style={[
                  adminDesktop ? t.largeTitle : t.title1,
                  { color: c.label, marginTop: 5 },
                ]}
              >
                家庭食堂
              </Text>
              <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 5 }]}>
                今日已安排 {menuItems} 道菜
              </Text>
            </View>
            <PressableScale
              accessibilityLabel="开始点菜"
              accessibilityRole="link"
              haptic
              onPress={() => router.push('/order')}
              style={[styles.primaryAction, { backgroundColor: c.tint }]}
            >
              <UtensilsCrossed color="#FFFFFF" size={18} />
              <Text style={[t.subhead, { color: '#FFFFFF', fontWeight: '700' }]}>开始点菜</Text>
            </PressableScale>
          </View>

          <View style={[styles.contentGrid, adminDesktop && styles.contentGridDesktop]}>
            <View style={styles.contentColumn}>
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={[t.title2, { color: c.label }]}>今日菜单</Text>
                  <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>早餐、午餐和晚餐</Text>
                </View>
                <Pressable accessibilityRole="link" onPress={() => router.push('/kitchen')} style={styles.textLink}>
                  <Text style={[t.footnote, { color: c.tint, fontWeight: '600' }]}>全部安排</Text>
                  <ArrowRight color={c.tint} size={15} />
                </Pressable>
              </View>
              <GroupedList>
                {isLoading ? (
                  <ActivityIndicator color={c.tint} style={styles.loader} />
                ) : (
                  <>
                    <MealRow mealType="breakfast" menu={menus?.find((menu) => menu.mealType === 'breakfast')} />
                    <MealRow mealType="lunch" menu={menus?.find((menu) => menu.mealType === 'lunch')} />
                    <MealRow mealType="dinner" menu={menus?.find((menu) => menu.mealType === 'dinner')} />
                  </>
                )}
              </GroupedList>
            </View>

            <View style={styles.contentColumn}>
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={[t.title2, { color: c.label }]}>食堂管理</Text>
                  <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>点菜、菜谱与采购</Text>
                </View>
              </View>
              <GroupedList>
                <GroupedNavigationRow
                  backgroundColor={c.tintSoft}
                  color={c.tint}
                  icon={UtensilsCrossed}
                  onPress={() => router.push('/order')}
                  subtitle={`${menuItems} 道已安排`}
                  title="点菜"
                />
                <GroupedNavigationRow
                  backgroundColor={c.accentSoft}
                  color={c.accent}
                  icon={BookOpenText}
                  onPress={() => router.push('/recipes')}
                  subtitle={`${dishes?.length ?? 0} 道家庭菜谱`}
                  title="家庭菜谱"
                />
                <GroupedNavigationRow
                  backgroundColor={c.blueSoft}
                  color={c.blue}
                  icon={CookingPot}
                  onPress={() => router.push('/kitchen')}
                  subtitle="查看制作进度"
                  title="菜单安排"
                />
                <GroupedNavigationRow
                  backgroundColor={c.orangeSoft}
                  color={c.orange}
                  icon={ShoppingCart}
                  last
                  onPress={() => router.push('/shopping')}
                  subtitle={`${shoppingPending} 项待购买`}
                  title="食材采购"
                />
              </GroupedList>
            </View>
          </View>
        </PageContainer>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { paddingTop: 10, paddingBottom: 40 },
  pageDesktop: { paddingTop: 30 },
  pageConsumer: { paddingTop: 14, paddingBottom: 56 },
  header: { gap: 16, marginTop: 18 },
  headerDesktop: { flexDirection: 'row', alignItems: 'center', marginTop: 0 },
  primaryAction: {
    height: 44,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  contentGrid: { gap: 26, marginTop: 28 },
  contentGridDesktop: { alignItems: 'flex-start', flexDirection: 'row' },
  contentColumn: { flex: 1, minWidth: 0 },
  sectionHeader: {
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  textLink: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 4 },
  mealRow: {
    minHeight: 68,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  mealLabel: {
    width: 52,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loader: { marginVertical: 34 },
});
