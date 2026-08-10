import { useRouter } from 'expo-router';
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Sparkles,
  Vote,
} from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { todayStr } from '../lib/date';
import {
  useAdoptSmartMenuPlan,
  useCreateSmartMenuPlan,
  useCreateSmartMenuPoll,
  useSmartMenuPlans,
} from '../lib/queries';
import type { SmartMenuPlan } from '../lib/types';
import { radius, type as t, useTheme } from '../lib/theme';
import {
  Card,
  ConfirmDialog,
  EmptyState,
  PressableScale,
  PrimaryButton,
  SectionHeader,
} from './ui';

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function nextMonday() {
  const current = todayStr();
  const day = new Date(`${current}T00:00:00.000Z`).getUTCDay();
  return addDays(current, day === 1 ? 7 : (8 - day) % 7);
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(`${value}T12:00:00`));
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function PlanStatus({ plan }: { plan: SmartMenuPlan }) {
  const c = useTheme();
  const label =
    plan.status === 'draft'
      ? '候选待确认'
      : plan.status === 'voting'
        ? plan.pollStatus === 'closed'
          ? '投票已结束'
          : '家庭投票中'
        : '已加入菜单';
  const color =
    plan.status === 'adopted'
      ? c.green
      : plan.pollStatus === 'closed'
        ? c.orange
        : c.tint;
  const background =
    plan.status === 'adopted'
      ? c.greenSoft
      : plan.pollStatus === 'closed'
        ? c.orangeSoft
        : c.tintSoft;
  return (
    <View style={[styles.status, { backgroundColor: background }]}>
      <Text style={[t.caption, { color, fontWeight: '700' }]}>{label}</Text>
    </View>
  );
}

export function SmartMenuPanel() {
  const c = useTheme();
  const router = useRouter();
  const { data: plans, isLoading, error } = useSmartMenuPlans();
  const create = useCreateSmartMenuPlan();
  const createPoll = useCreateSmartMenuPoll();
  const adopt = useAdoptSmartMenuPlan();
  const [startsOn, setStartsOn] = useState(nextMonday());
  const [pendingAdopt, setPendingAdopt] = useState<SmartMenuPlan | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const latest = plans?.[0] ?? null;
  const dateValid = validDate(startsOn) && startsOn >= todayStr();
  const selectedCount = useMemo(
    () => pendingAdopt?.candidates.filter((candidate) => candidate.voteCount > 0).length ?? 0,
    [pendingAdopt],
  );

  const generate = async () => {
    if (!dateValid) return;
    setMessage(null);
    try {
      await create.mutateAsync(startsOn);
      setMessage('已生成一周晚餐候选，确认前不会修改菜单');
    } catch (createError) {
      setMessage(createError instanceof Error ? createError.message : '生成菜单候选失败');
    }
  };

  const startPoll = async (plan: SmartMenuPlan) => {
    setMessage(null);
    try {
      const updated = await createPoll.mutateAsync({ id: plan.id });
      setMessage('家庭投票已创建，可以邀请家人选择想吃的菜');
      if (updated.pollId) {
        router.push({ pathname: '/polls', params: { pollId: updated.pollId } });
      }
    } catch (pollError) {
      setMessage(pollError instanceof Error ? pollError.message : '发起投票失败');
    }
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        testID="smart-menu-panel"
      >
        <View style={[styles.intro, { backgroundColor: c.tintSoft }]}>
          <View style={[styles.introIcon, { backgroundColor: c.card }]}>
            <Sparkles color={c.tint} size={22} />
          </View>
          <View style={styles.introCopy}>
            <Text style={[t.title2, { color: c.label }]}>一周菜单候选</Text>
            <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 4, lineHeight: 19 }]}>
              根据临期批次、现有库存、最近菜单和家人做菜能力排序
            </Text>
          </View>
        </View>

        <SectionHeader title="生成新提案" />
        <View style={styles.generateRow}>
          <View style={[styles.dateInputWrap, { backgroundColor: c.fill }]}>
            <CalendarDays color={c.secondaryLabel} size={18} />
            <TextInput
              accessibilityLabel="菜单提案开始日期"
              autoCapitalize="none"
              maxLength={10}
              onChangeText={setStartsOn}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={c.tertiaryLabel}
              style={[styles.dateInput, t.subhead, { color: c.label }]}
              value={startsOn}
            />
          </View>
          <PrimaryButton
            disabled={!dateValid}
            loading={create.isPending}
            onPress={() => void generate()}
            style={styles.generateButton}
            title="生成候选"
          />
        </View>
        {!dateValid ? (
          <Text style={[t.footnote, { color: c.red, marginTop: 7 }]}>
            请选择今天之后的有效日期
          </Text>
        ) : null}

        {message ? (
          <View style={[styles.message, { backgroundColor: c.fill }]}>
            <Text style={[t.footnote, { color: c.label }]}>{message}</Text>
          </View>
        ) : null}

        {isLoading ? <ActivityIndicator color={c.tint} style={{ marginTop: 48 }} /> : null}
        {error instanceof Error ? (
          <View style={[styles.message, { backgroundColor: c.redSoft }]}>
            <Text style={[t.footnote, { color: c.red }]}>{error.message}</Text>
          </View>
        ) : null}
        {!isLoading && !latest ? (
          <EmptyState
            emoji="🍽️"
            hint="生成后先查看推荐理由，再决定是否发起家庭投票"
            title="还没有菜单候选"
          />
        ) : null}

        {latest ? (
          <View testID="smart-menu-latest-plan">
            <View style={styles.planHeading}>
              <View style={styles.planHeadingCopy}>
                <Text style={[t.title2, { color: c.label }]}>最新提案</Text>
                <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>
                  {dateLabel(latest.startsOn)} 至 {dateLabel(latest.endsOn)}
                </Text>
              </View>
              <PlanStatus plan={latest} />
            </View>

            <View style={styles.candidates}>
              {latest.candidates.map((candidate, index) => (
                <Card key={candidate.id} style={styles.candidateCard}>
                  <View style={styles.candidateTop}>
                    <View style={[styles.rank, { backgroundColor: c.fill }]}>
                      <Text style={[t.caption, { color: c.secondaryLabel, fontWeight: '700' }]}>
                        {index + 1}
                      </Text>
                    </View>
                    <View style={styles.candidateCopy}>
                      <Text style={[t.headline, { color: c.label }]}>{candidate.dish.name}</Text>
                      <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>
                        建议 {dateLabel(candidate.targetDate)} · {candidate.recipeVariant.name}
                      </Text>
                    </View>
                    {latest.status === 'voting' ? (
                      <View style={[styles.voteCount, { backgroundColor: c.tintSoft }]}>
                        <Vote color={c.tint} size={14} />
                        <Text style={[t.caption, { color: c.tint, fontWeight: '700' }]}>
                          {candidate.voteCount}
                        </Text>
                      </View>
                    ) : null}
                    {candidate.adoptedMenuId ? <CheckCircle2 color={c.green} size={20} /> : null}
                  </View>
                  <View style={styles.reasonList}>
                    {candidate.reasons.slice(0, 3).map((reason) => (
                      <View key={reason} style={styles.reasonRow}>
                        <View style={[styles.reasonDot, { backgroundColor: c.tint }]} />
                        <Text style={[t.footnote, styles.reasonText, { color: c.secondaryLabel }]}>
                          {reason}
                        </Text>
                      </View>
                    ))}
                  </View>
                  {candidate.expiringIngredients.length ? (
                    <View style={styles.expiryTags}>
                      {candidate.expiringIngredients.slice(0, 3).map((ingredient) => (
                        <View
                          key={`${candidate.id}-${ingredient.ingredientId}`}
                          style={[styles.expiryTag, { backgroundColor: c.orangeSoft }]}
                        >
                          <Clock3 color={c.orange} size={13} />
                          <Text style={[t.caption, { color: c.orange, fontWeight: '700' }]}>
                            {ingredient.name} {ingredient.daysRemaining} 天
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </Card>
              ))}
            </View>

            {latest.canCreatePoll ? (
              <PrimaryButton
                icon={<Vote color="#FFFFFF" size={18} />}
                loading={createPoll.isPending}
                onPress={() => void startPoll(latest)}
                style={styles.planAction}
                title="发起家庭投票"
              />
            ) : latest.status === 'voting' ? (
              <View style={styles.votingActions}>
                <PressableScale
                  accessibilityLabel="查看菜单家庭投票"
                  haptic={false}
                  onPress={() =>
                    router.push({ pathname: '/polls', params: { pollId: latest.pollId ?? undefined } })
                  }
                  style={[styles.secondaryAction, { backgroundColor: c.fill }]}
                >
                  <Vote color={c.tint} size={18} />
                  <Text style={[t.headline, { color: c.tint }]}>查看投票</Text>
                  <ChevronRight color={c.tint} size={17} />
                </PressableScale>
                {latest.canAdopt ? (
                  <PrimaryButton
                    onPress={() => setPendingAdopt(latest)}
                    style={styles.adoptButton}
                    title="采纳投票结果"
                  />
                ) : null}
              </View>
            ) : latest.status === 'adopted' ? (
              <PressableScale
                accessibilityLabel="查看已采纳的一周菜单"
                haptic={false}
                onPress={() =>
                  router.push({ pathname: '/kitchen', params: { date: latest.startsOn } })
                }
                style={[styles.secondaryAction, styles.planAction, { backgroundColor: c.greenSoft }]}
              >
                <CheckCircle2 color={c.green} size={18} />
                <Text style={[t.headline, { color: c.green }]}>查看已采纳菜单</Text>
                <ChevronRight color={c.green} size={17} />
              </PressableScale>
            ) : null}

            {latest.status === 'voting' && latest.pollStatus === 'closed' && !latest.canAdopt ? (
              <View style={[styles.message, { backgroundColor: c.orangeSoft }]}>
                <Text style={[t.footnote, { color: c.orange }]}>投票没有有效选择，暂时不能写入菜单</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <ConfirmDialog
        confirmLabel="确认采纳"
        loading={adopt.isPending}
        message={`将把获得选择的 ${selectedCount} 道菜按票数安排到 ${pendingAdopt?.startsOn ?? ''} 起的晚餐。已有同名菜品不会重复添加。`}
        onCancel={() => setPendingAdopt(null)}
        onConfirm={() => {
          if (!pendingAdopt) return;
          adopt.mutate(pendingAdopt.id, {
            onSuccess: (plan) => {
              setPendingAdopt(null);
              setMessage(`已把 ${plan.adoptedCount} 道菜加入一周菜单`);
            },
            onError: (adoptError) => {
              setPendingAdopt(null);
              setMessage(adoptError instanceof Error ? adoptError.message : '采纳菜单失败');
            },
          });
        }}
        title="采纳家庭投票结果？"
        visible={Boolean(pendingAdopt)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 36 },
  intro: {
    alignItems: 'center',
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: 13,
    marginTop: 16,
    padding: 15,
  },
  introIcon: {
    alignItems: 'center',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  introCopy: { flex: 1, minWidth: 0 },
  generateRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  dateInputWrap: {
    alignItems: 'center',
    borderRadius: radius.sm,
    flex: 1,
    flexDirection: 'row',
    minHeight: 48,
    paddingLeft: 12,
  },
  dateInput: { flex: 1, minWidth: 0, paddingHorizontal: 9, paddingVertical: 10 },
  generateButton: { minWidth: 120 },
  message: { borderRadius: radius.sm, marginTop: 12, padding: 12 },
  planHeading: { alignItems: 'center', flexDirection: 'row', marginTop: 22 },
  planHeadingCopy: { flex: 1, minWidth: 0 },
  status: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 6 },
  candidates: { gap: 10, marginTop: 12 },
  candidateCard: { padding: 13 },
  candidateTop: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  rank: {
    alignItems: 'center',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  candidateCopy: { flex: 1, minWidth: 0 },
  voteCount: {
    alignItems: 'center',
    borderRadius: radius.full,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  reasonList: { gap: 5, marginTop: 11 },
  reasonRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 8 },
  reasonDot: { borderRadius: 3, height: 6, marginTop: 6, width: 6 },
  reasonText: { flex: 1, lineHeight: 18 },
  expiryTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 11 },
  expiryTag: {
    alignItems: 'center',
    borderRadius: radius.full,
    flexDirection: 'row',
    gap: 5,
    minHeight: 32,
    paddingHorizontal: 9,
  },
  planAction: { marginTop: 14 },
  votingActions: { gap: 9, marginTop: 14 },
  secondaryAction: {
    alignItems: 'center',
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 14,
  },
  adoptButton: { width: '100%' },
});
