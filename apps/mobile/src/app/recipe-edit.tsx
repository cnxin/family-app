import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ImagePlus, Link2, Plus, Trash2 } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import {
  useArchiveRecipeVariant,
  useRecipe,
  useUpsertRecipeVariant,
} from '../lib/queries';
import { useSession } from '../lib/session';
import { radius, type as t, useTheme } from '../lib/theme';

interface IngredientForm {
  name: string;
  quantity: string;
  unit: string;
}

interface StepForm {
  text: string;
  imageUrl: string | null;
  localPhoto: string | null;
}

interface LinkForm {
  title: string;
  url: string;
}

function normalizeReferenceUrl(value: string) {
  const url = value.trim();
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export default function RecipeEditModal() {
  const c = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    dishId?: string | string[];
    variantId?: string | string[];
  }>();
  const dishId = Array.isArray(params.dishId) ? params.dishId[0] : params.dishId;
  const variantId = Array.isArray(params.variantId)
    ? params.variantId[0]
    : params.variantId;
  const { member, ready } = useSession();
  const { data: dish, isLoading } = useRecipe(dishId, ready && Boolean(member));
  const editing = dish?.recipeVariants.find((variant) => variant.id === variantId);
  const upsert = useUpsertRecipeVariant();
  const archive = useArchiveRecipeVariant();
  const [name, setName] = useState('我的做法');
  const [note, setNote] = useState('');
  const [estMinutes, setEstMinutes] = useState('');
  const [ingredients, setIngredients] = useState<IngredientForm[]>([]);
  const [steps, setSteps] = useState<StepForm[]>([]);
  const [links, setLinks] = useState<LinkForm[]>([]);
  const [hydratedId, setHydratedId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing || hydratedId === editing.id) return;
    setName(editing.name);
    setNote(editing.note ?? '');
    setEstMinutes(editing.estMinutes ? String(editing.estMinutes) : '');
    setIngredients(
      editing.ingredients.map((item) => ({
        name: item.ingredient.name,
        quantity: String(Number(item.quantity)),
        unit: item.unit,
      })),
    );
    setSteps(
      editing.steps.map((step) => ({
        text: step.text,
        imageUrl: step.imageUrl,
        localPhoto: null,
      })),
    );
    setLinks(
      editing.referenceLinks.map((link) => ({
        title: link.title ?? '',
        url: link.url,
      })),
    );
    setHydratedId(editing.id);
  }, [editing, hydratedId]);

  const pickStepPhoto = async (index: number) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.75,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (!result.canceled && result.assets[0]) {
      setSteps((current) =>
        current.map((step, stepIndex) =>
          stepIndex === index
            ? { ...step, localPhoto: result.assets[0].uri }
            : step,
        ),
      );
    }
  };

  const save = async () => {
    if (!dishId || !name.trim()) {
      setSaveError('请填写做法名称');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const savedSteps = [];
      for (const step of steps) {
        if (!step.text.trim() && !step.imageUrl && !step.localPhoto) continue;
        let imageUrl = step.imageUrl;
        if (step.localPhoto) imageUrl = await uploadPhoto(step.localPhoto);
        savedSteps.push({ text: step.text.trim(), imageUrl });
      }
      await upsert.mutateAsync({
        id: editing?.id,
        dishId,
        name: name.trim(),
        note: note.trim() || null,
        estMinutes: estMinutes ? Number(estMinutes) : null,
        ingredients: ingredients
          .filter((item) => item.name.trim())
          .map((item) => ({
            name: item.name.trim(),
            quantity: Number(item.quantity) || 1,
            unit: item.unit.trim() || '份',
          })),
        steps: savedSteps,
        referenceLinks: links
          .filter((link) => link.url.trim())
          .map((link) => ({
            title: link.title.trim() || null,
            url: normalizeReferenceUrl(link.url),
          })),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存失败，请稍后再试');
    } finally {
      setSaving(false);
    }
  };

  const confirmArchive = () => {
    if (!editing || !dishId) return;
    Alert.alert('归档做法', `归档「${editing.name}」？历史菜单仍会保留当时的做法。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '归档',
        style: 'destructive',
        onPress: () =>
          archive.mutate(
            { id: editing.id, dishId },
            {
              onSuccess: () => router.back(),
              onError: (error) =>
                Alert.alert(
                  '归档失败',
                  error instanceof Error ? error.message : '请稍后再试',
                ),
            },
          ),
      },
    ]);
  };

  if (!ready) return null;
  if (!member) return <Redirect href="/login" />;
  if (isLoading || (variantId && !editing)) {
    return (
      <View style={[styles.loading, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.tint} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: c.bg }}
    >
      <View style={[styles.header, { borderBottomColor: c.separator, backgroundColor: c.card }]}>
        <PressableScale haptic={false} onPress={() => router.back()} style={styles.headerSide}>
          <Text style={[t.body, { color: c.tint }]}>取消</Text>
        </PressableScale>
        <View style={styles.headerTitle}>
          <Text style={[t.headline, { color: c.label }]} numberOfLines={1}>
            {editing ? '编辑做法' : '添加我的做法'}
          </Text>
          <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 1 }]} numberOfLines={1}>
            {dish?.name}
          </Text>
        </View>
        <View style={styles.headerSide} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SectionHeader title="做法信息" />
        <View style={[styles.formCard, { backgroundColor: c.card }]}>
          <TextInput
            onChangeText={setName}
            placeholder="做法名称（例如：少油版）"
            placeholderTextColor={c.tertiaryLabel}
            style={[styles.input, { color: c.label, borderBottomColor: c.separator }]}
            value={name}
          />
          <View style={styles.timeRow}>
            <Text style={[t.body, { color: c.label }]}>预计耗时</Text>
            <View style={styles.timeInputWrap}>
              <TextInput
                keyboardType="number-pad"
                onChangeText={setEstMinutes}
                placeholder="30"
                placeholderTextColor={c.tertiaryLabel}
                style={[styles.timeInput, { backgroundColor: c.fill, color: c.label }]}
                value={estMinutes}
              />
              <Text style={[t.subhead, { color: c.secondaryLabel }]}>分钟</Text>
            </View>
          </View>
          <TextInput
            multiline
            onChangeText={setNote}
            placeholder="这版做法的特点、火候或注意事项"
            placeholderTextColor={c.tertiaryLabel}
            style={[styles.noteInput, { backgroundColor: c.fill, color: c.label }]}
            textAlignVertical="top"
            value={note}
          />
        </View>

        <SectionHeader
          title="食材"
          right={
            <PressableScale
              onPress={() =>
                setIngredients((current) => [
                  ...current,
                  { name: '', quantity: '1', unit: '份' },
                ])
              }
            >
              <View style={styles.inlineAction}>
                <Plus color={c.tint} size={16} />
                <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]}>添加食材</Text>
              </View>
            </PressableScale>
          }
        />
        <View style={[styles.formCard, { backgroundColor: c.card }]}>
          {!ingredients.length ? (
            <Text style={[styles.emptyText, t.subhead, { color: c.tertiaryLabel }]}>还没有食材</Text>
          ) : null}
          {ingredients.map((item, index) => (
            <View key={index} style={[styles.ingredientRow, { borderBottomColor: c.separator }]}>
              <TextInput
                onChangeText={(nameValue) =>
                  setIngredients((current) =>
                    current.map((row, rowIndex) =>
                      rowIndex === index ? { ...row, name: nameValue } : row,
                    ),
                  )
                }
                placeholder="食材"
                placeholderTextColor={c.tertiaryLabel}
                style={[t.body, { color: c.label, flex: 1 }]}
                value={item.name}
              />
              <TextInput
                keyboardType="decimal-pad"
                onChangeText={(quantity) =>
                  setIngredients((current) =>
                    current.map((row, rowIndex) =>
                      rowIndex === index ? { ...row, quantity } : row,
                    ),
                  )
                }
                style={[styles.smallInput, { backgroundColor: c.fill, color: c.label }]}
                value={item.quantity}
              />
              <TextInput
                onChangeText={(unit) =>
                  setIngredients((current) =>
                    current.map((row, rowIndex) =>
                      rowIndex === index ? { ...row, unit } : row,
                    ),
                  )
                }
                placeholder="单位"
                placeholderTextColor={c.tertiaryLabel}
                style={[styles.smallInput, { backgroundColor: c.fill, color: c.label }]}
                value={item.unit}
              />
              <Pressable
                accessibilityLabel={`删除第${index + 1}项食材`}
                onPress={() =>
                  setIngredients((current) =>
                    current.filter((_, rowIndex) => rowIndex !== index),
                  )
                }
                style={styles.iconButton}
              >
                <Trash2 color={c.red} size={17} />
              </Pressable>
            </View>
          ))}
        </View>

        <SectionHeader
          title="图文步骤"
          right={
            <PressableScale
              onPress={() =>
                setSteps((current) => [
                  ...current,
                  { text: '', imageUrl: null, localPhoto: null },
                ])
              }
            >
              <View style={styles.inlineAction}>
                <Plus color={c.tint} size={16} />
                <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]}>添加步骤</Text>
              </View>
            </PressableScale>
          }
        />
        {!steps.length ? (
          <View style={[styles.emptyBox, { backgroundColor: c.card, borderColor: c.separator }]}>
            <ImagePlus color={c.tertiaryLabel} size={22} />
            <Text style={[t.subhead, { color: c.secondaryLabel }]}>还没有步骤</Text>
          </View>
        ) : null}
        {steps.map((step, index) => {
          const image = step.localPhoto ?? photoUri(step.imageUrl);
          return (
            <View key={index} style={[styles.stepCard, { backgroundColor: c.card, borderColor: c.separator }]}>
              <View style={styles.stepHeader}>
                <View style={[styles.stepNumber, { backgroundColor: c.tint }]}>
                  <Text style={styles.stepNumberText}>{index + 1}</Text>
                </View>
                <Text style={[t.headline, { color: c.label, flex: 1 }]}>第 {index + 1} 步</Text>
                <Pressable
                  accessibilityLabel={`删除第${index + 1}步`}
                  onPress={() =>
                    setSteps((current) =>
                      current.filter((_, stepIndex) => stepIndex !== index),
                    )
                  }
                  style={styles.iconButton}
                >
                  <Trash2 color={c.red} size={17} />
                </Pressable>
              </View>
              <TextInput
                multiline
                onChangeText={(text) =>
                  setSteps((current) =>
                    current.map((row, stepIndex) =>
                      stepIndex === index ? { ...row, text } : row,
                    ),
                  )
                }
                placeholder="写下关键动作、火候和时间"
                placeholderTextColor={c.tertiaryLabel}
                style={[styles.stepInput, t.body, { backgroundColor: c.fill, color: c.label }]}
                textAlignVertical="top"
                value={step.text}
              />
              <PressableScale haptic={false} onPress={() => void pickStepPhoto(index)}>
                {image ? (
                  <Image contentFit="cover" source={{ uri: image }} style={styles.stepImage} />
                ) : (
                  <View style={[styles.addImage, { backgroundColor: c.fill }]}>
                    <ImagePlus color={c.tint} size={19} />
                    <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>添加图片</Text>
                  </View>
                )}
              </PressableScale>
            </View>
          );
        })}

        <SectionHeader
          title="参考链接"
          right={
            <PressableScale
              onPress={() => setLinks((current) => [...current, { title: '', url: '' }])}
            >
              <View style={styles.inlineAction}>
                <Link2 color={c.tint} size={16} />
                <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]}>添加链接</Text>
              </View>
            </PressableScale>
          }
        />
        <View style={[styles.formCard, { backgroundColor: c.card }]}>
          {!links.length ? (
            <Text style={[styles.emptyText, t.subhead, { color: c.tertiaryLabel }]}>还没有参考链接</Text>
          ) : null}
          {links.map((link, index) => (
            <View key={index} style={[styles.linkRow, { borderBottomColor: c.separator }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <TextInput
                  onChangeText={(title) =>
                    setLinks((current) =>
                      current.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, title } : row,
                      ),
                    )
                  }
                  placeholder="标题（可选）"
                  placeholderTextColor={c.tertiaryLabel}
                  style={[t.subhead, { color: c.label, paddingVertical: 6 }]}
                  value={link.title}
                />
                <TextInput
                  autoCapitalize="none"
                  keyboardType="url"
                  onChangeText={(url) =>
                    setLinks((current) =>
                      current.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, url } : row,
                      ),
                    )
                  }
                  placeholder="example.com/recipe"
                  placeholderTextColor={c.tertiaryLabel}
                  style={[t.footnote, { color: c.secondaryLabel, paddingVertical: 6 }]}
                  value={link.url}
                />
              </View>
              <Pressable
                accessibilityLabel={`删除第${index + 1}个链接`}
                onPress={() =>
                  setLinks((current) =>
                    current.filter((_, rowIndex) => rowIndex !== index),
                  )
                }
                style={styles.iconButton}
              >
                <Trash2 color={c.red} size={17} />
              </Pressable>
            </View>
          ))}
        </View>

        {saveError ? (
          <Text style={[t.subhead, { color: c.red, textAlign: 'center', marginTop: 16 }]}>
            {saveError}
          </Text>
        ) : null}
        <View style={{ marginTop: 26 }}>
          <PrimaryButton loading={saving} onPress={() => void save()} title="保存做法" />
        </View>
        {editing && !editing.isDefault ? (
          <Pressable
            disabled={archive.isPending}
            onPress={confirmArchive}
            style={styles.archiveButton}
          >
            <Text style={[t.subhead, { color: c.red }]}>归档这份做法</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    minHeight: 58,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSide: { width: 68, paddingHorizontal: 8 },
  headerTitle: { flex: 1, alignItems: 'center', minWidth: 0 },
  content: { padding: 16, paddingBottom: 48 },
  formCard: { borderRadius: radius.md, paddingHorizontal: 14 },
  input: { minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, fontSize: 17 },
  timeRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  timeInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  timeInput: { width: 68, height: 34, borderRadius: radius.sm, textAlign: 'center', fontSize: 16 },
  noteInput: { minHeight: 86, borderRadius: radius.sm, padding: 11, marginBottom: 14 },
  inlineAction: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  emptyText: { paddingVertical: 18, textAlign: 'center' },
  ingredientRow: {
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  smallInput: { width: 58, height: 34, borderRadius: radius.sm, textAlign: 'center', fontSize: 15 },
  iconButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  emptyBox: {
    minHeight: 84,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  stepCard: { borderRadius: radius.md, borderWidth: 1, padding: 12, marginBottom: 10 },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  stepNumber: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  stepInput: { minHeight: 88, borderRadius: radius.sm, padding: 11, marginTop: 10 },
  stepImage: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.sm, marginTop: 10 },
  addImage: {
    height: 52,
    borderRadius: radius.sm,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  linkRow: {
    minHeight: 66,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  archiveButton: { alignSelf: 'center', padding: 14, marginTop: 6 },
});
