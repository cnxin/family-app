import { useRouter, type Href } from 'expo-router';
import {
  BellRing,
  ChevronRight,
  ListPlus,
  ListTodo,
  ShoppingCart,
  Utensils,
  Vote,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AdaptiveDialog, IconButton, PressableScale } from './ui';
import { radius, type as t, useTheme } from '../lib/theme';

interface QuickAction {
  background: string;
  color: string;
  description: string;
  href: Href;
  icon: LucideIcon;
  label: string;
  testID: string;
}

export function QuickAddDialog({
  onClose,
  visible,
}: {
  onClose: () => void;
  visible: boolean;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const actions: QuickAction[] = [
    {
      background: c.tintSoft,
      color: c.tint,
      description: '安排家务、维护或家庭分工',
      href: { pathname: '/tasks', params: { create: '1' } },
      icon: ListTodo,
      label: '家庭任务',
      testID: 'quick-add-task',
    },
    {
      background: c.greenSoft,
      color: c.green,
      description: '把临时要买的东西放进清单',
      href: { pathname: '/shopping', params: { create: '1' } },
      icon: ShoppingCart,
      label: '购物清单',
      testID: 'quick-add-shopping',
    },
    {
      background: c.blueSoft,
      color: c.blue,
      description: '为已有的家庭事项设置提醒',
      href: { pathname: '/reminders', params: { create: '1' } },
      icon: BellRing,
      label: '家庭提醒',
      testID: 'quick-add-reminder',
    },
    {
      background: c.orangeSoft,
      color: c.orange,
      description: '从家里的菜谱中选择想吃的菜',
      href: '/order',
      icon: Utensils,
      label: '点一道菜',
      testID: 'quick-add-order',
    },
    {
      background: c.accentSoft,
      color: c.accent,
      description: '把需要全家决定的事情发起投票',
      href: { pathname: '/polls', params: { create: '1' } },
      icon: Vote,
      label: '家庭投票',
      testID: 'quick-add-poll',
    },
  ];

  const open = (href: Href) => {
    onClose();
    router.push(href);
  };

  return (
    <AdaptiveDialog
      accessibilityLabel="快捷新增"
      maxWidth={500}
      onClose={onClose}
      testID="quick-add-dialog"
      visible={visible}
    >
      <View style={styles.header}>
        <View style={[styles.headerIcon, { backgroundColor: c.tintSoft }]}>
          <ListPlus color={c.tint} size={21} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[t.title2, { color: c.label }]}>新增家庭事项</Text>
          <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>选择这次要记录的内容</Text>
        </View>
        <IconButton
          accessibilityLabel="关闭"
          backgroundColor="transparent"
          color={c.secondaryLabel}
          icon={X}
          onPress={onClose}
        />
      </View>
      <View style={[styles.actions, { paddingBottom: Math.max(18, insets.bottom + 8) }]}>
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <PressableScale
              accessibilityLabel={`新增${action.label}`}
              haptic
              key={action.label}
              onPress={() => open(action.href)}
              style={[styles.action, { backgroundColor: c.fill }]}
              testID={action.testID}
            >
              <View style={[styles.actionIcon, { backgroundColor: action.background }]}>
                <Icon color={action.color} size={20} />
              </View>
              <View style={styles.actionCopy}>
                <Text style={[t.headline, { color: c.label }]}>{action.label}</Text>
                <Text numberOfLines={2} style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>
                  {action.description}
                </Text>
              </View>
              <ChevronRight color={c.tertiaryLabel} size={18} />
            </PressableScale>
          );
        })}
      </View>
    </AdaptiveDialog>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11,
    paddingBottom: 14,
    paddingHorizontal: 18,
  },
  headerIcon: {
    alignItems: 'center',
    borderRadius: 21,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  actions: { gap: 9, paddingBottom: 18, paddingHorizontal: 14 },
  action: {
    alignItems: 'center',
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: 12,
    minHeight: 72,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  actionIcon: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  actionCopy: { flex: 1, minWidth: 0 },
});
