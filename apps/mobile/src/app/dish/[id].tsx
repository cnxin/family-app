import { Image } from 'expo-image';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ExternalLink, X } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PressableScale, PrimaryButton } from '../../components/ui';
import { photoUri } from '../../lib/api';
import { useCart } from '../../lib/cart';
import { useDishes } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { CATEGORY_EMOJI, radius, type as t, useTheme } from '../../lib/theme';

export default function DishDetailSheet() {
  const c = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { member, ready } = useSession();
  const { data: dishes } = useDishes(ready && Boolean(member));
  const cart = useCart();
  const dish = dishes?.find((d) => d.id === id);
  const inCart = dish ? cart.has(dish.id) : false;
  const [note, setNote] = useState(
    () => cart.entries.find((e) => e.dish.id === id)?.note ?? '',
  );

  if (!ready) return null;
  if (!member) return <Redirect href="/login" />;
  if (!dish) return null;

  return (
    <View style={{ flex: 1, backgroundColor: c.card }}>
      <PressableScale
        accessibilityLabel="返回点菜"
        haptic={false}
        onPress={() => router.back()}
        style={[styles.closeButton, { backgroundColor: c.card }]}
      >
        <X color={c.label} size={20} />
      </PressableScale>
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
            <View style={[styles.flavor, { backgroundColor: c.bg }]}>
              <Text style={[t.caption, { color: c.secondaryLabel, fontWeight: '700' }]}>口味特点</Text>
              <Text style={[t.subhead, { color: c.label, marginTop: 3 }]}>{dish.note}</Text>
            </View>
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

          <Text style={[t.headline, { color: c.label, marginTop: 22, marginBottom: 8 }]}>
            做法
          </Text>
          {dish.recipeSteps?.length ? (
            <View style={styles.recipeList}>
              {dish.recipeSteps.map((step, index) => (
                <View
                  key={`${index}-${step.text}`}
                  style={[styles.recipeStep, { backgroundColor: c.bg, borderColor: c.separator }]}
                >
                  <View style={styles.recipeStepHeader}>
                    <View style={[styles.recipeStepNumber, { backgroundColor: c.tint }]}>
                      <Text style={styles.recipeStepNumberText}>{index + 1}</Text>
                    </View>
                    <Text style={[t.headline, { color: c.label }]}>第 {index + 1} 步</Text>
                  </View>
                  {step.text ? (
                    <Text style={[t.body, styles.recipeText, { color: c.label }]}>
                      {step.text}
                    </Text>
                  ) : null}
                  {step.imageUrl ? (
                    <Image
                      contentFit="cover"
                      source={{ uri: photoUri(step.imageUrl)! }}
                      style={styles.recipeImage}
                      transition={200}
                    />
                  ) : null}
                </View>
              ))}
            </View>
          ) : (
            <View style={[styles.emptyRecipe, { backgroundColor: c.bg }]}>
              <Text style={[t.subhead, { color: c.tertiaryLabel }]}>还没有记录做法</Text>
            </View>
          )}

          {dish.referenceLinks?.length ? (
            <>
              <Text style={[t.headline, { color: c.label, marginTop: 22, marginBottom: 8 }]}>
                参考链接
              </Text>
              <View style={[styles.referenceList, { backgroundColor: c.bg }]}>
                {dish.referenceLinks.map((link, index) => (
                  <Pressable
                    accessibilityRole="link"
                    key={`${link.url}-${index}`}
                    onPress={() => void Linking.openURL(link.url)}
                    style={({ pressed }) => [
                      styles.referenceLink,
                      { opacity: pressed ? 0.65 : 1, borderBottomColor: c.separator },
                    ]}
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
  closeButton: {
    position: 'absolute',
    zIndex: 2,
    top: 14,
    right: 14,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  flavor: { borderRadius: radius.sm, padding: 11, marginTop: 12 },
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
  recipeList: { gap: 10 },
  recipeStep: { borderRadius: radius.md, borderWidth: 1, padding: 12 },
  recipeStepHeader: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  recipeStepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recipeStepNumberText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  recipeText: { marginTop: 9, lineHeight: 24 },
  recipeImage: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.sm, marginTop: 10 },
  emptyRecipe: { borderRadius: radius.md, padding: 18, alignItems: 'center' },
  referenceList: { borderRadius: radius.md, paddingHorizontal: 12 },
  referenceLink: {
    minHeight: 58,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  footer: { padding: 16, paddingBottom: 28 },
});
