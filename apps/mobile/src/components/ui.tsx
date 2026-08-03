import * as Haptics from 'expo-haptics';
import { type LucideIcon } from 'lucide-react-native';
import React from 'react';
import {
  type AccessibilityRole,
  type AccessibilityState,
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { radius, type as t, useTheme } from '../lib/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const NATIVE_DIALOG_SHADOW: ViewStyle = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 14 },
  shadowOpacity: 0.22,
  shadowRadius: 30,
  elevation: 16,
};

export function PressableScale({
  children,
  onPress,
  style,
  haptic = false,
  disabled,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityState,
  testID,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  haptic?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  testID?: string;
}) {
  const c = useTheme();
  const reduceMotion = useReducedMotion();
  const [focused, setFocused] = React.useState(false);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  return (
    <AnimatedPressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
      disabled={disabled}
      hitSlop={6}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPressIn={() => {
        opacity.value = withTiming(0.8, { duration: 80 });
        scale.value = reduceMotion
          ? 1
          : withSpring(0.975, { damping: 25, mass: 0.7, stiffness: 440 });
      }}
      onPressOut={() => {
        opacity.value = withTiming(1, { duration: 110 });
        scale.value = reduceMotion
          ? 1
          : withSpring(1, { damping: 25, mass: 0.7, stiffness: 440 });
      }}
      onPress={() => {
        if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.();
      }}
      style={[
        style,
        Platform.OS === 'web' && styles.webInteractive,
        Platform.OS === 'web' && focused && {
          outlineColor: c.tint,
          outlineOffset: 2,
          outlineStyle: 'solid',
          outlineWidth: 2,
        },
        animatedStyle,
        disabled && styles.disabledInteractive,
      ]}
      testID={testID}
    >
      {children}
    </AnimatedPressable>
  );
}

export function PressSurface({
  ariaExpanded,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityState,
  children,
  disabled,
  hitSlop = 6,
  onPress,
  pressedColor,
  style,
  testID,
}: {
  ariaExpanded?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  children: React.ReactNode;
  disabled?: boolean;
  hitSlop?: number;
  onPress?: () => void;
  pressedColor?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const c = useTheme();
  const [focused, setFocused] = React.useState(false);
  return (
    <Pressable
      aria-expanded={ariaExpanded}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
      disabled={disabled}
      hitSlop={hitSlop}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pressSurface,
        style,
        pressed && { backgroundColor: pressedColor ?? c.fill },
        Platform.OS === 'web' && styles.webInteractive,
        Platform.OS === 'web' && focused && {
          outlineColor: c.tint,
          outlineOffset: 2,
          outlineStyle: 'solid',
          outlineWidth: 2,
        },
        disabled && styles.disabledInteractive,
      ]}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}

export function IconButton({
  accessibilityLabel,
  backgroundColor,
  color,
  disabled,
  haptic = false,
  icon: Icon,
  onPress,
  selected,
  size = 20,
  style,
  testID,
}: {
  accessibilityLabel: string;
  backgroundColor?: string;
  color?: string;
  disabled?: boolean;
  haptic?: boolean;
  icon: LucideIcon;
  onPress: () => void;
  selected?: boolean;
  size?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const c = useTheme();
  return (
    <PressableScale
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      haptic={haptic}
      onPress={onPress}
      style={[
        styles.iconButton,
        { backgroundColor: backgroundColor ?? c.fill },
        style,
      ]}
      testID={testID}
    >
      <Icon color={color ?? c.secondaryLabel} size={size} />
    </PressableScale>
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
  haptic = false,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
  haptic?: boolean;
}) {
  const c = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: c.fill }]}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <PressSurface
            key={opt.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            hitSlop={0}
            style={[
              styles.segment,
              active && {
                backgroundColor: c.card,
                borderColor: c.separator,
              },
            ]}
            onPress={() => {
              if (!active) {
                if (haptic) void Haptics.selectionAsync();
                onChange(opt.value);
              }
            }}
            pressedColor={c.cardPressed}
          >
            <Text
              style={[
                t.subhead,
                { color: c.label, fontWeight: active ? '600' : '400' },
              ]}
            >
              {opt.label}
            </Text>
          </PressSurface>
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

export function EmptyState({
  emoji,
  hint,
  icon: Icon,
  iconBackground,
  iconColor,
  title,
}: {
  emoji?: string;
  hint?: string;
  icon?: LucideIcon;
  iconBackground?: string;
  iconColor?: string;
  title: string;
}) {
  const c = useTheme();
  return (
    <View style={styles.empty}>
      {Icon ? (
        <View style={[styles.emptyIcon, { backgroundColor: iconBackground ?? c.fill }]}>
          <Icon color={iconColor ?? c.secondaryLabel} size={28} strokeWidth={1.8} />
        </View>
      ) : emoji ? (
        <Text style={styles.emptyEmoji}>{emoji}</Text>
      ) : null}
      <Text style={[t.headline, { color: c.label, marginTop: 12 }]}>{title}</Text>
      {hint ? (
        <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 4, textAlign: 'center' }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function Skeleton({
  height,
  style,
  width = '100%',
}: {
  height: number;
  style?: StyleProp<ViewStyle>;
  width?: ViewStyle['width'];
}) {
  const c = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.skeleton, { backgroundColor: c.fillStrong, height, width }, style]}
    />
  );
}

export function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <View accessibilityLabel="正在加载" accessibilityRole="progressbar">
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.skeletonRow}>
          <Skeleton height={38} style={styles.skeletonIcon} width={38} />
          <View style={styles.skeletonText}>
            <Skeleton height={14} width={index % 2 ? '42%' : '34%'} />
            <Skeleton height={11} width={index % 2 ? '68%' : '58%'} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function AdaptiveDialog({
  accessibilityLabel,
  children,
  maxWidth = 560,
  onClose,
  style,
  testID,
  visible,
}: {
  accessibilityLabel: string;
  children: React.ReactNode;
  maxWidth?: number;
  onClose: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  visible: boolean;
}) {
  const c = useTheme();
  const reduceMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  const compact = width < 700;
  const materialStyle = Platform.OS === 'web'
    ? ({ backdropFilter: 'blur(24px) saturate(155%)' } as ViewStyle)
    : undefined;
  const shadowStyle = Platform.OS === 'web'
    ? ({ boxShadow: '0 16px 44px rgba(0, 0, 0, 0.22)' } as ViewStyle)
    : NATIVE_DIALOG_SHADOW;

  return (
    <Modal
      animationType={reduceMotion ? 'fade' : compact ? 'slide' : 'fade'}
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View
        style={[
          styles.adaptiveOverlay,
          compact ? styles.adaptiveOverlayCompact : styles.adaptiveOverlayWide,
          { backgroundColor: c.scrim },
        ]}
      >
        <Pressable
          accessibilityLabel={`关闭${accessibilityLabel}`}
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityLabel={accessibilityLabel}
          accessibilityViewIsModal
          style={[
            styles.adaptiveDialog,
            compact && styles.adaptiveDialogCompact,
            {
              backgroundColor: c.chromeStrong,
              borderColor: c.separator,
              maxWidth,
            },
            materialStyle,
            shadowStyle,
            style,
          ]}
          testID={testID}
        >
          {compact ? (
            <View style={[styles.sheetHandle, { backgroundColor: c.tertiaryLabel }]} />
          ) : null}
          {children}
        </View>
      </View>
    </Modal>
  );
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = '确认',
  loading,
  destructive = true,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  loading?: boolean;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const c = useTheme();
  return (
    <AdaptiveDialog
      accessibilityLabel={title}
      maxWidth={420}
      onClose={onCancel}
      visible={visible}
    >
      <View style={styles.confirmContent}>
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
            style={[
              styles.dialogButton,
              { backgroundColor: destructive ? c.red : c.tint },
            ]}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={[t.headline, { color: '#FFFFFF' }]}>{confirmLabel}</Text>
            )}
          </Pressable>
        </View>
      </View>
    </AdaptiveDialog>
  );
}

const styles = StyleSheet.create({
  webInteractive: { cursor: 'pointer' },
  disabledInteractive: { cursor: 'auto' as const, opacity: 0.48 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    marginBottom: 8,
    marginTop: 20,
  },
  pressSurface: { minHeight: 44 },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: 9,
    padding: 2,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'transparent',
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
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyEmoji: { fontSize: 56 },
  skeleton: { borderRadius: radius.sm, opacity: 0.72 },
  skeletonRow: {
    minHeight: 70,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  skeletonIcon: { borderRadius: radius.sm },
  skeletonText: { flex: 1, gap: 8 },
  adaptiveOverlay: {
    flex: 1,
  },
  adaptiveOverlayWide: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  adaptiveOverlayCompact: {
    alignItems: 'stretch',
    justifyContent: 'flex-end',
  },
  adaptiveDialog: {
    width: '100%',
    borderRadius: radius.md,
    borderWidth: 1,
    maxHeight: '92%',
    overflow: 'hidden',
  },
  adaptiveDialogCompact: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
    maxHeight: '94%',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.55,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 2,
  },
  confirmContent: { padding: 20 },
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
