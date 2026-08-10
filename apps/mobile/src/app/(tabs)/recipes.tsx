import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import {
  ChevronRight,
  Plus,
  Search,
} from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ModuleBackButton,
  PageContainer,
  useDesktopLayout,
} from '../../components/app-shell';
import { Card, EmptyState, Segmented } from '../../components/ui';
import { photoUri } from '../../lib/api';
import { useMembers, useRecipes } from '../../lib/queries';
import { CATEGORY_EMOJI, radius, type as t, useTheme } from '../../lib/theme';
import type { Member, RecipeDish } from '../../lib/types';

type RecipeView = 'dish' | 'member';

function DishCard({ dish, desktop }: { dish: RecipeDish; desktop: boolean }) {
  const c = useTheme();
  const router = useRouter();
  const cooks = dish.skills.map((skill) => skill.member);

  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(`/dish/${dish.id}`)}
      testID={`recipe-dish-${dish.id}`}
      style={({ pressed }) => [
        styles.cardPressable,
        { opacity: pressed ? 0.7 : 1 },
        desktop && styles.cardPressableDesktop,
      ]}
    >
      <Card style={styles.dishCard}>
        {dish.photoUrl ? (
          <Image
            contentFit="cover"
            source={{ uri: photoUri(dish.photoUrl)! }}
            style={styles.photo}
            transition={180}
          />
        ) : (
          <View style={[styles.photo, styles.placeholder, { backgroundColor: c.fill }]}>
            <Text style={styles.emoji}>
              {CATEGORY_EMOJI[dish.category] ?? '🍽️'}
            </Text>
          </View>
        )}
        <View style={styles.cardBody}>
          <View style={styles.titleRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.headline, { color: c.label }]} numberOfLines={1}>
                {dish.name}
              </Text>
              <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>
                {dish.category} · {dish.recipeVariants.length} 种做法
              </Text>
            </View>
            <ChevronRight color={c.tertiaryLabel} size={18} />
          </View>
          <View style={styles.cooksRow}>
            {cooks.length ? (
              <>
                <View style={styles.avatarStack}>
                  {cooks.slice(0, 4).map((cook, index) => (
                    <View
                      key={cook.id}
                      style={[
                        styles.avatar,
                        {
                          backgroundColor: c.orangeSoft,
                          borderColor: c.card,
                          marginLeft: index ? -7 : 0,
                        },
                      ]}
                    >
                      <Text style={styles.avatarEmoji}>{cook.avatarEmoji}</Text>
                    </View>
                  ))}
                </View>
                <Text
                  numberOfLines={1}
                  style={[t.caption, { color: c.secondaryLabel, flex: 1 }]}
                >
                  {cooks.map((cook) => cook.name).join('、')}会做
                </Text>
              </>
            ) : (
              <Text style={[t.caption, { color: c.tertiaryLabel }]}>还没人标记会做</Text>
            )}
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

function MemberSection({
  member,
  dishes,
  desktop,
}: {
  member: Member;
  dishes: RecipeDish[];
  desktop: boolean;
}) {
  const c = useTheme();
  return (
    <View style={styles.memberSection}>
      <View style={styles.memberHeader}>
        <View style={[styles.memberAvatar, { backgroundColor: c.orangeSoft }]}>
          <Text style={{ fontSize: 22 }}>{member.avatarEmoji}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[t.headline, { color: c.label }]}>{member.name}</Text>
          <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>
            会做 {dishes.length} 道菜
          </Text>
        </View>
      </View>
      {dishes.length ? (
        <View style={styles.grid}>
          {dishes.map((dish) => (
            <DishCard key={dish.id} dish={dish} desktop={desktop} />
          ))}
        </View>
      ) : (
        <View style={[styles.memberEmpty, { borderColor: c.separator }]}>
          <Text style={[t.subhead, { color: c.tertiaryLabel }]}>还没有添加会做的菜</Text>
        </View>
      )}
    </View>
  );
}

export default function RecipesScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const { data: dishes, isLoading, error } = useRecipes();
  const { data: members } = useMembers();
  const [view, setView] = useState<RecipeView>('dish');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('zh-CN');
    if (!keyword) return dishes ?? [];
    return (dishes ?? []).filter((dish) =>
      [
        dish.name,
        dish.category,
        ...dish.recipeVariants.map((variant) => variant.name),
        ...dish.skills.map((skill) => skill.member.name),
      ].some((value) => value.toLocaleLowerCase('zh-CN').includes(keyword)),
    );
  }, [dishes, search]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <PageContainer style={[styles.page, desktop && styles.pageDesktop]}>
        <ModuleBackButton href="/canteen" label="家庭食堂" />
        <View style={[styles.header, !desktop && styles.headerMobile, desktop && styles.headerDesktop]}>
          <View style={{ flex: 1 }}>
            <Text style={[t.largeTitle, { color: c.label }]}>家庭菜谱</Text>
            <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 4 }]}>
              {dishes?.length ?? 0} 道菜 · {dishes?.reduce((sum, dish) => sum + dish.recipeVariants.length, 0) ?? 0} 种做法
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/dish-edit')}
            style={({ pressed }) => [
              styles.addButton,
              { backgroundColor: pressed ? c.cardPressed : c.tint },
            ]}
          >
            <Plus color="#FFFFFF" size={18} />
            <Text style={[t.subhead, { color: '#FFFFFF', fontWeight: '700' }]}>新增菜品</Text>
          </Pressable>
        </View>

        <View style={[styles.toolbar, desktop && styles.toolbarDesktop]}>
          <View
            style={[
              styles.search,
              { backgroundColor: c.card, borderColor: c.separator },
            ]}
          >
            <Search color={c.secondaryLabel} size={18} />
            <TextInput
              onChangeText={setSearch}
              placeholder="搜索菜名、做法或成员"
              placeholderTextColor={c.tertiaryLabel}
              style={[styles.searchInput, { color: c.label }]}
              value={search}
            />
          </View>
          <View style={styles.segmentedWrap}>
            <Segmented<RecipeView>
              onChange={setView}
              options={[
                { label: '按菜品', value: 'dish' },
                { label: '按成员', value: 'member' },
              ]}
              value={view}
            />
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {isLoading ? <ActivityIndicator color={c.tint} style={styles.loading} /> : null}
          {error ? (
            <EmptyState emoji="📖" title="菜谱加载失败" hint="请检查 API 服务" />
          ) : null}
          {!isLoading && !error && view === 'dish' ? (
            filtered.length ? (
              <View style={styles.grid}>
                {filtered.map((dish) => (
                  <DishCard key={dish.id} dish={dish} desktop={desktop} />
                ))}
              </View>
            ) : (
              <EmptyState emoji="🔎" title="没有匹配的菜" hint="换个关键词试试" />
            )
          ) : null}
          {!isLoading && !error && view === 'member' ? (
            <View style={styles.memberList}>
              {(members ?? []).map((member) => (
                <MemberSection
                  desktop={desktop}
                  dishes={filtered.filter((dish) =>
                    dish.skills.some((skill) => skill.memberId === member.id),
                  )}
                  key={member.id}
                  member={member}
                />
              ))}
              {!members?.length ? (
                <EmptyState
                  emoji="👥"
                  title="还没有家庭成员"
                  hint="成员加入后会显示各自会做的菜"
                />
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </PageContainer>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { flex: 1, paddingTop: 8 },
  pageDesktop: { paddingTop: 22 },
  header: { gap: 14 },
  headerMobile: { marginTop: 12 },
  headerDesktop: { flexDirection: 'row', alignItems: 'center' },
  addButton: {
    minHeight: 42,
    borderRadius: radius.md,
    paddingHorizontal: 15,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  toolbar: { gap: 10, marginTop: 18 },
  toolbarDesktop: { flexDirection: 'row', alignItems: 'center' },
  search: {
    height: 44,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  searchInput: { flex: 1, minWidth: 0, fontSize: 16, paddingVertical: 0 },
  segmentedWrap: { width: 220, maxWidth: '100%' },
  scrollContent: { paddingTop: 18, paddingBottom: 32 },
  loading: { marginTop: 72 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cardPressable: { width: '100%' },
  cardPressableDesktop: { width: '32.5%' },
  dishCard: { flex: 1, overflow: 'hidden' },
  photo: { width: '100%', aspectRatio: 16 / 8.5 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 48 },
  cardBody: { padding: 13 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cooksRow: { minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  avatarStack: { flexDirection: 'row', paddingLeft: 1 },
  avatar: {
    width: 27,
    height: 27,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: { fontSize: 14 },
  memberList: { gap: 30 },
  memberSection: { gap: 12 },
  memberHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberEmpty: {
    minHeight: 74,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
