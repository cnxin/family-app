import * as Haptics from 'expo-haptics';
import { type LucideIcon } from 'lucide-react-native';
import React from 'react';
import {
  type AccessibilityRole,
  type AccessibilityState,
  ActivityIndicator,
  Modal,
  PanResponder,
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
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
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
  ariaChecked,
  ariaExpanded,
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
  ariaChecked?: boolean;
  ariaExpanded?: boolean;
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
      aria-checked={ariaChecked}
      aria-expanded={ariaExpanded}
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

export function IOSSwitch({
  accessibilityLabel,
  disabled,
  onValueChange,
  testID,
  value,
}: {
  accessibilityLabel: string;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
  testID?: string;
  value: boolean;
}) {
  const c = useTheme();
  return (
    <PressableScale
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      ariaChecked={value}
      disabled={disabled}
      haptic
      onPress={() => onValueChange(!value)}
      style={styles.switchTarget}
      testID={testID}
    >
      <View
        style={[
          styles.switchTrack,
          { backgroundColor: value ? c.green : c.fillStrong },
        ]}
      >
        <View
          style={[
            styles.switchThumb,
            value ? styles.switchThumbOn : styles.switchThumbOff,
          ]}
        />
      </View>
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
          borderWidth: 0,
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
      <Text style={[t.footnote, { color: c.secondaryLabel }]}>
        {title}
      </Text>
      {right}
    </View>
  );
}

export function Segmented<T extends string | number>({
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
            accessibilityLabel={opt.label}
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
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={[
        styles.primaryButton,
        { backgroundColor: bg, opacity: disabled ? 0.4 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={c.bg} />
      ) : (
        <View style={styles.buttonContent}>
          {icon}
          <Text style={[t.headline, { color: c.bg }]}>{title}</Text>
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
  const { height, width } = useWindowDimensions();
  const compact = width < 700;
  const translateY = useSharedValue(0);
  const dragStartY = useSharedValue(0);
  const sheetHeight = useSharedValue(Math.max(height * 0.5, 320));
  const overlayOpacity = useSharedValue(1);
  const sheetOpacity = useSharedValue(1);
  const wasVisible = React.useRef(false);
  const materialStyle = Platform.OS === 'web'
    ? ({ backdropFilter: 'blur(24px) saturate(155%)' } as ViewStyle)
    : undefined;
  const shadowStyle = Platform.OS === 'web'
    ? ({ boxShadow: '0 16px 44px rgba(0, 0, 0, 0.22)' } as ViewStyle)
    : NATIVE_DIALOG_SHADOW;

  React.useEffect(() => {
    if (!visible) {
      wasVisible.current = false;
      return;
    }

    if (wasVisible.current) {
      translateY.value = 0;
      overlayOpacity.value = 1;
      sheetOpacity.value = 1;
      return;
    }

    wasVisible.current = true;
    cancelAnimation(translateY);
    cancelAnimation(overlayOpacity);
    cancelAnimation(sheetOpacity);

    if (!compact) {
      translateY.value = 0;
      overlayOpacity.value = 1;
      sheetOpacity.value = 1;
      return;
    }

    overlayOpacity.value = 0;
    overlayOpacity.value = withTiming(1, { duration: reduceMotion ? 140 : 180 });
    if (reduceMotion) {
      translateY.value = 0;
      sheetOpacity.value = 0;
      sheetOpacity.value = withTiming(1, { duration: 140 });
      return;
    }

    sheetOpacity.value = 1;
    translateY.value = height;
    translateY.value = withSpring(0, {
      damping: 35,
      mass: 0.9,
      overshootClamping: true,
      stiffness: 320,
    });
  }, [
    compact,
    height,
    overlayOpacity,
    reduceMotion,
    sheetOpacity,
    translateY,
    visible,
  ]);

  const closeSheet = React.useCallback(() => {
    if (!compact) {
      onClose();
      return;
    }

    cancelAnimation(translateY);
    cancelAnimation(overlayOpacity);
    cancelAnimation(sheetOpacity);
    overlayOpacity.value = withTiming(0, { duration: reduceMotion ? 120 : 180 });

    if (reduceMotion) {
      sheetOpacity.value = withTiming(0, { duration: 120 }, (finished) => {
        if (finished) scheduleOnRN(onClose);
      });
      return;
    }

    const exitY = Math.max(sheetHeight.value + 40, 320);
    translateY.value = withTiming(exitY, { duration: 220 }, (finished) => {
      if (finished) scheduleOnRN(onClose);
    });
  }, [
    compact,
    onClose,
    overlayOpacity,
    reduceMotion,
    sheetHeight,
    sheetOpacity,
    translateY,
  ]);

  const resetSheetPosition = React.useCallback((velocityY = 0) => {
    overlayOpacity.value = withTiming(1, { duration: reduceMotion ? 100 : 160 });
    translateY.value = reduceMotion
      ? withTiming(0, { duration: 120 })
      : withSpring(0, {
        damping: 28,
        mass: 0.9,
        stiffness: 320,
        velocity: velocityY,
      });
  }, [overlayOpacity, reduceMotion, translateY]);

  const dismissDraggedSheet = React.useCallback(() => {
    overlayOpacity.value = withTiming(0, { duration: reduceMotion ? 120 : 180 });
    if (reduceMotion) {
      sheetOpacity.value = withTiming(0, { duration: 120 }, (finished) => {
        if (finished) scheduleOnRN(onClose);
      });
      return;
    }

    translateY.value = withTiming(
      Math.max(sheetHeight.value + 40, 320),
      { duration: 220 },
      (finished) => {
        if (finished) scheduleOnRN(onClose);
      },
    );
  }, [onClose, overlayOpacity, reduceMotion, sheetHeight, sheetOpacity, translateY]);

  const beginSheetDrag = React.useCallback(() => {
    cancelAnimation(translateY);
    cancelAnimation(overlayOpacity);
    cancelAnimation(sheetOpacity);
    dragStartY.value = translateY.value;
    overlayOpacity.value = withTiming(1, { duration: 80 });
    sheetOpacity.value = 1;
  }, [dragStartY, overlayOpacity, sheetOpacity, translateY]);

  const updateSheetDrag = React.useCallback((translationY: number) => {
    const nextY = dragStartY.value + translationY;
    if (nextY >= 0) {
      translateY.value = nextY;
    } else {
      const overshoot = -nextY;
      const dimension = Math.max(sheetHeight.value, 1);
      translateY.value = -((overshoot * dimension * 0.45)
        / (dimension + 0.45 * overshoot));
    }

    const dismissProgress = Math.min(
      Math.max(translateY.value, 0) / Math.max(sheetHeight.value, 1),
      1,
    );
    overlayOpacity.value = 1 - dismissProgress * 0.72;
  }, [dragStartY, overlayOpacity, sheetHeight, translateY]);

  const finishSheetDrag = React.useCallback((translationY: number, velocityY: number) => {
    const projectedY = Math.max(translateY.value, translationY)
      + Math.max(velocityY, 0) * 0.12;
    const dismissThreshold = Math.min(sheetHeight.value * 0.3, 140);
    if (velocityY > 900 || projectedY > dismissThreshold) {
      dismissDraggedSheet();
      return;
    }
    resetSheetPosition(velocityY);
  }, [dismissDraggedSheet, resetSheetPosition, sheetHeight, translateY]);

  const dragResponder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => compact,
    onMoveShouldSetPanResponder: (_event, gestureState) => compact
      && Math.abs(gestureState.dy) > 6
      && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
    onPanResponderGrant: beginSheetDrag,
    onPanResponderMove: (_event, gestureState) => updateSheetDrag(gestureState.dy),
    onPanResponderRelease: (_event, gestureState) =>
      finishSheetDrag(gestureState.dy, gestureState.vy * 1000),
    onPanResponderTerminate: () => resetSheetPosition(),
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  }), [
    compact,
    beginSheetDrag,
    finishSheetDrag,
    resetSheetPosition,
    updateSheetDrag,
  ]);

  const dragHandleRef = React.useRef<View>(null);
  const webDrag = React.useRef<{
    pointerId: number;
    startY: number;
    lastY: number;
    lastAt: number;
  } | null>(null);
  React.useEffect(() => {
    if (Platform.OS !== 'web' || !compact || !visible) return;
    const element = dragHandleRef.current as unknown as HTMLElement | null;
    if (!element?.addEventListener) return;

    const onPointerMove = (event: PointerEvent) => {
      const current = webDrag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.preventDefault();
      updateSheetDrag(event.clientY - current.startY);
      current.lastY = event.clientY;
      current.lastAt = event.timeStamp;
    };
    const stopTracking = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
    function onPointerUp(event: PointerEvent) {
      const current = webDrag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.preventDefault();
      const elapsed = Math.max(event.timeStamp - current.lastAt, 1);
      const velocityY = ((event.clientY - current.lastY) / elapsed) * 1000;
      finishSheetDrag(event.clientY - current.startY, velocityY);
      webDrag.current = null;
      stopTracking();
    }
    function onPointerCancel(event: PointerEvent) {
      if (webDrag.current?.pointerId !== event.pointerId) return;
      webDrag.current = null;
      stopTracking();
      resetSheetPosition();
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      webDrag.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        lastY: event.clientY,
        lastAt: event.timeStamp,
      };
      window.addEventListener('pointermove', onPointerMove, { passive: false });
      window.addEventListener('pointerup', onPointerUp, { passive: false });
      window.addEventListener('pointercancel', onPointerCancel, { passive: false });
      beginSheetDrag();
    };

    element.addEventListener('pointerdown', onPointerDown, { passive: false });
    return () => {
      element.removeEventListener('pointerdown', onPointerDown);
      stopTracking();
      webDrag.current = null;
    };
  }, [
    beginSheetDrag,
    compact,
    finishSheetDrag,
    resetSheetPosition,
    updateSheetDrag,
    visible,
  ]);

  const overlayAnimatedStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));
  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    opacity: sheetOpacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Modal
      animationType={compact ? 'none' : 'fade'}
      onRequestClose={closeSheet}
      transparent
      visible={visible}
    >
      <View
        style={[
          styles.adaptiveOverlay,
          compact ? styles.adaptiveOverlayCompact : styles.adaptiveOverlayWide,
        ]}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: c.scrim, pointerEvents: 'none' },
            overlayAnimatedStyle,
          ]}
        />
        <Pressable
          accessibilityLabel={`关闭${accessibilityLabel}`}
          accessibilityRole="button"
          onPress={closeSheet}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          accessibilityLabel={accessibilityLabel}
          accessibilityViewIsModal
          onLayout={(event) => {
            sheetHeight.value = event.nativeEvent.layout.height;
          }}
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
            sheetAnimatedStyle,
          ]}
          role="dialog"
          testID={testID}
        >
          {compact ? (
            <View
              {...(Platform.OS === 'web' ? {} : dragResponder.panHandlers)}
              accessibilityLabel={`拖动${accessibilityLabel}`}
              collapsable={false}
              ref={dragHandleRef}
              style={[
                styles.sheetDragArea,
                Platform.OS === 'web' && styles.sheetDragAreaWeb,
              ]}
              testID="adaptive-dialog-drag-handle"
            >
              <View style={[styles.sheetHandle, { backgroundColor: c.tertiaryLabel }]} />
            </View>
          ) : null}
          {children}
        </Animated.View>
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
            accessibilityLabel="取消"
            accessibilityRole="button"
            accessibilityState={{ disabled: loading }}
            disabled={loading}
            onPress={onCancel}
            style={[styles.dialogButton, { backgroundColor: c.fill }]}
          >
            <Text style={[t.headline, { color: c.label }]}>取消</Text>
          </Pressable>
          <Pressable
            accessibilityLabel={confirmLabel}
            accessibilityRole="button"
            accessibilityState={{ disabled: loading }}
            disabled={loading}
            onPress={onConfirm}
            style={[
              styles.dialogButton,
              { backgroundColor: destructive ? c.red : c.tint },
            ]}
          >
            {loading ? (
              <ActivityIndicator color={c.bg} />
            ) : (
              <Text style={[t.headline, { color: c.bg }]}>{confirmLabel}</Text>
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
  switchTarget: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 56,
  },
  switchTrack: {
    borderRadius: 16,
    height: 31,
    justifyContent: 'center',
    width: 51,
  },
  switchThumb: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    height: 27,
    position: 'absolute',
    top: 2,
    width: 27,
    ...Platform.select({
      web: { boxShadow: '0 1px 3px rgba(0, 0, 0, 0.25)' } as ViewStyle,
      default: {
        elevation: 2,
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.25,
        shadowRadius: 2,
      } as ViewStyle,
    }),
  },
  switchThumbOff: { left: 2 },
  switchThumbOn: { right: 2 },
  segmented: {
    flexDirection: 'row',
    borderRadius: 9,
    padding: 2,
  },
  segment: {
    flex: 1,
    minHeight: 46,
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
  sheetDragArea: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    minHeight: 44,
    width: '100%',
  },
  sheetDragAreaWeb: {
    cursor: 'grab' as never,
    touchAction: 'none' as never,
    userSelect: 'none' as never,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.55,
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
