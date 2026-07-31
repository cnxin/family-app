import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { CalendarDays, Copy, KeyRound, Link2, Plus, Send, UserPlus, UsersRound, Wifi, X } from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DateSelector } from '../../components/date-selector';
import { PageContainer, useDesktopLayout } from '../../components/app-shell';
import { Card, EmptyState, PrimaryButton } from '../../components/ui';
import { todayStr } from '../../lib/date';
import {
  useCreateGuest,
  useCreateGuestInvitation,
  useCreateVisit,
  useCreateGuestWifiProfile,
  useGuests,
  useGuestWifiProfiles,
  useRevokeGuestInvitation,
  useUpdateGuest,
  useUpdateGuestWifiProfile,
  useUpdateVisit,
  useVisits,
} from '../../lib/queries';
import { radius, type as t, useTheme } from '../../lib/theme';
import type { Guest, GuestWifiProfile, Visit } from '../../lib/types';

function visitTime(visit: Visit) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(visit.startsAt));
}

function localDateTime(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}

function publicInvitationUrl(token: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.origin}/guest/${encodeURIComponent(token)}`;
  }
  return `guest/${token}`;
}

function ModalFrame({
  title,
  visible,
  onClose,
  children,
}: {
  title: string;
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const c = useTheme();
  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={[styles.sheet, { backgroundColor: c.card, borderColor: c.separator }]}>
          <View style={styles.sheetHeader}>
            <Text style={[t.title2, { color: c.label }]}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭" onPress={onClose} style={[styles.closeButton, { backgroundColor: c.fill }]}>
              <X color={c.secondaryLabel} size={18} />
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function GuestForm({
  guest,
  visible,
  onClose,
}: {
  guest: Guest | null;
  visible: boolean;
  onClose: () => void;
}) {
  const c = useTheme();
  const create = useCreateGuest();
  const update = useUpdateGuest();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('👋');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(guest?.name ?? '');
    setEmoji(guest?.avatarEmoji ?? '👋');
    setNote(guest?.note ?? '');
    setMessage(null);
  }, [guest, visible]);

  const submit = async () => {
    if (!name.trim()) {
      setMessage('请填写访客姓名');
      return;
    }
    try {
      if (guest) {
        await update.mutateAsync({ id: guest.id, name: name.trim(), avatarEmoji: emoji.trim() || '👋', note: note.trim() || null });
      } else {
        await create.mutateAsync({ name: name.trim(), avatarEmoji: emoji.trim() || '👋', note: note.trim() || null });
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，请稍后重试');
    }
  };

  return (
    <ModalFrame title={guest ? '编辑访客' : '新增访客'} visible={visible} onClose={onClose}>
      <Text style={[t.footnote, { color: c.secondaryLabel }]}>访客不创建家庭账号，也不会获得正式成员权限。</Text>
      <View style={styles.fieldRow}>
        <View style={{ width: 62 }}>
          <Text style={[t.footnote, { color: c.secondaryLabel, marginBottom: 6 }]}>头像</Text>
          <TextInput accessibilityLabel="访客头像" value={emoji} onChangeText={setEmoji} maxLength={16} style={[t.title2, styles.input, { backgroundColor: c.fill, color: c.label, textAlign: 'center' }]} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[t.footnote, { color: c.secondaryLabel, marginBottom: 6 }]}>姓名</Text>
          <TextInput accessibilityLabel="访客姓名" value={name} onChangeText={setName} maxLength={64} placeholder="例如：小林" placeholderTextColor={c.tertiaryLabel} style={[t.body, styles.input, { backgroundColor: c.fill, color: c.label }]} />
        </View>
      </View>
      <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 14, marginBottom: 6 }]}>备注（仅家庭成员可见）</Text>
      <TextInput accessibilityLabel="访客备注" value={note} onChangeText={setNote} maxLength={240} multiline placeholder="可记录称呼或饮食偏好" placeholderTextColor={c.tertiaryLabel} style={[t.body, styles.noteInput, { backgroundColor: c.fill, color: c.label }]} />
      {message ? <Text style={[t.footnote, { color: c.red, marginTop: 10 }]}>{message}</Text> : null}
      <PrimaryButton title="保存访客" onPress={() => void submit()} loading={create.isPending || update.isPending} style={{ marginTop: 18 }} />
    </ModalFrame>
  );
}

function VisitForm({
  guests,
  wifiProfiles,
  visible,
  onClose,
}: {
  guests: Guest[];
  wifiProfiles: GuestWifiProfile[];
  visible: boolean;
  onClose: () => void;
}) {
  const c = useTheme();
  const create = useCreateVisit();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState('18:00');
  const [note, setNote] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [guestWifiProfileId, setGuestWifiProfileId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTitle('');
    setDate(todayStr());
    setTime('18:00');
    setNote('');
    setSelected([]);
    setGuestWifiProfileId(null);
    setMessage(null);
  }, [visible]);

  const toggleGuest = (id: string) => {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };
  const submit = async () => {
    if (!title.trim()) return setMessage('请填写来访主题');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return setMessage('时间请使用 24 小时制，例如 18:30');
    if (!selected.length) return setMessage('请至少选择一位访客');
    try {
      await create.mutateAsync({ title: title.trim(), startsAt: localDateTime(date, time), note: note.trim() || null, guestIds: selected, guestWifiProfileId });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，请稍后重试');
    }
  };

  return (
    <ModalFrame title="安排来访" visible={visible} onClose={onClose}>
      <Text style={[t.footnote, { color: c.secondaryLabel }]}>安排后可为每位访客生成独立的限时确认链接。</Text>
      <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 14, marginBottom: 6 }]}>来访主题</Text>
      <TextInput accessibilityLabel="来访主题" value={title} onChangeText={setTitle} maxLength={120} placeholder="例如：周末晚餐" placeholderTextColor={c.tertiaryLabel} style={[t.body, styles.input, { backgroundColor: c.fill, color: c.label }]} />
      <View style={styles.dateRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[t.footnote, { color: c.secondaryLabel, marginBottom: 6 }]}>日期</Text>
          <DateSelector value={date} onChange={setDate} />
        </View>
        <View style={{ width: 92 }}>
          <Text style={[t.footnote, { color: c.secondaryLabel, marginBottom: 6 }]}>开始时间</Text>
          <TextInput accessibilityLabel="开始时间" value={time} onChangeText={setTime} maxLength={5} placeholder="18:00" placeholderTextColor={c.tertiaryLabel} style={[t.body, styles.input, { backgroundColor: c.fill, color: c.label, textAlign: 'center' }]} />
        </View>
      </View>
      <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 14, marginBottom: 6 }]}>访客</Text>
      <View style={styles.guestPicker}>
        {guests.map((guest) => {
          const active = selected.includes(guest.id);
          return <Pressable key={guest.id} accessibilityRole="checkbox" accessibilityState={{ checked: active }} onPress={() => toggleGuest(guest.id)} style={[styles.guestChoice, { borderColor: active ? c.tint : c.separator, backgroundColor: active ? c.tintSoft : c.card }]}><Text style={{ fontSize: 20 }}>{guest.avatarEmoji}</Text><Text style={[t.footnote, { color: active ? c.tint : c.label, fontWeight: active ? '700' : '500' }]}>{guest.name}</Text></Pressable>;
        })}
      </View>
      {!guests.length ? <Text style={[t.footnote, { color: c.orange, marginTop: 8 }]}>请先新增至少一位活跃访客。</Text> : null}
      <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 14, marginBottom: 6 }]}>访客 Wi-Fi（可选）</Text>
      <View style={styles.guestPicker}>
        <Pressable accessibilityRole="radio" accessibilityState={{ checked: guestWifiProfileId === null }} onPress={() => setGuestWifiProfileId(null)} style={[styles.guestChoice, { borderColor: guestWifiProfileId === null ? c.tint : c.separator, backgroundColor: guestWifiProfileId === null ? c.tintSoft : c.card }]}><Text style={[t.footnote, { color: guestWifiProfileId === null ? c.tint : c.label }]}>不提供</Text></Pressable>
        {wifiProfiles.map((profile) => {
          const active = guestWifiProfileId === profile.id;
          return <Pressable key={profile.id} accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={() => setGuestWifiProfileId(profile.id)} style={[styles.guestChoice, { borderColor: active ? c.tint : c.separator, backgroundColor: active ? c.tintSoft : c.card }]}><Wifi color={active ? c.tint : c.secondaryLabel} size={15} /><Text style={[t.footnote, { color: active ? c.tint : c.label, fontWeight: active ? '700' : '500' }]}>{profile.name}</Text></Pressable>;
        })}
      </View>
      {!wifiProfiles.length ? <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 7 }]}>可先在下方配置访客 Wi-Fi，密码仅加密保存。</Text> : null}
      <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 14, marginBottom: 6 }]}>家庭备注</Text>
      <TextInput accessibilityLabel="来访备注" value={note} onChangeText={setNote} maxLength={1000} multiline placeholder="仅家庭成员可见" placeholderTextColor={c.tertiaryLabel} style={[t.body, styles.noteInput, { backgroundColor: c.fill, color: c.label }]} />
      {message ? <Text style={[t.footnote, { color: c.red, marginTop: 10 }]}>{message}</Text> : null}
      <PrimaryButton title="保存来访计划" disabled={!guests.length} loading={create.isPending} onPress={() => void submit()} style={{ marginTop: 18 }} />
    </ModalFrame>
  );
}

function GuestWifiProfileForm({
  profile,
  visible,
  onClose,
}: {
  profile: GuestWifiProfile | null;
  visible: boolean;
  onClose: () => void;
}) {
  const c = useTheme();
  const create = useCreateGuestWifiProfile();
  const update = useUpdateGuestWifiProfile();
  const [name, setName] = useState('');
  const [ssid, setSsid] = useState('');
  const [security, setSecurity] = useState<'WPA' | 'nopass'>('WPA');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(profile?.name ?? '家中访客网络');
    setSsid(profile?.ssid ?? '');
    setSecurity(profile?.security ?? 'WPA');
    setPassword('');
    setMessage(null);
  }, [profile, visible]);

  const submit = async () => {
    if (!name.trim() || !ssid.trim()) return setMessage('请填写配置名称和 Wi-Fi 名称');
    if (security === 'WPA' && !profile && password.length < 8) return setMessage('WPA 密码至少需要 8 位');
    try {
      if (profile) {
        await update.mutateAsync({
          id: profile.id,
          name: name.trim(),
          ssid: ssid.trim(),
          security,
          ...(password ? { password } : {}),
        });
      } else {
        await create.mutateAsync({ name: name.trim(), ssid: ssid.trim(), security, password: security === 'WPA' ? password : null });
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，请稍后重试');
    }
  };

  return <ModalFrame title={profile ? '编辑访客 Wi-Fi' : '新增访客 Wi-Fi'} visible={visible} onClose={onClose}>
    <Text style={[t.footnote, { color: c.secondaryLabel }]}>此处只记录手动配置，不会连接或修改路由器。密码会在服务器端加密保存。</Text>
    <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 14, marginBottom: 6 }]}>配置名称</Text>
    <TextInput accessibilityLabel="Wi-Fi 配置名称" value={name} onChangeText={setName} maxLength={64} placeholder="例如：客厅访客网络" placeholderTextColor={c.tertiaryLabel} style={[t.body, styles.input, { backgroundColor: c.fill, color: c.label }]} />
    <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 14, marginBottom: 6 }]}>Wi-Fi 名称（SSID）</Text>
    <TextInput accessibilityLabel="Wi-Fi 名称" value={ssid} onChangeText={setSsid} maxLength={32} autoCapitalize="none" placeholder="例如：Family-Guest" placeholderTextColor={c.tertiaryLabel} style={[t.body, styles.input, { backgroundColor: c.fill, color: c.label }]} />
    <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 14, marginBottom: 6 }]}>安全方式</Text>
    <View style={styles.guestPicker}><Pressable accessibilityRole="radio" accessibilityState={{ checked: security === 'WPA' }} onPress={() => setSecurity('WPA')} style={[styles.guestChoice, { borderColor: security === 'WPA' ? c.tint : c.separator, backgroundColor: security === 'WPA' ? c.tintSoft : c.card }]}><KeyRound color={security === 'WPA' ? c.tint : c.secondaryLabel} size={15} /><Text style={[t.footnote, { color: security === 'WPA' ? c.tint : c.label, fontWeight: security === 'WPA' ? '700' : '500' }]}>WPA 密码</Text></Pressable><Pressable accessibilityRole="radio" accessibilityState={{ checked: security === 'nopass' }} onPress={() => setSecurity('nopass')} style={[styles.guestChoice, { borderColor: security === 'nopass' ? c.tint : c.separator, backgroundColor: security === 'nopass' ? c.tintSoft : c.card }]}><Text style={[t.footnote, { color: security === 'nopass' ? c.tint : c.label, fontWeight: security === 'nopass' ? '700' : '500' }]}>开放网络</Text></Pressable></View>
    {security === 'WPA' ? <><Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 14, marginBottom: 6 }]}>{profile ? '更换密码（留空则保持原密码）' : '密码'}</Text><TextInput accessibilityLabel="访客 Wi-Fi 密码" value={password} onChangeText={setPassword} maxLength={63} secureTextEntry autoCapitalize="none" placeholder={profile ? '不修改密码' : '至少 8 位'} placeholderTextColor={c.tertiaryLabel} style={[t.body, styles.input, { backgroundColor: c.fill, color: c.label }]} /></> : null}
    {message ? <Text style={[t.footnote, { color: c.red, marginTop: 10 }]}>{message}</Text> : null}
    <PrimaryButton title="保存 Wi-Fi 配置" onPress={() => void submit()} loading={create.isPending || update.isPending} style={{ marginTop: 18 }} />
  </ModalFrame>;
}

function VisitWifiForm({
  visit,
  profiles,
  visible,
  onClose,
}: {
  visit: Visit | null;
  profiles: GuestWifiProfile[];
  visible: boolean;
  onClose: () => void;
}) {
  const c = useTheme();
  const updateVisit = useUpdateVisit();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setSelectedId(visit?.guestWifiProfile?.id ?? null);
    setMessage(null);
  }, [visit, visible]);
  const submit = async () => {
    if (!visit) return;
    try {
      await updateVisit.mutateAsync({ id: visit.id, guestWifiProfileId: selectedId });
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，请稍后重试');
    }
  };
  return <ModalFrame title="本次来访的 Wi-Fi" visible={visible} onClose={onClose}>
    <Text style={[t.footnote, { color: c.secondaryLabel }]}>选择后，仍有效的访客邀请页才会显示该网络的连接二维码。</Text>
    <View style={[styles.wifiChoices, { borderTopColor: c.separator }]}><Pressable accessibilityRole="radio" accessibilityState={{ checked: selectedId === null }} onPress={() => setSelectedId(null)} style={styles.wifiChoice}><Text style={[t.body, { color: c.label, flex: 1 }]}>不提供 Wi-Fi</Text>{selectedId === null ? <Text style={[t.caption, { color: c.tint }]}>已选</Text> : null}</Pressable>{profiles.map((profile) => <Pressable key={profile.id} accessibilityRole="radio" accessibilityState={{ checked: selectedId === profile.id }} onPress={() => setSelectedId(profile.id)} style={styles.wifiChoice}><Wifi color={c.tint} size={17} /><View style={{ flex: 1, minWidth: 0 }}><Text style={[t.body, { color: c.label }]}>{profile.name}</Text><Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>{profile.ssid} · {profile.security === 'WPA' ? 'WPA' : '开放网络'}</Text></View>{selectedId === profile.id ? <Text style={[t.caption, { color: c.tint }]}>已选</Text> : null}</Pressable>)}</View>
    {!profiles.length ? <Text style={[t.footnote, { color: c.orange, marginTop: 10 }]}>尚未配置可用的访客 Wi-Fi。</Text> : null}
    {message ? <Text style={[t.footnote, { color: c.red, marginTop: 10 }]}>{message}</Text> : null}
    <PrimaryButton title="保存本次设置" onPress={() => void submit()} loading={updateVisit.isPending} style={{ marginTop: 18 }} />
  </ModalFrame>;
}

export default function GuestsScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const { data: guests, isLoading: guestsLoading } = useGuests();
  const { data: visits, isLoading: visitsLoading } = useVisits();
  const { data: guestWifiProfiles, isLoading: guestWifiProfilesLoading } = useGuestWifiProfiles();
  const updateGuest = useUpdateGuest();
  const updateGuestWifiProfile = useUpdateGuestWifiProfile();
  const updateVisit = useUpdateVisit();
  const createInvitation = useCreateGuestInvitation();
  const revokeInvitation = useRevokeGuestInvitation();
  const [guestForm, setGuestForm] = useState<Guest | 'new' | null>(null);
  const [visitForm, setVisitForm] = useState(false);
  const [wifiProfileForm, setWifiProfileForm] = useState<GuestWifiProfile | 'new' | null>(null);
  const [visitWifiForm, setVisitWifiForm] = useState<Visit | null>(null);
  const [share, setShare] = useState<{ url: string; guestName: string } | null>(null);
  const activeGuests = useMemo(() => guests?.filter((guest) => guest.isActive) ?? [], [guests]);
  const activeGuestWifiProfiles = useMemo(() => guestWifiProfiles?.filter((profile) => profile.isActive && (profile.security === 'nopass' || profile.passwordConfigured)) ?? [], [guestWifiProfiles]);
  const scheduledVisits = visits?.filter((visit) => visit.status === 'scheduled') ?? [];

  const makeInvitation = async (visit: Visit, guest: Guest) => {
    try {
      const result = await createInvitation.mutateAsync({ visitId: visit.id, guestId: guest.id });
      setShare({ url: publicInvitationUrl(result.invitationToken), guestName: guest.name });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert('创建邀请失败', error instanceof Error ? error.message : '请稍后重试');
    }
  };
  const copyInvitation = async () => {
    if (!share) return;
    await Clipboard.setStringAsync(share.url);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('已复制', '邀请链接只会显示这一次，请直接发送给访客。');
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <PageContainer style={[styles.content, desktop && styles.contentDesktop]}>
          <View style={styles.hero}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={[styles.heroIcon, { backgroundColor: c.blueSoft }]}><UsersRound color={c.blue} size={24} /></View>
              <Text style={[t.title1, { color: c.label, marginTop: 12 }]}>访客来访</Text>
              <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 5 }]}>独立访客档案、来访计划和限时确认链接</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setVisitForm(true)} style={({ pressed }) => [styles.addButton, { backgroundColor: pressed ? c.tint : c.tint }]}><Plus color="#fff" size={20} /><Text style={[t.headline, { color: '#fff' }]}>安排来访</Text></Pressable>
          </View>

          <View style={styles.sectionHeader}><Text style={[t.title2, { color: c.label }]}>即将来访</Text><Text style={[t.footnote, { color: c.secondaryLabel }]}>{scheduledVisits.length} 项</Text></View>
          {visitsLoading ? <ActivityIndicator color={c.tint} style={styles.loader} /> : scheduledVisits.length ? <View style={styles.list}>{scheduledVisits.map((visit) => <Card key={visit.id} style={styles.visitCard}>
            <View style={styles.visitHeader}><View style={{ flex: 1, minWidth: 0 }}><Text style={[t.headline, { color: c.label }]} numberOfLines={1}>{visit.title}</Text><Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 4 }]}>{visitTime(visit)} · 接待 {visit.hostMember?.name ?? '家庭成员'}</Text></View><CalendarDays color={c.tint} size={20} /></View>
            {visit.note ? <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 9 }]}>{visit.note}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={`设置 ${visit.title} 的访客 Wi-Fi`} onPress={() => setVisitWifiForm(visit)} style={[styles.wifiAssignment, { backgroundColor: visit.guestWifiProfile ? c.blueSoft : c.fill }]}><Wifi color={visit.guestWifiProfile ? c.blue : c.secondaryLabel} size={16} /><Text style={[t.footnote, { color: visit.guestWifiProfile ? c.blue : c.secondaryLabel, flex: 1 }]}>{visit.guestWifiProfile ? `访客 Wi-Fi：${visit.guestWifiProfile.name}` : '未提供访客 Wi-Fi'}</Text><Text style={[t.caption, { color: visit.guestWifiProfile ? c.blue : c.secondaryLabel }]}>更改</Text></Pressable>
            <View style={[styles.participantList, { borderTopColor: c.separator }]}>{visit.guests.map((participant) => <View key={participant.id} style={styles.participantRow}><Text style={{ fontSize: 20 }}>{participant.guest.avatarEmoji}</Text><Text style={[t.subhead, { color: c.label, flex: 1 }]}>{participant.guest.name}</Text><Text style={[t.caption, { color: participant.isAttending === true ? c.green : participant.isAttending === false ? c.orange : c.secondaryLabel }]}>{participant.isAttending === true ? '已确认' : participant.isAttending === false ? '无法参加' : '待确认'}</Text>{participant.invitation && !participant.invitation.revokedAt ? <Pressable accessibilityRole="button" accessibilityLabel={`撤销 ${participant.guest.name} 的邀请`} onPress={() => void revokeInvitation.mutateAsync(participant.invitation!.id)} style={[styles.iconAction, { backgroundColor: c.fill }]}><X color={c.secondaryLabel} size={15} /></Pressable> : <Pressable accessibilityRole="button" accessibilityLabel={`生成 ${participant.guest.name} 的邀请`} onPress={() => void makeInvitation(visit, participant.guest)} style={[styles.inviteButton, { backgroundColor: c.tintSoft }]}><Send color={c.tint} size={14} /><Text style={[t.caption, { color: c.tint, fontWeight: '700' }]}>邀请</Text></Pressable>}</View>)}</View>
            <View style={styles.visitActions}><Pressable accessibilityRole="button" onPress={() => void updateVisit.mutateAsync({ id: visit.id, status: 'completed' })} style={[styles.textAction, { backgroundColor: c.fill }]}><Text style={[t.footnote, { color: c.label, fontWeight: '700' }]}>标记结束</Text></Pressable><Pressable accessibilityRole="button" onPress={() => Alert.alert('取消来访', '已生成的邀请会同时失效。', [{ text: '返回' }, { text: '取消来访', style: 'destructive', onPress: () => void updateVisit.mutateAsync({ id: visit.id, status: 'cancelled' }) }])} style={[styles.textAction, { backgroundColor: c.redSoft }]}><Text style={[t.footnote, { color: c.red, fontWeight: '700' }]}>取消来访</Text></Pressable></View>
          </Card>)}</View> : <Card><EmptyState emoji="👋" title="还没有来访计划" hint="新增访客后，即可安排来访并发送确认链接。" /></Card>}

          <View style={styles.sectionHeader}><Text style={[t.title2, { color: c.label }]}>访客 Wi-Fi</Text><Pressable accessibilityRole="button" onPress={() => setWifiProfileForm('new')} style={styles.addGuest}><Plus color={c.tint} size={16} /><Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>新增配置</Text></Pressable></View>
          {guestWifiProfilesLoading ? <ActivityIndicator color={c.tint} style={styles.loader} /> : guestWifiProfiles?.length ? <View style={styles.list}>{guestWifiProfiles.map((profile) => <Card key={profile.id} style={[styles.wifiCard, !profile.isActive && { opacity: 0.6 }]}><View style={styles.wifiCardTop}><Pressable accessibilityRole="button" onPress={() => setWifiProfileForm(profile)} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }}><View style={[styles.wifiMark, { backgroundColor: c.blueSoft }]}><Wifi color={c.blue} size={18} /></View><View style={{ flex: 1, minWidth: 0 }}><Text style={[t.headline, { color: c.label }]}>{profile.name}</Text><Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>{profile.ssid} · {profile.security === 'WPA' ? (profile.passwordConfigured ? 'WPA 已配置' : '缺少密码') : '开放网络'}</Text></View></Pressable><Switch value={profile.isActive} onValueChange={(isActive) => void updateGuestWifiProfile.mutateAsync({ id: profile.id, isActive })} trackColor={{ false: c.fillStrong, true: c.blueSoft }} thumbColor={profile.isActive ? c.blue : c.tertiaryLabel} accessibilityLabel={`${profile.name}${profile.isActive ? '已启用' : '已停用'}`} /></View><Text style={[t.caption, { color: c.secondaryLabel, marginTop: 10 }]}>停用后，已发出的访客链接会立即隐藏该网络二维码。</Text></Card>)}</View> : <Card><EmptyState emoji="📶" title="尚未配置访客 Wi-Fi" hint="手动保存 SSID 和密码后，可绑定到一次来访并通过二维码分享。" /></Card>}

          <View style={styles.sectionHeader}><Text style={[t.title2, { color: c.label }]}>访客档案</Text><Pressable accessibilityRole="button" onPress={() => setGuestForm('new')} style={styles.addGuest}><UserPlus color={c.tint} size={16} /><Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>新增访客</Text></Pressable></View>
          {guestsLoading ? <ActivityIndicator color={c.tint} style={styles.loader} /> : guests?.length ? <View style={styles.guestGrid}>{guests.map((guest) => <Card key={guest.id} style={[styles.guestCard, !guest.isActive && { opacity: 0.62 }]}><View style={styles.guestCardTop}><Text style={{ fontSize: 30 }}>{guest.avatarEmoji}</Text><Switch value={guest.isActive} onValueChange={(isActive) => void updateGuest.mutateAsync({ id: guest.id, isActive })} trackColor={{ false: c.fillStrong, true: c.tintSoft }} thumbColor={guest.isActive ? c.tint : c.tertiaryLabel} accessibilityLabel={`${guest.name}${guest.isActive ? '启用' : '停用'}`} /></View><Pressable accessibilityRole="button" onPress={() => setGuestForm(guest)}><Text style={[t.headline, { color: c.label }]}>{guest.name}</Text><Text numberOfLines={2} style={[t.caption, { color: c.secondaryLabel, marginTop: 5, minHeight: 32 }]}>{guest.note ?? (guest.isActive ? '暂无家庭备注' : '已停用，不可加入新来访')}</Text></Pressable></Card>)}</View> : <Card><EmptyState emoji="👋" title="还没有访客档案" hint="添加常来访客，不会为其创建正式账号。" /></Card>}
        </PageContainer>
      </ScrollView>
      <GuestForm guest={guestForm === 'new' ? null : guestForm} visible={Boolean(guestForm)} onClose={() => setGuestForm(null)} />
      <VisitForm guests={activeGuests} wifiProfiles={activeGuestWifiProfiles} visible={visitForm} onClose={() => setVisitForm(false)} />
      <GuestWifiProfileForm profile={wifiProfileForm === 'new' ? null : wifiProfileForm} visible={Boolean(wifiProfileForm)} onClose={() => setWifiProfileForm(null)} />
      <VisitWifiForm visit={visitWifiForm} profiles={activeGuestWifiProfiles} visible={Boolean(visitWifiForm)} onClose={() => setVisitWifiForm(null)} />
      <ModalFrame title="访客确认链接" visible={Boolean(share)} onClose={() => setShare(null)}><View style={[styles.shareMark, { backgroundColor: c.tintSoft }]}><Link2 color={c.tint} size={22} /></View><Text style={[t.headline, { color: c.label, textAlign: 'center', marginTop: 12 }]}>发送给 {share?.guestName}</Text><Text style={[t.footnote, { color: c.secondaryLabel, textAlign: 'center', marginTop: 6 }]}>链接仅在此刻显示一次，访客无需登录即可确认是否参加。</Text><View style={[styles.urlBox, { backgroundColor: c.fill }]}><Text numberOfLines={2} selectable style={[t.caption, { color: c.label, flex: 1 }]}>{share?.url}</Text></View><PrimaryButton title="复制邀请链接" onPress={() => void copyInvitation()} icon={<Copy color="#fff" size={17} />} style={{ marginTop: 16 }} /></ModalFrame>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { paddingTop: 20, paddingBottom: 42 }, contentDesktop: { paddingTop: 32 },
  hero: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 }, heroIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  addButton: { minHeight: 42, paddingHorizontal: 14, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  sectionHeader: { minHeight: 42, marginTop: 30, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, list: { gap: 10 }, loader: { marginVertical: 36 },
  visitCard: { padding: 14 }, visitHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, wifiAssignment: { minHeight: 36, borderRadius: radius.sm, paddingHorizontal: 9, marginTop: 11, flexDirection: 'row', alignItems: 'center', gap: 7 }, participantList: { marginTop: 13, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, gap: 4 }, participantRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 8 },
  inviteButton: { minHeight: 30, paddingHorizontal: 8, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', gap: 4 }, iconAction: { width: 30, height: 30, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' }, visitActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10 }, textAction: { minHeight: 32, paddingHorizontal: 10, borderRadius: radius.sm, justifyContent: 'center' },
  addGuest: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 5 }, guestGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, guestCard: { width: '47%', minWidth: 150, flexGrow: 1, padding: 13 }, guestCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 },
  wifiCard: { padding: 14 }, wifiCardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 }, wifiMark: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' }, wifiChoices: { marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, gap: 2, paddingTop: 6 }, wifiChoice: { minHeight: 52, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 9 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.38)', justifyContent: 'center', padding: 18 }, sheet: { width: '100%', maxWidth: 560, maxHeight: '88%', alignSelf: 'center', borderWidth: 1, borderRadius: radius.md, padding: 18 }, sheetHeader: { minHeight: 34, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }, closeButton: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  fieldRow: { flexDirection: 'row', gap: 10, marginTop: 16 }, input: { minHeight: 42, borderRadius: radius.sm, paddingHorizontal: 11 }, noteInput: { minHeight: 76, borderRadius: radius.sm, paddingHorizontal: 11, paddingTop: 10, textAlignVertical: 'top' }, dateRow: { flexDirection: 'row', gap: 12, marginTop: 14, alignItems: 'flex-end' }, guestPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, guestChoice: { minHeight: 38, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5 },
  shareMark: { width: 46, height: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }, urlBox: { minHeight: 58, borderRadius: radius.sm, padding: 10, marginTop: 14, justifyContent: 'center' },
});
