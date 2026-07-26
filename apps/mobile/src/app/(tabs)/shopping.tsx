import * as Haptics from 'expo-haptics';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Card,
  EmptyState,
  PressableScale,
  SectionHeader,
  Segmented,
} from '../../components/ui';
import { todayStr } from '../../lib/cart';
import {
  useAddManualShoppingItem,
  useCheckShoppingItem,
  useShoppingList,
} from '../../lib/queries';
import { radius, type as t, useTheme } from '../../lib/theme';
import type { ShoppingItem } from '../../lib/types';

function ItemRow({ item }: { item: ShoppingItem }) {
  const c = useTheme();
  const check = useCheckShoppingItem();
  const name = item.ingredient?.name ?? item.customName ?? '未知';

  return (
    <PressableScale
      haptic={false}
      onPress={() => {
        void Haptics.impactAsync(
          item.checked
            ? Haptics.ImpactFeedbackStyle.Light
            : Haptics.ImpactFeedbackStyle.Medium,
        );
        check.mutate({ id: item.id, checked: !item.checked });
      }}
      style={[styles.itemRow, { borderBottomColor: c.separator }]}
    >
      <View
        style={[
          styles.checkbox,
          {
            borderColor: item.checked ? c.green : c.fillStrong,
            backgroundColor: item.checked ? c.green : 'transparent',
          },
        ]}
      >
        {item.checked ? (
          <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '700' }}>✓</Text>
        ) : null}
      </View>
      <Text
        style={[
          t.body,
          {
            flex: 1,
            marginLeft: 12,
            color: item.checked ? c.tertiaryLabel : c.label,
            textDecorationLine: item.checked ? 'line-through' : 'none',
          },
        ]}
      >
        {name}
      </Text>
      {item.totalQty ? (
        <Text style={[t.subhead, { color: c.secondaryLabel }]}>
          {Number(item.totalQty)} {item.unit ?? ''}
        </Text>
      ) : null}
    </PressableScale>
  );
}

export default function ShoppingScreen() {
  const c = useTheme();
  const [date, setDate] = useState(todayStr());
  const { data: items, isLoading } = useShoppingList(date);
  const addManual = useAddManualShoppingItem();
  const [manualName, setManualName] = useState('');

  const groups = useMemo(() => {
    const map = new Map<string, ShoppingItem[]>();
    for (const item of items ?? []) {
      const key = item.ingredient?.category ?? '手动添加';
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [items]);

  const total = items?.length ?? 0;
  const done = items?.filter((i) => i.checked).length ?? 0;

  const submitManual = () => {
    const name = manualName.trim();
    if (!name) return;
    addManual.mutate({ date, customName: name });
    setManualName('');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <View style={styles.header}>
        <Text style={[t.largeTitle, { color: c.label }]}>购物清单</Text>
        {total > 0 ? (
          <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 2 }]}>
            已买 {done}/{total}
          </Text>
        ) : null}
      </View>

      <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
        <Segmented
          options={[
            { label: '今天', value: todayStr() },
            { label: '明天', value: todayStr(1) },
          ]}
          value={date}
          onChange={setDate}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? <ActivityIndicator style={{ marginTop: 48 }} /> : null}

        {!isLoading && total === 0 ? (
          <EmptyState
            emoji="🧾"
            title="清单是空的"
            hint="在「今日菜单」接单后点「生成购物清单」，或在下面手动添加"
          />
        ) : null}

        {groups.map(([category, list]) => (
          <View key={category}>
            <SectionHeader title={category} />
            <Card>
              {list.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </Card>
          </View>
        ))}

        <SectionHeader title="手动添加" />
        <Card style={styles.manualRow}>
          <TextInput
            style={[t.body, { flex: 1, color: c.label, paddingVertical: 0 }]}
            placeholder="比如：垃圾袋、酱油"
            placeholderTextColor={c.tertiaryLabel}
            value={manualName}
            onChangeText={setManualName}
            onSubmitEditing={submitManual}
            returnKeyType="done"
          />
          <PressableScale
            onPress={submitManual}
            disabled={!manualName.trim()}
            style={[
              styles.addBtn,
              { backgroundColor: manualName.trim() ? c.tint : c.fill },
            ]}
          >
            <Text
              style={[
                t.headline,
                { color: manualName.trim() ? '#FFF' : c.tertiaryLabel },
              ]}
            >
              ＋
            </Text>
          </PressableScale>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 8 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 10,
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
