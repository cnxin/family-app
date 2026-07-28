import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ImagePlus,
  Link2,
  Plus,
  Trash2,
} from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PressableScale, PrimaryButton, SectionHeader } from '../components/ui';
import { photoUri, uploadPhoto } from '../lib/api';
import { useDishes, useUpsertDish } from '../lib/queries';
import { useSession } from '../lib/session';
import { radius, type as t, useTheme } from '../lib/theme';

const CATEGORIES = ['荤菜', '素菜', '汤', '主食', '甜品'];

interface IngredientForm {
  name: string;
  quantity: string;
  unit: string;
}

interface RecipeStepForm {
  text: string;
  imageUrl: string | null;
  localPhoto: string | null;
}

interface ReferenceLinkForm {
  title: string;
  url: string;
}

function normalizeReferenceUrl(value: string) {
  const url = value.trim();
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export default function DishEditModal() {
  const c = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { member, ready } = useSession();
  const { data: dishes } = useDishes(ready && Boolean(member));
  const editing = id ? dishes?.find((d) => d.id === id) : undefined;
  const upsert = useUpsertDish();

  const [name, setName] = useState(editing?.name ?? '');
  const [category, setCategory] = useState(editing?.category ?? '荤菜');
  const [difficulty, setDifficulty] = useState(editing?.difficulty ?? 1);
  const [estMinutes, setEstMinutes] = useState(
    editing?.estMinutes ? String(editing.estMinutes) : '',
  );
  const [note, setNote] = useState(editing?.note ?? '');
  const [photo, setPhoto] = useState<string | null>(editing?.photoUrl ?? null);
  const [localPhoto, setLocalPhoto] = useState<string | null>(null);
  const [ingredients, setIngredients] = useState<IngredientForm[]>(
    editing?.ingredients?.map((di) => ({
      name: di.ingredient.name,
      quantity: String(Number(di.quantity)),
      unit: di.unit,
    })) ?? [],
  );
  const [recipeSteps, setRecipeSteps] = useState<RecipeStepForm[]>(
    editing?.recipeSteps?.map((step) => ({
      text: step.text,
      imageUrl: step.imageUrl ?? null,
      localPhoto: null,
    })) ?? [],
  );
  const [referenceLinks, setReferenceLinks] = useState<ReferenceLinkForm[]>(
    editing?.referenceLinks?.map((link) => ({
      title: link.title ?? '',
      url: link.url,
    })) ?? [],
  );
  const [hydratedId, setHydratedId] = useState(editing?.id ?? null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing || hydratedId === editing.id) return;
    setName(editing.name);
    setCategory(editing.category);
    setDifficulty(editing.difficulty);
    setEstMinutes(editing.estMinutes ? String(editing.estMinutes) : '');
    setNote(editing.note ?? '');
    setPhoto(editing.photoUrl);
    setIngredients(
      editing.ingredients?.map((di) => ({
        name: di.ingredient.name,
        quantity: String(Number(di.quantity)),
        unit: di.unit,
      })) ?? [],
    );
    setRecipeSteps(
      editing.recipeSteps?.map((step) => ({
        text: step.text,
        imageUrl: step.imageUrl ?? null,
        localPhoto: null,
      })) ?? [],
    );
    setReferenceLinks(
      editing.referenceLinks?.map((link) => ({
        title: link.title ?? '',
        url: link.url,
      })) ?? [],
    );
    setHydratedId(editing.id);
  }, [editing, hydratedId]);

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (!result.canceled && result.assets[0]) {
      setLocalPhoto(result.assets[0].uri);
    }
  };

  const pickStepPhoto = async (index: number) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.75,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (!result.canceled && result.assets[0]) {
      setRecipeSteps((current) =>
        current.map((step, stepIndex) =>
          stepIndex === index
            ? { ...step, localPhoto: result.assets[0].uri }
            : step,
        ),
      );
    }
  };

  const updateIngredient = (i: number, patch: Partial<IngredientForm>) => {
    setIngredients((prev) =>
      prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)),
    );
  };

  const updateRecipeStep = (index: number, patch: Partial<RecipeStepForm>) => {
    setRecipeSteps((current) =>
      current.map((step, stepIndex) =>
        stepIndex === index ? { ...step, ...patch } : step,
      ),
    );
  };

  const updateReferenceLink = (index: number, patch: Partial<ReferenceLinkForm>) => {
    setReferenceLinks((current) =>
      current.map((link, linkIndex) =>
        linkIndex === index ? { ...link, ...patch } : link,
      ),
    );
  };

  const save = async () => {
    if (!name.trim()) {
      setSaveError('还没写菜名');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      let photoUrl = photo ?? undefined;
      if (localPhoto) photoUrl = await uploadPhoto(localPhoto);
      const savedRecipeSteps = [];
      for (const step of recipeSteps) {
        if (!step.text.trim() && !step.imageUrl && !step.localPhoto) continue;
        let imageUrl = step.imageUrl ?? undefined;
        if (step.localPhoto) imageUrl = await uploadPhoto(step.localPhoto);
        savedRecipeSteps.push({
          text: step.text.trim(),
          imageUrl,
        });
      }
      await upsert.mutateAsync({
        id: editing?.id,
        name: name.trim(),
        category,
        difficulty,
        estMinutes: estMinutes ? Number(estMinutes) : undefined,
        note: note.trim() || undefined,
        photoUrl,
        recipeSteps: savedRecipeSteps,
        referenceLinks: referenceLinks
          .filter((link) => link.url.trim())
          .map((link) => ({
            title: link.title.trim() || undefined,
            url: normalizeReferenceUrl(link.url),
          })),
        ingredients: ingredients
          .filter((row) => row.name.trim())
          .map((row) => ({
            name: row.name.trim(),
            quantity: Number(row.quantity) || 1,
            unit: row.unit.trim() || '份',
          })),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '保存失败，请稍后再试');
    } finally {
      setSaving(false);
    }
  };

  const displayPhoto = localPhoto ?? photoUri(photo);

  if (!ready) return null;
  if (!member) return <Redirect href="/login" />;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.modalHeader, { borderBottomColor: c.separator }]}>
        <PressableScale haptic={false} onPress={() => router.back()} style={styles.headerBtn}>
          <Text style={[t.body, { color: c.tint }]}>取消</Text>
        </PressableScale>
        <Text style={[t.headline, { color: c.label }]}>
          {editing ? '编辑菜品' : '新增菜品'}
        </Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <PressableScale onPress={() => void pickPhoto()} haptic={false}>
          {displayPhoto ? (
            <Image source={{ uri: displayPhoto }} style={styles.photo} contentFit="cover" />
          ) : (
            <View style={[styles.photo, styles.center, { backgroundColor: c.fill }]}>
              <Text style={{ fontSize: 36 }}>📷</Text>
              <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 4 }]}>
                选一张菜的照片
              </Text>
            </View>
          )}
        </PressableScale>

        <SectionHeader title="基本信息" />
        <View style={[styles.formCard, { backgroundColor: c.card }]}>
          <TextInput
            style={[styles.input, { color: c.label, borderBottomColor: c.separator }]}
            placeholder="菜名（必填）"
            placeholderTextColor={c.tertiaryLabel}
            value={name}
            onChangeText={setName}
          />
          <View style={styles.chipRow}>
            {CATEGORIES.map((cat) => {
              const active = cat === category;
              return (
                <Pressable
                  key={cat}
                  onPress={() => setCategory(cat as typeof category)}
                  style={[
                    styles.chip,
                    { backgroundColor: active ? c.tint : c.fill },
                  ]}
                >
                  <Text style={[t.subhead, { color: active ? '#FFF' : c.label }]}>
                    {cat}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.inlineRow}>
            <Text style={[t.body, { color: c.label }]}>难度</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[1, 2, 3].map((level) => (
                <Pressable key={level} onPress={() => setDifficulty(level)}>
                  <Text style={{ fontSize: 22, opacity: level <= difficulty ? 1 : 0.25 }}>
                    🔥
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={styles.inlineRow}>
            <Text style={[t.body, { color: c.label }]}>预计耗时（分钟）</Text>
            <TextInput
              style={[styles.miniInput, { color: c.label, backgroundColor: c.fill }]}
              value={estMinutes}
              onChangeText={setEstMinutes}
              keyboardType="number-pad"
              placeholder="30"
              placeholderTextColor={c.tertiaryLabel}
            />
          </View>
          <TextInput
            style={[styles.input, { color: c.label, borderBottomWidth: 0 }]}
            placeholder="口味特点（比如：酸甜、微辣）"
            placeholderTextColor={c.tertiaryLabel}
            value={note}
            onChangeText={setNote}
          />
        </View>

        <SectionHeader
          title="做法（图文）"
          right={
            <PressableScale
              accessibilityLabel="添加做法步骤"
              onPress={() =>
                setRecipeSteps((current) => [
                  ...current,
                  { text: '', imageUrl: null, localPhoto: null },
                ])
              }
            >
              <View style={styles.sectionAction}>
                <Plus color={c.tint} size={16} />
                <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]}>添加步骤</Text>
              </View>
            </PressableScale>
          }
        />
        {recipeSteps.length === 0 ? (
          <View style={[styles.emptyRecipe, { backgroundColor: c.card, borderColor: c.separator }]}>
            <ImagePlus color={c.tertiaryLabel} size={23} />
            <Text style={[t.subhead, { color: c.secondaryLabel }]}>还没有记录做法</Text>
          </View>
        ) : null}
        {recipeSteps.map((step, index) => {
          const stepPhoto = step.localPhoto ?? photoUri(step.imageUrl);
          return (
            <View
              key={index}
              style={[styles.stepCard, { backgroundColor: c.card, borderColor: c.separator }]}
            >
              <View style={styles.stepHeader}>
                <View style={[styles.stepNumber, { backgroundColor: c.tint }]}>
                  <Text style={styles.stepNumberText}>{index + 1}</Text>
                </View>
                <Text style={[t.headline, { color: c.label, flex: 1 }]}>第 {index + 1} 步</Text>
                <PressableScale
                  accessibilityLabel={`删除第${index + 1}步`}
                  haptic={false}
                  onPress={() =>
                    setRecipeSteps((current) => current.filter((_, itemIndex) => itemIndex !== index))
                  }
                  style={styles.smallIconButton}
                >
                  <Trash2 color={c.red} size={17} />
                </PressableScale>
              </View>
              <TextInput
                accessibilityLabel={`第${index + 1}步做法`}
                multiline
                onChangeText={(text) => updateRecipeStep(index, { text })}
                placeholder="写下火候、时间和关键动作"
                placeholderTextColor={c.tertiaryLabel}
                style={[
                  styles.stepTextInput,
                  t.body,
                  { backgroundColor: c.fill, color: c.label },
                ]}
                textAlignVertical="top"
                value={step.text}
              />
              <PressableScale
                accessibilityLabel={`${stepPhoto ? '更换' : '添加'}第${index + 1}步图片`}
                haptic={false}
                onPress={() => void pickStepPhoto(index)}
                style={styles.stepPhotoButton}
              >
                {stepPhoto ? (
                  <Image source={{ uri: stepPhoto }} style={styles.stepPhoto} contentFit="cover" />
                ) : (
                  <View style={[styles.stepPhotoPlaceholder, { backgroundColor: c.fill }]}>
                    <ImagePlus color={c.tint} size={20} />
                    <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>添加步骤图片</Text>
                  </View>
                )}
              </PressableScale>
            </View>
          );
        })}

        <SectionHeader
          title="食材"
          right={
            <PressableScale
              onPress={() =>
                setIngredients((prev) => [...prev, { name: '', quantity: '1', unit: '份' }])
              }
            >
              <Text style={[t.subhead, { color: c.tint, fontWeight: '600' }]}>＋ 加一行</Text>
            </PressableScale>
          }
        />
        <View style={[styles.formCard, { backgroundColor: c.card }]}>
          {ingredients.length === 0 ? (
            <Text
              style={[t.subhead, { color: c.tertiaryLabel, padding: 14, textAlign: 'center' }]}
            >
              加上食材，购物清单才能自动汇总
            </Text>
          ) : null}
          {ingredients.map((row, i) => (
            <View key={i} style={[styles.ingredientRow, { borderBottomColor: c.separator }]}>
              <TextInput
                style={[t.body, { flex: 2, color: c.label }]}
                placeholder="食材名"
                placeholderTextColor={c.tertiaryLabel}
                value={row.name}
                onChangeText={(v) => updateIngredient(i, { name: v })}
              />
              <TextInput
                style={[t.body, styles.qtyInput, { color: c.label, backgroundColor: c.fill }]}
                value={row.quantity}
                onChangeText={(v) => updateIngredient(i, { quantity: v })}
                keyboardType="decimal-pad"
              />
              <TextInput
                style={[t.body, styles.qtyInput, { color: c.label, backgroundColor: c.fill }]}
                value={row.unit}
                onChangeText={(v) => updateIngredient(i, { unit: v })}
                placeholder="单位"
                placeholderTextColor={c.tertiaryLabel}
              />
              <Pressable
                onPress={() =>
                  setIngredients((prev) => prev.filter((_, idx) => idx !== i))
                }
                style={{ padding: 4 }}
              >
                <Text style={{ color: c.red, fontSize: 17 }}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>

        <SectionHeader
          title="参考链接"
          right={
            <PressableScale
              accessibilityLabel="添加参考链接"
              onPress={() =>
                setReferenceLinks((current) => [...current, { title: '', url: '' }])
              }
            >
              <View style={styles.sectionAction}>
                <Link2 color={c.tint} size={16} />
                <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]}>添加链接</Text>
              </View>
            </PressableScale>
          }
        />
        <View style={[styles.formCard, { backgroundColor: c.card }]}>
          {referenceLinks.length === 0 ? (
            <Text style={[t.subhead, { color: c.tertiaryLabel, padding: 14, textAlign: 'center' }]}>
              可以保存视频、文章或家人的做菜笔记链接
            </Text>
          ) : null}
          {referenceLinks.map((link, index) => (
            <View key={index} style={[styles.linkRow, { borderBottomColor: c.separator }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <TextInput
                  accessibilityLabel={`第${index + 1}个链接标题`}
                  onChangeText={(title) => updateReferenceLink(index, { title })}
                  placeholder="标题（可选）"
                  placeholderTextColor={c.tertiaryLabel}
                  style={[styles.linkInput, t.subhead, { color: c.label }]}
                  value={link.title}
                />
                <TextInput
                  accessibilityLabel={`第${index + 1}个参考链接`}
                  autoCapitalize="none"
                  keyboardType="url"
                  onChangeText={(url) => updateReferenceLink(index, { url })}
                  placeholder="example.com/recipe"
                  placeholderTextColor={c.tertiaryLabel}
                  style={[styles.linkInput, t.footnote, { color: c.secondaryLabel }]}
                  value={link.url}
                />
              </View>
              <PressableScale
                accessibilityLabel={`删除第${index + 1}个参考链接`}
                haptic={false}
                onPress={() =>
                  setReferenceLinks((current) => current.filter((_, itemIndex) => itemIndex !== index))
                }
                style={styles.smallIconButton}
              >
                <Trash2 color={c.red} size={17} />
              </PressableScale>
            </View>
          ))}
        </View>

        {saveError ? (
          <Text style={[t.subhead, { color: c.red, marginTop: 16, textAlign: 'center' }]}>
            {saveError}
          </Text>
        ) : null}

        <View style={{ marginTop: 28 }}>
          <PrimaryButton title="保存" onPress={() => void save()} loading={saving} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { width: 64, paddingHorizontal: 8 },
  photo: {
    width: '100%',
    height: 180,
    borderRadius: radius.md,
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  formCard: {
    borderRadius: radius.md,
    paddingHorizontal: 14,
  },
  input: {
    fontSize: 17,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 12,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  miniInput: {
    width: 72,
    height: 34,
    borderRadius: radius.sm,
    textAlign: 'center',
    fontSize: 16,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  qtyInput: {
    width: 56,
    height: 34,
    borderRadius: radius.sm,
    textAlign: 'center',
  },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  emptyRecipe: {
    minHeight: 86,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  stepCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  smallIconButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  stepTextInput: {
    minHeight: 88,
    borderRadius: radius.sm,
    padding: 11,
    marginTop: 10,
  },
  stepPhotoButton: { marginTop: 10 },
  stepPhoto: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.sm },
  stepPhotoPlaceholder: {
    height: 54,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  linkRow: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  linkInput: { minHeight: 32, paddingHorizontal: 2, paddingVertical: 4 },
});
