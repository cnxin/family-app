import { useRouter } from 'expo-router';
import React from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageContainer, useDesktopLayout } from '../../components/app-shell';
import {
  Card,
  PressableScale,
  SectionHeader,
} from '../../components/ui';
import { useDishes, useRemoveDish } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { CATEGORY_EMOJI, radius, type as t, useTheme } from '../../lib/theme';

export default function ProfileScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const { member, logout } = useSession();
  const { data: dishes } = useDishes();
  const removeDish = useRemoveDish();

  const confirmRemove = (id: string, name: string) => {
    Alert.alert('下架菜品', `「${name}」将不再出现在点菜列表里`, [
      { text: '取消', style: 'cancel' },
      {
        text: '下架',
        style: 'destructive',
        onPress: () => removeDish.mutate(id),
      },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <PageContainer
        maxWidth={1040}
        style={[styles.page, desktop && styles.pageDesktop]}
      >
        <View style={styles.header}>
          <Text style={[t.largeTitle, { color: c.label }]}>我的</Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
        <Card style={styles.profileCard}>
          <Text style={{ fontSize: 52 }}>{member?.avatarEmoji}</Text>
          <View style={{ marginLeft: 14 }}>
            <Text style={[t.title2, { color: c.label }]}>{member?.name}</Text>
            <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 2 }]}>
              {member?.role === 'chef' ? '掌勺的 👨‍🍳' : '点菜的 😋'}
            </Text>
          </View>
        </Card>

        <SectionHeader
          title={`菜谱管理（${dishes?.length ?? 0} 道）`}
          right={
            <PressableScale onPress={() => router.push('/dish-edit')}>
              <Text style={[t.subhead, { color: c.tint, fontWeight: '600' }]}>
                ＋ 新增菜品
              </Text>
            </PressableScale>
          }
        />
        <Card>
          {(dishes ?? []).map((dish) => (
            <View
              key={dish.id}
              style={[styles.dishRow, { borderBottomColor: c.separator }]}
            >
              <Text style={{ fontSize: 24 }}>
                {CATEGORY_EMOJI[dish.category] ?? '🍽️'}
              </Text>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[t.body, { color: c.label }]}>{dish.name}</Text>
                <Text style={[t.footnote, { color: c.secondaryLabel }]}>
                  {dish.category} · {dish.ingredients?.length ?? 0} 种食材 · {dish.recipeSteps?.length ?? 0} 步做法
                </Text>
              </View>
              <PressableScale
                onPress={() => router.push(`/dish-edit?id=${dish.id}`)}
                style={styles.rowBtn}
              >
                <Text style={[t.subhead, { color: c.tint }]}>编辑</Text>
              </PressableScale>
              <PressableScale
                onPress={() => confirmRemove(dish.id, dish.name)}
                style={styles.rowBtn}
              >
                <Text style={[t.subhead, { color: c.red }]}>下架</Text>
              </PressableScale>
            </View>
          ))}
        </Card>

        <SectionHeader title="账号" />
        <Card>
          <PressableScale
            onPress={() =>
              Alert.alert('切换成员', '退出后回到选人页面', [
                { text: '取消', style: 'cancel' },
                { text: '退出', style: 'destructive', onPress: () => void logout() },
              ])
            }
            style={{ padding: 14 }}
          >
            <Text style={[t.body, { color: c.red, textAlign: 'center' }]}>
              退出登录 / 切换成员
            </Text>
          </PressableScale>
        </Card>

        <Text
          style={[
            t.footnote,
            { color: c.tertiaryLabel, textAlign: 'center', marginTop: 24 },
          ]}
        >
          小管家 v0.1 · 家庭点菜模块
        </Text>
        </ScrollView>
      </PageContainer>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingTop: 8 },
  pageDesktop: { paddingTop: 22 },
  header: { paddingTop: 0 },
  scrollContent: { paddingBottom: 32 },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    marginTop: 16,
  },
  dishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowBtn: { paddingHorizontal: 8, paddingVertical: 6 },
});
