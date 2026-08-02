import { type Href, useRouter } from 'expo-router';
import {
  ArrowLeft,
  BookOpenText,
  CalendarClock,
  ChevronRight,
  Film,
  Gift,
  History,
  MailPlus,
  Settings2,
  UserRoundCog,
  UtensilsCrossed,
  Wrench,
} from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageContainer, useDesktopLayout } from '../../components/app-shell';
import { Card, EmptyState, PressableScale, Segmented } from '../../components/ui';
import { useActivities } from '../../lib/queries';
import { radius, type as t, useTheme } from '../../lib/theme';
import type { ActivityModule, HouseholdActivity } from '../../lib/types';

type ActivityScope = 'all' | 'members' | 'menus';

export default function ActivityScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const [scope, setScope] = useState<ActivityScope>('all');
  const { data: activities, isLoading, error } = useActivities(scope);
  const groups = useMemo(() => groupActivities(activities ?? []), [activities]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <PageContainer
        maxWidth={1040}
        style={[styles.page, desktop && styles.pageDesktop]}
      >
        <View style={styles.header}>
          {!desktop ? (
            <PressableScale
              accessibilityLabel="返回"
              haptic={false}
              onPress={() => router.replace('/profile')}
              style={styles.backButton}
            >
              <ArrowLeft color={c.label} size={21} />
            </PressableScale>
          ) : null}
          <View style={{ flex: 1 }}>
            <Text style={[desktop ? t.largeTitle : t.title1, { color: c.label }]}>家庭活动</Text>
            <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 3 }]}>家庭协作与管理动态</Text>
          </View>
          <View style={[styles.headerIcon, { backgroundColor: c.blueSoft }]}>
            <History color={c.blue} size={21} />
          </View>
        </View>

        <View style={styles.filterRow}>
          <Segmented<ActivityScope>
            options={[
              { label: '全部', value: 'all' },
              { label: '成员', value: 'members' },
              { label: '菜单', value: 'menus' },
            ]}
            value={scope}
            onChange={setScope}
          />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {isLoading ? (
            <Text style={[t.subhead, styles.loading, { color: c.secondaryLabel }]}>正在加载...</Text>
          ) : error ? (
            <EmptyState emoji="!" title="活动加载失败" hint={error.message} />
          ) : groups.length === 0 ? (
            <EmptyState emoji="🕘" title="暂无活动" />
          ) : (
            groups.map((group) => (
              <View key={group.key} style={styles.group}>
                <Text style={[t.footnote, styles.groupTitle, { color: c.secondaryLabel }]}>
                  {group.title}
                </Text>
                <Card>
                  {group.items.map((activity, index) => (
                    <ActivityRow
                      activity={activity}
                      key={activity.id}
                      last={index === group.items.length - 1}
                      onOpen={() => {
                        if (activity.targetPath) {
                          router.push(activity.targetPath as Href);
                        }
                      }}
                    />
                  ))}
                </Card>
              </View>
            ))
          )}
        </ScrollView>
      </PageContainer>
    </SafeAreaView>
  );
}

function ActivityRow({
  activity,
  last,
  onOpen,
}: {
  activity: HouseholdActivity;
  last: boolean;
  onOpen: () => void;
}) {
  const c = useTheme();
  const visual = activityVisual(activity.module, c);
  const Icon = visual.icon;
  const content = (
    <View
      style={[
        styles.activityRow,
        !last && { borderBottomColor: c.separator, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <View style={[styles.activityIcon, { backgroundColor: visual.backgroundColor }]}>
        <Icon color={visual.color} size={18} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[t.subhead, { color: c.label, fontWeight: '600' }]}>
          {activity.summary}
        </Text>
        {activity.detail ? (
          <Text numberOfLines={2} style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>
            {activity.detail}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          <Text style={{ fontSize: 15 }}>{activity.actor.avatarEmoji}</Text>
          <Text style={[t.caption, { color: c.tertiaryLabel }]}>
            {activity.actor.name} · {formatTime(activity.occurredAt)}
          </Text>
        </View>
      </View>
      {activity.targetPath ? <ChevronRight color={c.tertiaryLabel} size={18} /> : null}
    </View>
  );

  return activity.targetPath ? (
    <PressableScale
      accessibilityLabel={`打开活动：${activity.summary}`}
      haptic={false}
      onPress={onOpen}
    >
      {content}
    </PressableScale>
  ) : (
    content
  );
}

function activityVisual(module: ActivityModule, c: ReturnType<typeof useTheme>) {
  if (module === 'menu') {
    return { icon: UtensilsCrossed, color: c.orange, backgroundColor: c.orangeSoft };
  }
  if (module === 'member') {
    return { icon: UserRoundCog, color: c.tint, backgroundColor: c.tintSoft };
  }
  if (module === 'invitation') {
    return { icon: MailPlus, color: c.blue, backgroundColor: c.blueSoft };
  }
  if (module === 'media') {
    return { icon: Film, color: c.accent, backgroundColor: c.accentSoft };
  }
  if (module === 'asset') {
    return { icon: Wrench, color: c.green, backgroundColor: c.greenSoft };
  }
  if (module === 'points') {
    return { icon: Gift, color: c.orange, backgroundColor: c.orangeSoft };
  }
  if (module === 'knowledge') {
    return { icon: BookOpenText, color: c.tint, backgroundColor: c.tintSoft };
  }
  if (module === 'system') {
    return { icon: Settings2, color: c.secondaryLabel, backgroundColor: c.fill };
  }
  return { icon: CalendarClock, color: c.blue, backgroundColor: c.blueSoft };
}

function groupActivities(activities: HouseholdActivity[]) {
  const groups = new Map<string, HouseholdActivity[]>();
  for (const activity of activities) {
    const date = new Date(activity.occurredAt);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const current = groups.get(key) ?? [];
    current.push(activity);
    groups.set(key, current);
  }
  return [...groups.entries()].map(([key, items]) => ({
    key,
    title: formatDay(items[0].occurredAt),
    items,
  }));
}

function formatDay(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
  if (sameDay(date, today)) return '今天';
  if (sameDay(date, yesterday)) return '昨天';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingTop: 8 },
  pageDesktop: { paddingTop: 22 },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10 },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterRow: { width: '100%', maxWidth: 420, marginTop: 14 },
  scrollContent: { paddingTop: 14, paddingBottom: 32 },
  loading: { textAlign: 'center', paddingTop: 48 },
  group: { marginBottom: 18 },
  groupTitle: { marginBottom: 8, paddingHorizontal: 4 },
  activityRow: {
    minHeight: 82,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  activityIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
});
