import { Image } from 'expo-image';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  BookOpenText,
  Check,
  ExternalLink,
  Pencil,
  Plus,
  UserRoundCheck,
  X,
} from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  PressableScale,
  PrimaryButton,
  SectionHeader,
  Segmented,
} from '../../components/ui';
import { photoUri } from '../../lib/api';
import { useCart } from '../../lib/cart';
import {
  useRecipe,
  useRemoveDishSkill,
  useUpsertDishSkill,
} from '../../lib/queries';
import { useSession } from '../../lib/session';
import { CATEGORY_EMOJI, radius, type as t, useTheme } from '../../lib/theme';
import type {
  DishRecipeVariant,
  DishSkillLevel,
} from '../../lib/types';

const SKILL_OPTIONS: { label: string; value: DishSkillLevel }[] = [
  { label: '学习中', value: 'learning' },
  { label: '会做', value: 'can_cook' },
  { label: '拿手菜', value: 'signature' },
];

function variantLabel(variant: DishRecipeVariant, memberId: string) {
  if (variant.isDefault) return '家庭默认';
  if (variant.authorMemberId === memberId) return `我的 · ${variant.name}`;
  return `${variant.author?.name ?? '家庭成员'} · ${variant.name}`;
}

export default function DishDetailSheet() {
  const c = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { member, ready } = useSession();
  const { data: dish, isLoading } = useRecipe(id, ready && Boolean(member));
  const cart = useCart();
  const upsertSkill = useUpsertDishSkill();
  const removeSkill = useRemoveDishSkill();
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [note, setNote] = useState(
    () => cart.entries.find((entry) => entry.dish.id === id)?.note ?? '',
  );

  const variants = useMemo(() => {
    if (!dish || !member) return [];
    return [...dish.recipeVariants].sort((left, right) => {
      const rank = (variant: DishRecipeVariant) =>
        variant.isDefault ? 0 : variant.authorMemberId === member.id ? 1 : 2;
      return rank(left) - rank(right);
    });
  }, [dish, member]);
  const selectedVariant =
    variants.find((variant) => variant.id === selectedVariantId) ?? variants[0];
  const currentSkill = dish?.skills.find((skill) => skill.memberId === member?.id);
  const inCart = dish ? cart.has(dish.id) : false;
  const canManageFamilyRecipe = member?.role === 'owner' || member?.role === 'admin';

  useEffect(() => {
    if (!selectedVariantId && variants[0]) setSelectedVariantId(variants[0].id);
  }, [selectedVariantId, variants]);

  if (!ready) return null;
  if (!member) return <Redirect href="/login" />;
  if (isLoading || !dish) {
    return (
      <View style={[styles.loading, { backgroundColor: c.card }]}>
        <ActivityIndicator color={c.tint} />
      </View>
    );
  }

  const saveSkill = (level: DishSkillLevel, preferredRecipeId?: string | null) => {
    upsertSkill.mutate(
      {
        dishId: dish.id,
        level,
        preferredRecipeId:
          preferredRecipeId === undefined
            ? currentSkill?.preferredRecipeId
            : preferredRecipeId,
      },
      {
        onError: (error) =>
          Alert.alert(
            '更新失败',
            error instanceof Error ? error.message : '请稍后再试',
          ),
      },
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.card }}>
      <View style={styles.headerActions}>
        {canManageFamilyRecipe ? (
          <PressableScale
            accessibilityLabel="编辑菜品"
            haptic={false}
            onPress={() => router.push(`/dish-edit?id=${dish.id}`)}
            style={[styles.circleButton, { backgroundColor: c.card }]}
          >
            <Pencil color={c.label} size={18} />
          </PressableScale>
        ) : null}
        <PressableScale
          accessibilityLabel="返回"
          haptic={false}
          onPress={() => router.back()}
          style={[styles.circleButton, { backgroundColor: c.card }]}
        >
          <X color={c.label} size={20} />
        </PressableScale>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {dish.photoUrl ? (
          <Image
            contentFit="cover"
            source={{ uri: photoUri(dish.photoUrl)! }}
            style={styles.photo}
            transition={200}
          />
        ) : (
          <View style={[styles.photo, styles.center, { backgroundColor: c.fill }]}>
            <Text style={{ fontSize: 72 }}>
              {CATEGORY_EMOJI[dish.category] ?? '🍽️'}
            </Text>
          </View>
        )}

        <View style={styles.content}>
          <Text style={[t.title2, { color: c.label }]}>{dish.name}</Text>
          <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 6 }]}>
            {dish.category} · 难度 {'🔥'.repeat(dish.difficulty)}
          </Text>
          {dish.note ? (
            <View style={[styles.flavor, { backgroundColor: c.bg }]}>
              <Text style={[t.caption, { color: c.secondaryLabel, fontWeight: '700' }]}>口味特点</Text>
              <Text style={[t.subhead, { color: c.label, marginTop: 3 }]}>{dish.note}</Text>
            </View>
          ) : null}

          <SectionHeader
            title={`做法版本（${variants.length}）`}
            right={
              <PressableScale
                onPress={() => router.push(`/recipe-edit?dishId=${dish.id}`)}
              >
                <View style={styles.inlineAction}>
                  <Plus color={c.tint} size={16} />
                  <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]}>添加我的做法</Text>
                </View>
              </PressableScale>
            }
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.variantTabs}
          >
            {variants.map((variant) => {
              const active = selectedVariant?.id === variant.id;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  key={variant.id}
                  onPress={() => setSelectedVariantId(variant.id)}
                  style={[
                    styles.variantTab,
                    {
                      backgroundColor: active ? c.tint : c.bg,
                      borderColor: active ? c.tint : c.separator,
                    },
                  ]}
                >
                  <Text style={[t.footnote, { color: active ? '#FFFFFF' : c.label, fontWeight: '700' }]}>
                    {variantLabel(variant, member.id)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {selectedVariant ? (
            <View style={[styles.variantPanel, { borderColor: c.separator }]}>
              <View style={styles.variantHeading}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[t.headline, { color: c.label }]}>{selectedVariant.name}</Text>
                  <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>
                    {selectedVariant.isDefault
                      ? '家庭共同维护'
                      : `${selectedVariant.author?.avatarEmoji ?? '👤'} ${selectedVariant.author?.name ?? '家庭成员'}`}
                    {selectedVariant.estMinutes ? ` · 约 ${selectedVariant.estMinutes} 分钟` : ''}
                  </Text>
                </View>
                {selectedVariant.canManage ? (
                  <PressableScale
                    accessibilityLabel="编辑当前做法"
                    haptic={false}
                    onPress={() =>
                      router.push(
                        `/recipe-edit?dishId=${dish.id}&variantId=${selectedVariant.id}`,
                      )
                    }
                    style={[styles.editVariantButton, { backgroundColor: c.fill }]}
                  >
                    <Pencil color={c.tint} size={16} />
                  </PressableScale>
                ) : null}
              </View>

              {selectedVariant.note ? (
                <Text style={[t.subhead, { color: c.label, marginTop: 12, lineHeight: 22 }]}>
                  {selectedVariant.note}
                </Text>
              ) : null}

              <Text style={[t.headline, { color: c.label, marginTop: 18, marginBottom: 8 }]}>食材</Text>
              {selectedVariant.ingredients.length ? (
                <View style={[styles.ingredients, { backgroundColor: c.bg }]}>
                  {selectedVariant.ingredients.map((item) => (
                    <View key={item.id} style={styles.ingredientRow}>
                      <Text style={[t.body, { color: c.label }]}>{item.ingredient.name}</Text>
                      <Text style={[t.body, { color: c.secondaryLabel }]}>
                        {Number(item.quantity)} {item.unit}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={[t.subhead, { color: c.tertiaryLabel }]}>还没有记录食材</Text>
              )}

              <Text style={[t.headline, { color: c.label, marginTop: 20, marginBottom: 8 }]}>做法</Text>
              {selectedVariant.steps.length ? (
                <View style={styles.recipeList}>
                  {selectedVariant.steps.map((step, index) => (
                    <View key={step.id} style={[styles.recipeStep, { backgroundColor: c.bg }]}>
                      <View style={styles.stepHeader}>
                        <View style={[styles.stepNumber, { backgroundColor: c.tint }]}>
                          <Text style={styles.stepNumberText}>{index + 1}</Text>
                        </View>
                        <Text style={[t.body, { color: c.label, flex: 1, lineHeight: 24 }]}>
                          {step.text}
                        </Text>
                      </View>
                      {step.imageUrl ? (
                        <Image
                          contentFit="cover"
                          source={{ uri: photoUri(step.imageUrl)! }}
                          style={styles.recipeImage}
                          transition={180}
                        />
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={[t.subhead, { color: c.tertiaryLabel }]}>还没有记录步骤</Text>
              )}

              {selectedVariant.referenceLinks.length ? (
                <>
                  <Text style={[t.headline, { color: c.label, marginTop: 20, marginBottom: 8 }]}>参考链接</Text>
                  <View style={[styles.links, { backgroundColor: c.bg }]}>
                    {selectedVariant.referenceLinks.map((link, index) => (
                      <Pressable
                        accessibilityRole="link"
                        key={link.id}
                        onPress={() => void Linking.openURL(link.url)}
                        style={styles.linkRow}
                      >
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]} numberOfLines={1}>
                            {link.title || `参考资料 ${index + 1}`}
                          </Text>
                          <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]} numberOfLines={1}>
                            {link.url}
                          </Text>
                        </View>
                        <ExternalLink color={c.tint} size={17} />
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}
            </View>
          ) : (
            <View style={[styles.emptyVariant, { backgroundColor: c.bg }]}>
              <BookOpenText color={c.tertiaryLabel} size={22} />
              <Text style={[t.subhead, { color: c.secondaryLabel }]}>还没有可用做法</Text>
            </View>
          )}

          <SectionHeader title="谁会做" />
          <View style={[styles.skillPanel, { backgroundColor: c.bg }]}>
            <View style={styles.cookList}>
              {dish.skills.length ? (
                dish.skills.map((skill) => (
                  <View key={skill.id} style={styles.cookChip}>
                    <Text style={{ fontSize: 17 }}>{skill.member.avatarEmoji}</Text>
                    <Text style={[t.footnote, { color: c.label, fontWeight: '600' }]}>
                      {skill.member.name}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={[t.subhead, { color: c.tertiaryLabel }]}>还没人标记会做</Text>
              )}
            </View>
            {currentSkill ? (
              <>
                <Segmented<DishSkillLevel>
                  onChange={(level) => saveSkill(level)}
                  options={SKILL_OPTIONS}
                  value={currentSkill.level}
                />
                {selectedVariant ? (
                  <PressableScale
                    disabled={upsertSkill.isPending}
                    haptic={false}
                    onPress={() => saveSkill(currentSkill.level, selectedVariant.id)}
                    style={[styles.preferenceButton, { borderColor: c.separator }]}
                  >
                    {currentSkill.preferredRecipeId === selectedVariant.id ? (
                      <Check color={c.green} size={16} />
                    ) : (
                      <BookOpenText color={c.tint} size={16} />
                    )}
                    <Text
                      style={[
                        t.footnote,
                        {
                          color:
                            currentSkill.preferredRecipeId === selectedVariant.id
                              ? c.green
                              : c.tint,
                          fontWeight: '700',
                        },
                      ]}
                    >
                      {currentSkill.preferredRecipeId === selectedVariant.id
                        ? '这是我的常用做法'
                        : '设为我的常用做法'}
                    </Text>
                  </PressableScale>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={removeSkill.isPending}
                  onPress={() =>
                    removeSkill.mutate(
                      { memberId: member.id, dishId: dish.id },
                      {
                        onError: (error) =>
                          Alert.alert(
                            '更新失败',
                            error instanceof Error ? error.message : '请稍后再试',
                          ),
                      },
                    )
                  }
                  style={styles.removeSkill}
                >
                  <Text style={[t.footnote, { color: c.red }]}>移出我会做的菜</Text>
                </Pressable>
              </>
            ) : (
              <PressableScale
                disabled={upsertSkill.isPending}
                onPress={() => saveSkill('can_cook', selectedVariant?.id ?? null)}
                style={[styles.addSkillButton, { backgroundColor: c.tint }]}
              >
                <UserRoundCheck color="#FFFFFF" size={17} />
                <Text style={[t.subhead, { color: '#FFFFFF', fontWeight: '700' }]}>我会做这道菜</Text>
              </PressableScale>
            )}
          </View>

          <Text style={[t.headline, { color: c.label, marginTop: 22, marginBottom: 8 }]}>点菜备注</Text>
          <TextInput
            onChangeText={setNote}
            placeholder="例如：少辣、多放醋"
            placeholderTextColor={c.tertiaryLabel}
            style={[styles.noteInput, { backgroundColor: c.bg, color: c.label }]}
            value={note}
          />
        </View>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: c.separator, backgroundColor: c.card }]}>
        {inCart ? (
          <PrimaryButton
            destructive
            onPress={() => {
              cart.remove(dish.id);
              router.back();
            }}
            title="从菜篮移除"
          />
        ) : (
          <PrimaryButton
            onPress={() => {
              cart.add(dish, note.trim());
              router.back();
            }}
            title="加入菜篮"
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerActions: {
    position: 'absolute',
    zIndex: 2,
    top: 14,
    right: 14,
    flexDirection: 'row',
    gap: 8,
  },
  circleButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: { width: '100%', height: 220 },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20 },
  flavor: { borderRadius: radius.sm, padding: 11, marginTop: 12 },
  inlineAction: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  variantTabs: { gap: 8, paddingRight: 4 },
  variantTab: {
    minHeight: 36,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  variantPanel: { marginTop: 12, paddingTop: 16, borderTopWidth: 1 },
  variantHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  editVariantButton: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ingredients: { borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 3 },
  ingredientRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  recipeList: { gap: 9 },
  recipeStep: { borderRadius: radius.md, padding: 12 },
  stepHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  stepNumber: {
    width: 27,
    height: 27,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  recipeImage: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.sm, marginTop: 10 },
  links: { borderRadius: radius.md, paddingHorizontal: 12 },
  linkRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10 },
  emptyVariant: { minHeight: 90, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: 7 },
  skillPanel: { borderRadius: radius.md, padding: 12, gap: 12 },
  cookList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cookChip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  preferenceButton: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  removeSkill: { alignSelf: 'center', paddingVertical: 4 },
  addSkillButton: {
    minHeight: 42,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  noteInput: { height: 44, borderRadius: radius.sm, paddingHorizontal: 14, fontSize: 16 },
  footer: { padding: 16, paddingBottom: 28, borderTopWidth: StyleSheet.hairlineWidth },
});
