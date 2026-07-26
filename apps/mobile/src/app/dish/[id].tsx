import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PrimaryButton } from '../../components/ui';
import { photoUri } from '../../lib/api';
import { useCart } from '../../lib/cart';
import { useDishes } from '../../lib/queries';
import { CATEGORY_EMOJI, radius, type as t, useTheme } from '../../lib/theme';

export default function DishDetailSheet() {
  const c = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: dishes } = useDishes();
  const cart = useCart();
  const dish = dishes?.find((d) => d.id === id);
  const inCart = dish ? cart.has(dish.id) : false;
  const [note, setNote] = useState(
    () => cart.entries.find((e) => e.dish.id === id)?.note ?? '',
  );

  if (!dish) return null;

  return (
    <View style={{ flex: 1, backgroundColor: c.card }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {dish.photoUrl ? (
          <Image
            source={{ uri: photoUri(dish.photoUrl)! }}
            style={styles.photo}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View style={[styles.photo, styles.center, { backgroundColor: c.fill }]}>
            <Text style={{ fontSize: 72 }}>
              {CATEGORY_EMOJI[dish.category] ?? '🍽️'}
            </Text>
          </View>
        )}

        <View style={{ padding: 20 }}>
          <Text style={[t.title2, { color: c.label }]}>{dish.name}</Text>
          <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 6 }]}>
            {dish.category} · 难度 {'🔥'.repeat(dish.difficulty)}
            {dish.estMinutes ? ` · 约 ${dish.estMinutes} 分钟` : ''}
          </Text>
          {dish.note ? (
            <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 8 }]}>
              {dish.note}
            </Text>
          ) : null}

          {dish.ingredients?.length ? (
            <>
              <Text style={[t.headline, { color: c.label, marginTop: 20, marginBottom: 8 }]}>
                食材
              </Text>
              <View style={[styles.ingredients, { backgroundColor: c.bg }]}>
                {dish.ingredients.map((di) => (
                  <View key={di.id} style={styles.ingredientRow}>
                    <Text style={[t.body, { color: c.label }]}>
                      {di.ingredient.name}
                    </Text>
                    <Text style={[t.body, { color: c.secondaryLabel }]}>
                      {Number(di.quantity)} {di.unit}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          <Text style={[t.headline, { color: c.label, marginTop: 20, marginBottom: 8 }]}>
            口味备注
          </Text>
          <TextInput
            style={[styles.noteInput, { backgroundColor: c.bg, color: c.label }]}
            placeholder="例如：少辣、多放醋"
            placeholderTextColor={c.tertiaryLabel}
            value={note}
            onChangeText={setNote}
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {inCart ? (
          <PrimaryButton
            title="从菜篮移除"
            destructive
            onPress={() => {
              cart.remove(dish.id);
              router.back();
            }}
          />
        ) : (
          <PrimaryButton
            title="加入菜篮"
            onPress={() => {
              cart.add(dish, note.trim());
              router.back();
            }}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', height: 220 },
  center: { alignItems: 'center', justifyContent: 'center' },
  ingredients: {
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  ingredientRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  noteInput: {
    height: 44,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  footer: { padding: 16, paddingBottom: 28 },
});
