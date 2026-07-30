import * as Haptics from 'expo-haptics';
import { Redirect } from 'expo-router';
import {
  CheckCircle2,
  KeyRound,
  RotateCcw,
  Save,
  ServerCog,
} from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ModuleBackButton,
  PageContainer,
  useDesktopLayout,
} from '../../../components/app-shell';
import { Card, EmptyState, PrimaryButton, Segmented } from '../../../components/ui';
import {
  useMediaSourceConfigs,
  useResetMediaSourceConfig,
  useUpdateMediaSourceConfig,
} from '../../../lib/queries';
import { useSession } from '../../../lib/session';
import { radius, type as t, useTheme } from '../../../lib/theme';
import type { MediaSourceConfig } from '../../../lib/types';

function SourceEditor({ config }: { config: MediaSourceConfig }) {
  const c = useTheme();
  const update = useUpdateMediaSourceConfig();
  const reset = useResetMediaSourceConfig();
  const [isEnabled, setIsEnabled] = useState(config.isEnabled);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl ?? '');
  const [credentialKind, setCredentialKind] = useState(config.credentialKind);
  const [credential, setCredential] = useState('');
  const [clearCredential, setClearCredential] = useState(false);
  const [imageBaseUrl, setImageBaseUrl] = useState(
    config.settings.imageBaseUrl ?? '',
  );
  const [userAgent, setUserAgent] = useState(config.settings.userAgent ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const busy =
    (update.isPending && update.variables?.provider === config.provider) ||
    (reset.isPending && reset.variables === config.provider);

  useEffect(() => {
    setIsEnabled(config.isEnabled);
    setBaseUrl(config.baseUrl ?? '');
    setCredentialKind(config.credentialKind);
    setCredential('');
    setClearCredential(false);
    setImageBaseUrl(config.settings.imageBaseUrl ?? '');
    setUserAgent(config.settings.userAgent ?? '');
  }, [config]);

  const save = async () => {
    setMessage(null);
    try {
      await update.mutateAsync({
        provider: config.provider,
        isEnabled,
        baseUrl: baseUrl.trim() || null,
        credentialKind,
        ...(credential.trim() ? { credential: credential.trim() } : {}),
        ...(clearCredential ? { clearCredential: true } : {}),
        ...(config.provider === 'tmdb'
          ? { imageBaseUrl: imageBaseUrl.trim() || null }
          : {}),
        ...(config.provider === 'bangumi'
          ? { userAgent: userAgent.trim() || null }
          : {}),
      });
      setCredential('');
      setClearCredential(false);
      setMessage('已保存');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    }
  };

  const restore = async () => {
    setMessage(null);
    try {
      await reset.mutateAsync(config.provider);
      setMessage('已恢复服务器默认设置');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '恢复失败');
    }
  };

  const status = !isEnabled
    ? { label: '已停用', color: c.secondaryLabel, background: c.fill }
    : config.configured
      ? { label: '已配置', color: c.green, background: c.greenSoft }
      : { label: '待配置', color: c.orange, background: c.orangeSoft };
  const credentialLabel = credentialKind === 'api_key' ? 'API Key' : 'API Token';

  return (
    <Card style={styles.sourceCard}>
      <View style={styles.sourceHeader}>
        <View style={[styles.sourceIcon, { backgroundColor: c.fill }]}>
          <ServerCog color={c.tint} size={20} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[t.headline, { color: c.label }]}>{config.name}</Text>
          <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>
            {config.mode === 'household' ? '家庭设置' : '服务器默认'}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: status.background }]}>
          <Text style={[t.caption, { color: status.color, fontWeight: '700' }]}>
            {status.label}
          </Text>
        </View>
      </View>

      <View style={[styles.toggleRow, { borderColor: c.separator }]}>
        <Text style={[t.subhead, { color: c.label, fontWeight: '600' }]}>启用数据源</Text>
        <Switch
          accessibilityLabel={`启用${config.name}`}
          disabled={busy}
          onValueChange={setIsEnabled}
          trackColor={{ false: c.fillStrong, true: c.tintSoft }}
          thumbColor={isEnabled ? c.tint : c.tertiaryLabel}
          value={isEnabled}
        />
      </View>

      <View style={styles.field}>
        <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>API 地址</Text>
        <TextInput
          accessibilityLabel={`${config.name} API 地址`}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          onChangeText={setBaseUrl}
          placeholder="https://"
          placeholderTextColor={c.tertiaryLabel}
          style={[t.subhead, styles.input, { backgroundColor: c.fill, color: c.label }]}
          value={baseUrl}
        />
      </View>

      {config.provider === 'tmdb' ? (
        <>
          <View style={styles.field}>
            <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>图片地址</Text>
            <TextInput
              accessibilityLabel="TMDB 图片地址"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              onChangeText={setImageBaseUrl}
              placeholder="https://image.tmdb.org/t/p/w500"
              placeholderTextColor={c.tertiaryLabel}
              style={[t.subhead, styles.input, { backgroundColor: c.fill, color: c.label }]}
              value={imageBaseUrl}
            />
          </View>
          <View style={styles.field}>
            <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>凭据类型</Text>
            <Segmented<'token' | 'api_key'>
              onChange={setCredentialKind}
              options={[
                { label: 'API Token', value: 'token' },
                { label: 'API Key', value: 'api_key' },
              ]}
              value={credentialKind}
            />
          </View>
        </>
      ) : null}

      {config.provider === 'bangumi' ? (
        <View style={styles.field}>
          <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>User-Agent</Text>
          <TextInput
            accessibilityLabel="Bangumi User-Agent"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            onChangeText={setUserAgent}
            placeholder="family-app/0.1"
            placeholderTextColor={c.tertiaryLabel}
            style={[t.subhead, styles.input, { backgroundColor: c.fill, color: c.label }]}
            value={userAgent}
          />
        </View>
      ) : null}

      <View style={styles.field}>
        <View style={styles.credentialLabelRow}>
          <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>{credentialLabel}</Text>
          {config.credentialConfigured ? (
            <View style={styles.credentialState}>
              <KeyRound color={c.green} size={13} />
              <Text style={[t.caption, { color: c.green, fontWeight: '700' }]}>
                {config.credentialHint ?? '已配置'}
              </Text>
            </View>
          ) : null}
        </View>
        <TextInput
          accessibilityLabel={`${config.name} ${credentialLabel}`}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy && !clearCredential}
          onChangeText={setCredential}
          placeholder={config.credentialConfigured ? '已配置' : credentialLabel}
          placeholderTextColor={c.tertiaryLabel}
          secureTextEntry
          style={[
            t.subhead,
            styles.input,
            { backgroundColor: c.fill, color: c.label },
            clearCredential && { opacity: 0.45 },
          ]}
          value={credential}
        />
      </View>

      {config.credentialConfigured ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: clearCredential }}
          disabled={busy}
          onPress={() => {
            setClearCredential((value) => !value);
            setCredential('');
          }}
          style={styles.clearRow}
        >
          <View
            style={[
              styles.checkbox,
              {
                backgroundColor: clearCredential ? c.red : c.card,
                borderColor: clearCredential ? c.red : c.fillStrong,
              },
            ]}
          >
            {clearCredential ? <CheckCircle2 color="#FFFFFF" size={14} /> : null}
          </View>
          <Text style={[t.footnote, { color: clearCredential ? c.red : c.secondaryLabel }]}>清除现有凭据</Text>
        </Pressable>
      ) : null}

      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[
            t.footnote,
            styles.message,
            { color: message.startsWith('已') ? c.green : c.red },
          ]}
        >
          {message}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <PrimaryButton
          disabled={busy}
          icon={<Save color="#FFFFFF" size={17} />}
          loading={update.isPending && update.variables?.provider === config.provider}
          onPress={save}
          style={styles.saveButton}
          title={`保存 ${config.name}`}
        />
        {config.mode === 'household' ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={restore}
            style={({ pressed }) => [
              styles.resetButton,
              { backgroundColor: pressed ? c.fill : c.card, borderColor: c.separator },
              busy && { opacity: 0.45 },
            ]}
          >
            <RotateCcw color={c.secondaryLabel} size={16} />
            <Text style={[t.footnote, { color: c.secondaryLabel, fontWeight: '700' }]}>恢复默认</Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

export default function MediaSettingsScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const { member } = useSession();
  const canManage = member?.role === 'owner' || member?.role === 'admin';
  const { data: configs, error, isLoading } = useMediaSourceConfigs(canManage);

  if (member && !canManage) return <Redirect href="/media" />;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <PageContainer maxWidth={1080} style={[styles.page, desktop && styles.pageDesktop]}>
          <ModuleBackButton href="/media" label="家庭观影" />
          <View style={styles.pageHeader}>
            <View style={[styles.pageIcon, { backgroundColor: c.tintSoft }]}>
              <ServerCog color={c.tint} size={22} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                accessibilityRole="header"
                style={[desktop ? t.largeTitle : t.title1, { color: c.label }]}
              >
                数据源设置
              </Text>
              <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>豆瓣 · TMDB · Bangumi</Text>
            </View>
          </View>

          {isLoading ? <ActivityIndicator color={c.tint} style={styles.loader} /> : null}
          {error ? (
            <Card>
              <EmptyState emoji="!" hint={error.message} title="数据源加载失败" />
            </Card>
          ) : null}
          {configs?.length ? (
            <View style={[styles.grid, desktop && styles.gridDesktop]}>
              {configs.map((config) => (
                <View key={config.provider} style={desktop ? styles.gridCellDesktop : undefined}>
                  <SourceEditor config={config} />
                </View>
              ))}
            </View>
          ) : null}
        </PageContainer>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  page: { paddingTop: 10, paddingBottom: 42 },
  pageDesktop: { paddingTop: 30 },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 18,
  },
  pageIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loader: { marginTop: 48 },
  grid: { gap: 14, marginTop: 24 },
  gridDesktop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
  gridCellDesktop: { width: '48%', flexGrow: 1, minWidth: 360 },
  sourceCard: { padding: 16, gap: 16 },
  sourceHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  sourceIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadge: { borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 5 },
  toggleRow: {
    minHeight: 50,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  field: { gap: 7 },
  fieldLabel: { fontWeight: '700' },
  input: { minHeight: 44, borderRadius: radius.sm, paddingHorizontal: 12 },
  credentialLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  credentialState: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  clearRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: { fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  saveButton: { minWidth: 126, flexGrow: 1 },
  resetButton: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
});
