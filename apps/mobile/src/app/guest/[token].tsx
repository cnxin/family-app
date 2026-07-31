import { Check, CircleHelp, Clock3, Heart, X } from 'lucide-react-native';
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, PrimaryButton } from '../../components/ui';
import { useGuestInvitation, useRespondGuestInvitation } from '../../lib/queries';
import { radius, type as t, useTheme } from '../../lib/theme';

function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

function dateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

export default function GuestInvitationScreen() {
  const c = useTheme();
  const token = first(useLocalSearchParams<{ token?: string | string[] }>().token);
  const invitation = useGuestInvitation(token);
  const respond = useRespondGuestInvitation(token);
  if (invitation.isLoading) return <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]}><ActivityIndicator color={c.tint} style={{ marginTop: 120 }} /></SafeAreaView>;
  if (invitation.isError || !invitation.data) return <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]}><View style={styles.center}><CircleHelp color={c.orange} size={34} /><Text style={[t.title2, { color: c.label, marginTop: 14 }]}>邀请链接不可用</Text><Text style={[t.subhead, { color: c.secondaryLabel, textAlign: 'center', marginTop: 6 }]}>它可能已过期、被撤销，或对应来访已取消。</Text></View></SafeAreaView>;
  const data = invitation.data;
  const responded = data.response.attending !== null;
  return <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]}><ScrollView contentContainerStyle={styles.content}><View style={[styles.mark, { backgroundColor: c.tintSoft }]}><Heart color={c.tint} size={26} /></View><Text style={[t.title1, { color: c.label, textAlign: 'center', marginTop: 14 }]}>你好，{data.guest.name}</Text><Text style={[t.subhead, { color: c.secondaryLabel, textAlign: 'center', marginTop: 5 }]}>{data.householdName} 邀请你参加一次来访</Text><Card style={styles.card}><Text style={[t.title2, { color: c.label }]}>{data.visit.title}</Text><View style={styles.meta}><Clock3 color={c.secondaryLabel} size={17} /><Text style={[t.subhead, { color: c.secondaryLabel, flex: 1 }]}>{dateTime(data.visit.startsAt)}{data.visit.endsAt ? ` 至 ${dateTime(data.visit.endsAt)}` : ''}</Text></View>{data.visit.note ? <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 13 }]}>{data.visit.note}</Text> : null}</Card>{responded ? <View style={[styles.response, { backgroundColor: data.response.attending ? c.greenSoft : c.orangeSoft }]}>{data.response.attending ? <Check color={c.green} size={21} /> : <X color={c.orange} size={21} />}<View style={{ flex: 1 }}><Text style={[t.headline, { color: data.response.attending ? c.green : c.orange }]}>{data.response.attending ? '已确认参加' : '已告知无法参加'}</Text><Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>需要变更时，请联系接待你的家庭成员。</Text></View></View> : <View style={styles.actions}><PrimaryButton title="我会参加" onPress={() => void respond.mutate(true)} loading={respond.isPending} icon={<Check color="#fff" size={18} />} /><Pressable accessibilityRole="button" disabled={respond.isPending} onPress={() => void respond.mutate(false)} style={[styles.decline, { backgroundColor: c.fill }]}><Text style={[t.headline, { color: c.label }]}>这次无法参加</Text></Pressable>{respond.isError ? <Text style={[t.footnote, { color: c.red, textAlign: 'center' }]}>{respond.error instanceof Error ? respond.error.message : '提交失败，请稍后重试'}</Text> : null}</View>}<Text style={[t.caption, { color: c.tertiaryLabel, textAlign: 'center', marginTop: 20 }]}>此页面不包含家庭成员、库存、片单或历史记录。</Text></ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({ screen: { flex: 1 }, content: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 24, paddingTop: 62, paddingBottom: 42 }, mark: { width: 56, height: 56, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }, card: { marginTop: 26, padding: 18 }, meta: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 13 }, actions: { gap: 10, marginTop: 18 }, decline: { minHeight: 48, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' }, response: { marginTop: 18, borderRadius: radius.md, padding: 15, flexDirection: 'row', gap: 10, alignItems: 'center' }, center: { padding: 28, alignItems: 'center', marginTop: 80 } });
