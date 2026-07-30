import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Cable,
  CheckCircle2,
  Copy,
  KeyRound,
  Link2,
  RefreshCw,
  RotateCcw,
  Save,
  ServerCog,
} from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  useMediaConnectorSettings,
  useResetMediaConnectorSettings,
  useResetMediaSourceConfig,
  useRotateMoviePilotWebhook,
  useTestMediaConnectorSettings,
  useUpdateMediaConnectorSettings,
  useUpdateMediaSourceConfig,
} from '../../../lib/queries';
import { BASE_URL } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { radius, type as t, useTheme } from '../../../lib/theme';
import type {
  MediaConnectorSettings,
  MediaSourceConfig,
} from '../../../lib/types';

type SettingsSection = 'services' | 'sources';

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

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

function ConnectorEditor({ config }: { config: MediaConnectorSettings }) {
  const c = useTheme();
  const update = useUpdateMediaConnectorSettings();
  const reset = useResetMediaConnectorSettings();
  const test = useTestMediaConnectorSettings();
  const rotateWebhook = useRotateMoviePilotWebhook();
  const [name, setName] = useState(config.name);
  const [isEnabled, setIsEnabled] = useState(config.isEnabled);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl ?? '');
  const [credential, setCredential] = useState('');
  const [clearCredential, setClearCredential] = useState(false);
  const [isPrimary, setIsPrimary] = useState(config.isPrimary);
  const [webhookSourceIp, setWebhookSourceIp] = useState(
    config.webhookSourceIp ?? '',
  );
  const [callbackUrl, setCallbackUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const busy =
    (update.isPending && update.variables?.kind === config.kind) ||
    (reset.isPending && reset.variables === config.kind) ||
    (test.isPending && test.variables === config.kind) ||
    (config.kind === 'moviepilot' && rotateWebhook.isPending);

  useEffect(() => {
    setName(config.name);
    setIsEnabled(config.isEnabled);
    setBaseUrl(config.baseUrl ?? '');
    setCredential('');
    setClearCredential(false);
    setIsPrimary(config.isPrimary);
    setWebhookSourceIp(config.webhookSourceIp ?? '');
  }, [
    config.baseUrl,
    config.credentialConfigured,
    config.isEnabled,
    config.isPrimary,
    config.kind,
    config.mode,
    config.name,
    config.webhookSourceIp,
  ]);

  const save = async (testAfterSave = false) => {
    setMessage(null);
    try {
      await update.mutateAsync({
        kind: config.kind,
        name: name.trim(),
        isEnabled,
        baseUrl: baseUrl.trim() || null,
        ...(credential.trim() ? { credential: credential.trim() } : {}),
        ...(clearCredential ? { clearCredential: true } : {}),
        ...(config.role === 'library' ? { isPrimary } : {}),
      });
      setCredential('');
      setClearCredential(false);
      if (testAfterSave) {
        const status = await test.mutateAsync(config.kind);
        setMessage(
          status.available
            ? `连接成功 · ${status.message}`
            : `连接失败 · ${status.message}`,
        );
        if (!status.available) return;
      } else {
        setMessage('已保存');
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    }
  };

  const restore = async () => {
    setMessage(null);
    try {
      const settings = await reset.mutateAsync(config.kind);
      const restored = settings.find((item) => item.kind === config.kind);
      setCallbackUrl(null);
      setWebhookSourceIp(restored?.webhookSourceIp ?? '');
      setMessage('已恢复服务器默认设置');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '恢复失败');
    }
  };

  const rotateMoviePilotWebhook = async () => {
    setMessage(null);
    try {
      const result = await rotateWebhook.mutateAsync(webhookSourceIp);
      setWebhookSourceIp(result.sourceIp);
      setCallbackUrl(`${BASE_URL}${result.callbackPath}`);
      setMessage(config.webhookConfigured ? '已重新生成回调地址' : '已生成回调地址');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '生成回调地址失败');
    }
  };

  const confirmWebhookRotation = () => {
    if (!config.webhookConfigured) {
      void rotateMoviePilotWebhook();
      return;
    }
    Alert.alert('重新生成回调地址', '现有回调地址将立即失效。', [
      { text: '取消', style: 'cancel' },
      {
        text: '重新生成',
        style: 'destructive',
        onPress: () => void rotateMoviePilotWebhook(),
      },
    ]);
  };

  const copyCallbackUrl = async () => {
    if (!callbackUrl) return;
    await Clipboard.setStringAsync(callbackUrl);
    setMessage('已复制回调地址');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const status = !isEnabled
    ? { label: '已停用', color: c.secondaryLabel, background: c.fill }
    : config.configured
      ? { label: '已配置', color: c.green, background: c.greenSoft }
      : { label: '待配置', color: c.orange, background: c.orangeSoft };
  const credentialLabel = config.kind === 'plex' ? 'Token' : 'API Key';
  const messageSucceeded =
    message?.startsWith('已') || message?.startsWith('连接成功');

  return (
    <Card style={styles.sourceCard}>
      <View style={styles.sourceHeader}>
        <View style={[styles.sourceIcon, { backgroundColor: c.fill }]}>
          <Cable color={c.tint} size={20} />
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
        <Text style={[t.subhead, { color: c.label, fontWeight: '600' }]}>启用服务</Text>
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
        <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>服务名称</Text>
        <TextInput
          accessibilityLabel={`${config.name} 服务名称`}
          editable={!busy}
          onChangeText={setName}
          placeholder={config.name}
          placeholderTextColor={c.tertiaryLabel}
          style={[t.subhead, styles.input, { backgroundColor: c.fill, color: c.label }]}
          value={name}
        />
      </View>

      <View style={styles.field}>
        <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>服务地址</Text>
        <TextInput
          accessibilityLabel={`${config.name} 服务地址`}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          onChangeText={setBaseUrl}
          placeholder="http://192.168.1.10:端口"
          placeholderTextColor={c.tertiaryLabel}
          style={[t.subhead, styles.input, { backgroundColor: c.fill, color: c.label }]}
          value={baseUrl}
        />
      </View>

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

      {config.role === 'library' ? (
        <View style={[styles.toggleRow, { borderColor: c.separator }]}>
          <Text style={[t.subhead, { color: c.label, fontWeight: '600' }]}>主媒体库</Text>
          <Switch
            accessibilityLabel={`将${config.name}设为主媒体库`}
            disabled={busy || !isEnabled}
            onValueChange={setIsPrimary}
            trackColor={{ false: c.fillStrong, true: c.greenSoft }}
            thumbColor={isPrimary ? c.green : c.tertiaryLabel}
            value={isPrimary}
          />
        </View>
      ) : null}

      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[
            t.footnote,
            styles.message,
            { color: messageSucceeded ? c.green : c.red },
          ]}
        >
          {message}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <PrimaryButton
          disabled={busy}
          icon={<Save color="#FFFFFF" size={17} />}
          loading={update.isPending && update.variables?.kind === config.kind}
          onPress={() => save(false)}
          style={styles.saveButton}
          title={`保存 ${config.name}`}
        />
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => save(true)}
          style={({ pressed }) => [
            styles.testButton,
            { backgroundColor: pressed ? c.fill : c.card, borderColor: c.tint },
            busy && { opacity: 0.45 },
          ]}
        >
          <RefreshCw color={c.tint} size={16} />
          <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>保存并测试</Text>
        </Pressable>
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

      {config.kind === 'moviepilot' ? (
        <View style={[styles.webhookSection, { borderColor: c.separator }]}>
          <View style={styles.webhookHeader}>
            <View style={[styles.webhookIcon, { backgroundColor: c.tintSoft }]}>
              <Link2 color={c.tint} size={17} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]}>完成通知回调</Text>
              <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>
                {config.webhookConfigured ? '已启用' : '未生成'}
              </Text>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>允许来源 IP</Text>
            <TextInput
              accessibilityLabel="MoviePilot 回调允许来源 IP"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              onChangeText={setWebhookSourceIp}
              placeholder="192.168.1.10"
              placeholderTextColor={c.tertiaryLabel}
              style={[t.subhead, styles.input, { backgroundColor: c.fill, color: c.label }]}
              value={webhookSourceIp}
            />
          </View>

          {callbackUrl ? (
            <View style={styles.field}>
              <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>MoviePilot 回调地址</Text>
              <TextInput
                accessibilityLabel="MoviePilot 回调地址"
                editable={false}
                multiline
                selectTextOnFocus
                style={[
                  t.caption,
                  styles.callbackInput,
                  { backgroundColor: c.fill, color: c.label },
                ]}
                value={callbackUrl}
              />
            </View>
          ) : config.webhookConfigured ? (
            <Text style={[t.caption, { color: c.secondaryLabel }]}>回调地址已隐藏，重新生成后显示一次</Text>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={confirmWebhookRotation}
              style={({ pressed }) => [
                styles.testButton,
                { backgroundColor: pressed ? c.fill : c.card, borderColor: c.tint },
                busy && { opacity: 0.45 },
              ]}
            >
              <Link2 color={c.tint} size={16} />
              <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>
                {config.webhookConfigured ? '重新生成' : '生成回调地址'}
              </Text>
            </Pressable>
            {callbackUrl ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void copyCallbackUrl()}
                style={({ pressed }) => [
                  styles.resetButton,
                  { backgroundColor: pressed ? c.fill : c.card, borderColor: c.separator },
                ]}
              >
                <Copy color={c.secondaryLabel} size={16} />
                <Text style={[t.footnote, { color: c.secondaryLabel, fontWeight: '700' }]}>复制地址</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </Card>
  );
}

export default function MediaSettingsScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string }>();
  const parameterSection = firstParam(params.section);
  const [section, setSection] = useState<SettingsSection>(
    parameterSection === 'sources' ? 'sources' : 'services',
  );
  const { member } = useSession();
  const canManage = member?.role === 'owner' || member?.role === 'admin';
  const sourceQuery = useMediaSourceConfigs(canManage && section === 'sources');
  const connectorQuery = useMediaConnectorSettings(
    canManage && section === 'services',
  );

  useEffect(() => {
    if (parameterSection === 'sources' || parameterSection === 'services') {
      setSection(parameterSection);
    }
  }, [parameterSection]);

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
                观影设置
              </Text>
              <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>媒体服务 · 搜索数据源</Text>
            </View>
          </View>

          <View style={styles.sectionSwitcher}>
            <Segmented<SettingsSection>
              onChange={(value) => {
                setSection(value);
                router.setParams({ section: value });
              }}
              options={[
                { label: '媒体服务', value: 'services' },
                { label: '搜索数据源', value: 'sources' },
              ]}
              value={section}
            />
          </View>

          {(section === 'services' ? connectorQuery.isLoading : sourceQuery.isLoading) ? (
            <ActivityIndicator color={c.tint} style={styles.loader} />
          ) : null}
          {(section === 'services' ? connectorQuery.error : sourceQuery.error) ? (
            <Card>
              <EmptyState
                emoji="!"
                hint={(section === 'services' ? connectorQuery.error : sourceQuery.error)?.message}
                title="设置加载失败"
              />
            </Card>
          ) : null}
          {section === 'services' && connectorQuery.data?.length ? (
            <View style={[styles.grid, desktop && styles.gridDesktop]}>
              {connectorQuery.data.map((config) => (
                <View key={config.kind} style={desktop ? styles.gridCellDesktop : undefined}>
                  <ConnectorEditor config={config} />
                </View>
              ))}
            </View>
          ) : null}
          {section === 'sources' && sourceQuery.data?.length ? (
            <View style={[styles.grid, desktop && styles.gridDesktop]}>
              {sourceQuery.data.map((config) => (
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
  sectionSwitcher: { marginTop: 22, maxWidth: 480 },
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
  testButton: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  webhookSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
    gap: 14,
  },
  webhookHeader: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  webhookIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callbackInput: {
    minHeight: 68,
    maxHeight: 100,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
});
