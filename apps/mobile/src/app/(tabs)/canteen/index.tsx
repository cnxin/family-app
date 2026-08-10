import {
  ArrowRight,
  BookOpenText,
  CookingPot,
  ShoppingCart,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react-native';
import { useRouter, type Href } from 'expo-router';
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
import { Card, PressableScale } from '../../../components/ui';
import { mealLabel, todayStr } from '../../../lib/date';
import {
  useDishes,
  useMenusOfDate,
  useShoppingList,
} from '../../../lib/queries';
import { useSession } from '../../../lib/session';
import { CATEGORY_EMOJI, radius, type as t, useTheme } from '../../../lib/theme';
import type { MealType, Menu } from '../../../lib/types';

function ActionCard({
  href,
  icon: Icon,
  label,
  status,
  color,
  background,
}: {
  href: Href;
  icon: LucideIcon;
  label: string;
  status: string;
  color: string;
  background: string;
}) {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const { member } = useSession();
  const consumer = member?.role === 'member';
  const adminDesktop = desktop && !consumer;
  const router = useRouter();
  return (
    <PressableScale
      accessibilityLabel={`${label}，${status}`}
      accessibilityRole="link"
      haptic
      onPress={() => router.push(href)}
      style={styles.actionCell}
    >
      <Card style={[styles.actionCard, adminDesktop && styles.actionCardDesktop]}>
        <View style={[styles.actionIcon, { backgroundColor: background }]}>
          <Icon color={color} size={22} />
        </View>
        <View style={styles.actionText}>
          <Text style={[t.headline, { color: c.label }]}>{label}</Text>
          <Text numberOfLines={1} style={[t.caption, { color: c.secondaryLabel, marginTop: 4 }]}>
            {status}
          </Text>
        </View>
        {adminDesktop ? (
          <ArrowRight color={c.tertiaryLabel} size={17} />
        ) : (
          <View style={styles.actionArrow}>
            <ArrowRight color={c.tertiaryLabel} size={17} />
          </View>
        )}
      </Card>
    </PressableScale>
  );
}

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
              .map((item) => `${CATEGORY_EMOJI[item.dish.category] ?? '🍽️'} ${item.dish.name}`)
              .join('  ')}
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
              consumer && { backgroundColor: c.orangeSoft },
              consumer && styles.headerConsumer,
            ]}
            testID={consumer ? 'consumer-canteen-header' : undefined}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.footnote, { color: c.orange, fontWeight: '700' }]}>今天吃什么</Text>
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

          <View style={[styles.actionGrid, adminDesktop && styles.actionGridDesktop]}>
            <ActionCard
              background={c.tintSoft}
              color={c.tint}
              href="/order"
              icon={UtensilsCrossed}
              label="点菜"
              status={`${menuItems} 道已安排`}
            />
            <ActionCard
              background={c.accentSoft}
              color={c.accent}
              href="/recipes"
              icon={BookOpenText}
              label="家庭菜谱"
              status={`${dishes?.length ?? 0} 道菜`}
            />
            <ActionCard
              background={c.blueSoft}
              color={c.blue}
              href="/kitchen"
              icon={CookingPot}
              label="菜单安排"
              status="查看制作进度"
            />
            <ActionCard
              background={c.orangeSoft}
              color={c.orange}
              href="/shopping"
              icon={ShoppingCart}
              label="食材采购"
              status={`${shoppingPending} 项待购买`}
            />
          </View>

          <View style={styles.sectionHeader}>
            <View>
              <Text style={[t.title2, { color: c.label }]}>今日菜单</Text>
              <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>早餐、午餐和晚餐</Text>
            </View>
            <Pressable accessibilityRole="link" onPress={() => router.push('/kitchen')} style={styles.textLink}>
              <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>菜单安排</Text>
              <ArrowRight color={c.tint} size={15} />
            </Pressable>
          </View>
          <Card style={styles.mealCard}>
            {isLoading ? (
              <ActivityIndicator color={c.tint} style={styles.loader} />
            ) : (
              <>
                <MealRow mealType="breakfast" menu={menus?.find((menu) => menu.mealType === 'breakfast')} />
                <MealRow mealType="lunch" menu={menus?.find((menu) => menu.mealType === 'lunch')} />
                <MealRow mealType="dinner" menu={menus?.find((menu) => menu.mealType === 'dinner')} />
              </>
            )}
          </Card>
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
  headerConsumer: {
    borderRadius: radius.md,
    marginTop: 0,
    padding: 20,
  },
  primaryAction: {
    height: 44,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 24 },
  actionGridDesktop: { marginTop: 30 },
  actionCell: { width: '48%', minWidth: 0, flexGrow: 1 },
  actionCard: {
    minHeight: 132,
    padding: 14,
    alignItems: 'flex-start',
    gap: 10,
  },
  actionCardDesktop: {
    minHeight: 106,
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { flex: 1, minWidth: 0 },
  actionArrow: { position: 'absolute', top: 25, right: 13 },
  sectionHeader: {
    marginTop: 32,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  textLink: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 4 },
  mealCard: { overflow: 'hidden' },
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
