import * as Haptics from 'expo-haptics';
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { radius, type as t, useTheme } from '../lib/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// 按压缩放反馈（apple-design：可按元素要有即时物理反馈）
export function PressableScale({
  children,
  onPress,
  style,
  haptic = true,
  disabled,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  haptic?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return (
    <AnimatedPressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPressIn={() => {
        scale.value = withSpring(0.97, { damping: 20, stiffness: 400 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 20, stiffness: 400 });
      }}
      onPress={() => {
        if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.();
      }}
      style={[animatedStyle, style]}
    >
      {children}
    </AnimatedPressable>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: c.card,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: c.separator,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  const c = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[t.footnote, { color: c.secondaryLabel, textTransform: 'uppercase' }]}>
        {title}
      </Text>
      {right}
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const c = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: c.fill }]}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.segment,
              active && {
                backgroundColor: c.card,
                borderColor: c.separator,
                ...styles.segmentActive,
              },
            ]}
            onPress={() => {
              if (!active) {
                void Haptics.selectionAsync();
                onChange(opt.value);
              }
            }}
          >
            <Text
              style={[
                t.subhead,
                { color: c.label, fontWeight: active ? '600' : '400' },
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function PrimaryButton({
  title,
  onPress,
  loading,
  disabled,
  destructive,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  const bg = destructive ? c.red : c.tint;
  return (
    <PressableScale
      disabled={disabled || loading}
      onPress={onPress}
      style={[
        styles.primaryButton,
        { backgroundColor: bg, opacity: disabled ? 0.4 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#FFF" />
      ) : (
        <View style={styles.buttonContent}>
          {icon}
          <Text style={[t.headline, { color: '#FFF' }]}>{title}</Text>
        </View>
      )}
    </PressableScale>
  );
}

export function EmptyState({ emoji, title, hint }: { emoji: string; title: string; hint?: string }) {
  const c = useTheme();
  return (
    <View style={styles.empty}>
      <Text style={{ fontSize: 56 }}>{emoji}</Text>
      <Text style={[t.headline, { color: c.label, marginTop: 12 }]}>{title}</Text>
      {hint ? (
        <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 4, textAlign: 'center' }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = '确认',
  loading,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const c = useTheme();
  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible={visible}
    >
      <View style={styles.dialogOverlay}>
        <Pressable
          accessibilityLabel="关闭确认窗口"
          accessibilityRole="button"
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.dialog,
            { backgroundColor: c.card, borderColor: c.separator },
          ]}
        >
          <Text style={[t.title2, { color: c.label }]}>{title}</Text>
          <Text style={[t.subhead, styles.dialogMessage, { color: c.secondaryLabel }]}>
            {message}
          </Text>
          <View style={styles.dialogActions}>
            <Pressable
              accessibilityRole="button"
              disabled={loading}
              onPress={onCancel}
              style={[styles.dialogButton, { backgroundColor: c.fill }]}
            >
              <Text style={[t.headline, { color: c.label }]}>取消</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={loading}
              onPress={onConfirm}
              style={[styles.dialogButton, { backgroundColor: c.red }]}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={[t.headline, { color: '#FFFFFF' }]}>{confirmLabel}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    marginBottom: 8,
    marginTop: 20,
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: 9,
    padding: 2,
  },
  segment: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segmentActive: {
  },
  primaryButton: {
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  empty: {
    alignItems: 'center',
    paddingVertical: 64,
    paddingHorizontal: 32,
  },
  dialogOverlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 25, 20, 0.38)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 20,
  },
  dialogMessage: { marginTop: 8, lineHeight: 22 },
  dialogActions: { flexDirection: 'row', gap: 10, marginTop: 22 },
  dialogButton: {
    flex: 1,
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
