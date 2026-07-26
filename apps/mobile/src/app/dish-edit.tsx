import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
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
import { useDishes, useUpsertDish } from '../lib/queries';
import { radius, type as t, useTheme } from '../lib/theme';

const CATEGORIES = ['荤菜', '素菜', '汤', '主食', '甜品'];

interface IngredientForm {
  name: string;
  quantity: string;
  unit: string;
}

export default function DishEditModal() {
  const c = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data: dishes } = useDishes();
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
  const [saving, setSaving] = useState(false);

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

  const updateIngredient = (i: number, patch: Partial<IngredientForm>) => {
    setIngredients((prev) =>
      prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)),
    );
  };

  const save = async () => {
    if (!name.trim()) {
      Alert.alert('还没写菜名');
      return;
    }
    setSaving(true);
    try {
      let photoUrl = photo ?? undefined;
      if (localPhoto) photoUrl = await uploadPhoto(localPhoto);
      await upsert.mutateAsync({
        id: editing?.id,
        name: name.trim(),
        category,
        difficulty,
        estMinutes: estMinutes ? Number(estMinutes) : undefined,
        note: note.trim() || undefined,
        photoUrl,
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
      Alert.alert('保存失败', e instanceof Error ? e.message : '稍后再试');
    } finally {
      setSaving(false);
    }
  };

  const displayPhoto = localPhoto ?? photoUri(photo);

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
            placeholder="备注（比如：孩子最爱）"
            placeholderTextColor={c.tertiaryLabel}
            value={note}
            onChangeText={setNote}
          />
        </View>

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
});
