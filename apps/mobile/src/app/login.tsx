import { Redirect } from 'expo-router';
import { ArrowRight, Check, ChefHat, House, UserRound } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDesktopLayout } from '../components/app-shell';
import { PressableScale, PrimaryButton } from '../components/ui';
import { useMembers } from '../lib/queries';
import { useSession } from '../lib/session';
import { radius, type as t, useTheme } from '../lib/theme';
import type { Member } from '../lib/types';

export default function LoginScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
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
    } catch (loginError) {
      setMessage(loginError instanceof Error ? loginError.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.frame, desktop && styles.frameDesktop]}>
            <View style={styles.brandRow}>
              <View style={[styles.brandMark, { backgroundColor: c.tint }]}>
                <House color="#FFFFFF" size={25} strokeWidth={2.2} />
              </View>
              <View>
                <Text style={[t.headline, { color: c.label }]}>小管家</Text>
                <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>家庭空间</Text>
              </View>
            </View>

            <View style={styles.heading}>
              <Text style={[t.largeTitle, { color: c.label }]}>欢迎回家</Text>
              <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 7 }]}>选择你的家庭成员身份</Text>
            </View>

            {isLoading ? <ActivityIndicator color={c.tint} style={{ marginVertical: 40 }} /> : null}
            {error ? (
              <View style={[styles.errorBox, { backgroundColor: c.redSoft }]}>
                <Text style={[t.subhead, { color: c.red, textAlign: 'center' }]}>
                  连不上家里的服务器，请检查 API 服务
                </Text>
              </View>
            ) : null}

            <View style={[styles.memberGrid, desktop && styles.memberGridDesktop]}>
              {members?.map((item, index) => {
                const active = selected?.id === item.id;
                const RoleIcon = item.role === 'chef' ? ChefHat : UserRound;
                return (
                  <Animated.View
                    key={item.id}
                    entering={FadeInDown.delay(index * 70).springify().damping(19)}
                    style={[styles.memberCell, desktop && styles.memberCellDesktop]}
                  >
                    <PressableScale
                      haptic={false}
                      onPress={() => {
                        setSelected(item);
                        setPin('');
                        setMessage(null);
                      }}
                      style={[
                        styles.memberCard,
                        {
                          backgroundColor: active ? c.tintSoft : c.card,
                          borderColor: active ? c.tint : c.separator,
                        },
                      ]}
                    >
                      <View style={[styles.memberAvatar, { backgroundColor: c.orangeSoft }]}>
                        <Text style={{ fontSize: 30 }}>{item.avatarEmoji}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[t.headline, { color: c.label }]}>{item.name}</Text>
                        <View style={styles.roleRow}>
                          <RoleIcon color={c.secondaryLabel} size={14} />
                          <Text style={[t.caption, { color: c.secondaryLabel }]}>
                            {item.role === 'chef' ? '经常掌勺' : '家庭成员'}
                          </Text>
                        </View>
                      </View>
                      <View
                        style={[
                          styles.selection,
                          {
                            backgroundColor: active ? c.tint : 'transparent',
                            borderColor: active ? c.tint : c.fillStrong,
                          },
                        ]}
                      >
                        {active ? <Check color="#FFFFFF" size={14} strokeWidth={3} /> : null}
                      </View>
                    </PressableScale>
                  </Animated.View>
                );
              })}
            </View>

            <View style={styles.actionArea}>
              {selected?.hasPin ? (
                <TextInput
                  style={[
                    styles.pinInput,
                    { backgroundColor: c.card, borderColor: c.separator, color: c.label },
                  ]}
                  value={pin}
                  onChangeText={setPin}
                  placeholder="输入家庭 PIN"
                  placeholderTextColor={c.tertiaryLabel}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={6}
                  onSubmitEditing={() => void submit()}
                />
              ) : null}

              {message ? (
                <Text style={[t.subhead, { color: c.red, textAlign: 'center' }]}>{message}</Text>
              ) : null}

              <PrimaryButton
                title={selected ? `以${selected.name}身份进入` : '选择一个成员'}
                onPress={() => void submit()}
                disabled={!selected}
                loading={busy}
                icon={!busy && selected ? <ArrowRight color="#FFFFFF" size={18} /> : undefined}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  frame: { width: '100%', maxWidth: 536 },
  frameDesktop: { maxWidth: 536 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  brandMark: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: { marginTop: 38, marginBottom: 24 },
  memberGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  memberGridDesktop: { gap: 16 },
  memberCell: { width: '100%', minWidth: 0 },
  memberCellDesktop: { width: 260 },
  memberCard: {
    minHeight: 112,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  memberAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  selection: {
    width: 23,
    height: 23,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionArea: {
    width: '100%',
    maxWidth: 360,
    alignSelf: 'center',
    gap: 12,
    marginTop: 28,
  },
  pinInput: {
    height: 46,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 16,
    textAlign: 'center',
  },
  errorBox: { padding: 12, borderRadius: radius.sm, marginBottom: 18 },
});
