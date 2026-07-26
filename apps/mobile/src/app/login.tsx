import { Redirect } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PressableScale, PrimaryButton } from '../components/ui';
import { useMembers } from '../lib/queries';
import { useSession } from '../lib/session';
import { radius, type as t, useTheme } from '../lib/theme';
import type { Member } from '../lib/types';

export default function LoginScreen() {
  const c = useTheme();
  const { member, ready, login } = useSession();
  const { data: members, isLoading, error } = useMembers(ready && !member);
  const [selected, setSelected] = useState<Member | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!ready) return null;
  if (member) return <Redirect href="/(tabs)" />;

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    try {
      await login(selected.id, pin || undefined);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '登录失败');
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
      <View style={styles.header}>
        <Text style={{ fontSize: 64 }}>🏠</Text>
        <Text style={[t.largeTitle, { color: c.label, marginTop: 8 }]}>小管家</Text>
        <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 4 }]}>
          你是哪位？
        </Text>
      </View>

      {isLoading ? <ActivityIndicator style={{ marginTop: 40 }} /> : null}
      {error ? (
        <Text style={[t.subhead, { color: c.red, textAlign: 'center' }]}>
          连不上家里的服务器，检查一下 API 是否在跑
        </Text>
      ) : null}

      <View style={styles.grid}>
        {members?.map((m, i) => {
          const active = selected?.id === m.id;
          return (
            <Animated.View key={m.id} entering={FadeInDown.delay(i * 60).springify()}>
              <PressableScale
                onPress={() => {
                  setSelected(m);
                  setPin('');
                  setMessage(null);
                }}
                style={[
                  styles.memberCard,
                  {
                    backgroundColor: c.card,
                    borderColor: active ? c.tint : 'transparent',
                  },
                ]}
              >
                <Text style={{ fontSize: 44 }}>{m.avatarEmoji}</Text>
                <Text style={[t.headline, { color: c.label, marginTop: 6 }]}>
                  {m.name}
                </Text>
                {m.role === 'chef' ? (
                  <Text style={[t.caption, { color: c.orange, marginTop: 2 }]}>
                    掌勺的
                  </Text>
                ) : null}
              </PressableScale>
            </Animated.View>
          );
        })}
      </View>

      {selected?.hasPin ? (
        <TextInput
          style={[
            styles.pinInput,
            { backgroundColor: c.card, color: c.label },
          ]}
          value={pin}
          onChangeText={setPin}
          placeholder="输入 PIN"
          placeholderTextColor={c.tertiaryLabel}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={6}
        />
      ) : null}

      {message ? (
        <Text style={[t.subhead, { color: c.red, textAlign: 'center', marginBottom: 8 }]}>
          {message}
        </Text>
      ) : null}

      <View style={{ paddingHorizontal: 24, paddingBottom: 16 }}>
        <PrimaryButton
          title="进入"
          onPress={() => void submit()}
          disabled={!selected}
          loading={busy}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: 'center', marginTop: 48, marginBottom: 24 },
  grid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 24,
    alignContent: 'flex-start',
  },
  memberCard: {
    width: 140,
    paddingVertical: 20,
    borderRadius: radius.lg,
    alignItems: 'center',
    borderWidth: 2,
  },
  pinInput: {
    marginHorizontal: 24,
    marginBottom: 12,
    height: 48,
    borderRadius: radius.sm,
    paddingHorizontal: 16,
    fontSize: 17,
    textAlign: 'center',
  },
});
