import { Image } from 'expo-image';
import { Film, X, type LucideIcon } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { radius, type as t, useTheme } from '../lib/theme';
import type { MediaType } from '../lib/types';

export interface MediaDetailAction {
  label: string;
  accessibilityLabel?: string;
  icon: LucideIcon;
  onPress: () => void;
  disabled?: boolean;
  role?: 'button' | 'link';
  tone?: 'primary' | 'success' | 'accent' | 'neutral';
}

interface MediaDetailFact {
  label: string;
  value: string;
}

interface MediaDetailReference {
  label: string;
  value: string;
}

export function MediaDetailDialog({
  actions = [],
  badge,
  dialogTitle,
  facts = [],
  mediaType,
  note,
  onClose,
  originalTitle,
  overview,
  posterUrl,
  references = [],
  title,
  visible,
  year,
}: {
  actions?: MediaDetailAction[];
  badge?: { label: string; color: string; backgroundColor: string };
  dialogTitle: string;
  facts?: MediaDetailFact[];
  mediaType: MediaType;
  note?: string | null;
  onClose: () => void;
  originalTitle?: string | null;
  overview?: string | null;
  posterUrl?: string | null;
  references?: MediaDetailReference[];
  title: string;
  visible: boolean;
  year?: number | null;
}) {
  const c = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < 700;
  const [posterFailed, setPosterFailed] = useState(false);

  useEffect(() => setPosterFailed(false), [posterUrl]);

  const actionColors = (tone: MediaDetailAction['tone']) => {
    if (tone === 'success') return { background: c.green, foreground: '#FFFFFF' };
    if (tone === 'accent') return { background: c.accent, foreground: '#FFFFFF' };
    if (tone === 'neutral') return { background: c.fill, foreground: c.label };
    return { background: c.tint, foreground: '#FFFFFF' };
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="关闭影视详情"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.dialog,
            { backgroundColor: c.card, borderColor: c.separator },
          ]}
          testID="media-detail-dialog"
        >
          <View style={[styles.header, { borderBottomColor: c.separator }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.caption, { color: c.secondaryLabel }]}>影视资料</Text>
              <Text accessibilityRole="header" style={[t.title2, { color: c.label, marginTop: 2 }]}>
                {dialogTitle}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="关闭"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                { backgroundColor: pressed ? c.fillStrong : c.fill },
              ]}
            >
              <X color={c.secondaryLabel} size={20} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.hero}>
              {posterUrl && !posterFailed ? (
                <Image
                  accessibilityLabel={`${title}海报`}
                  contentFit="cover"
                  onError={() => setPosterFailed(true)}
                  source={{ uri: posterUrl }}
                  style={[styles.poster, compact && styles.posterCompact]}
                  transition={140}
                />
              ) : (
                <View
                  style={[
                    styles.poster,
                    styles.posterFallback,
                    compact && styles.posterCompact,
                    { backgroundColor: c.fill },
                  ]}
                >
                  <Film color={c.tertiaryLabel} size={compact ? 30 : 38} />
                  <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 8 }]}>暂无海报</Text>
                </View>
              )}

              <View style={styles.heroContent}>
                <Text style={[compact ? t.title2 : t.title1, { color: c.label }]}>{title}</Text>
                {originalTitle && originalTitle !== title ? (
                  <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 5 }]}>
                    {originalTitle}
                  </Text>
                ) : null}
                <View style={styles.badges}>
                  <View style={[styles.typeBadge, { backgroundColor: c.fill }]}>
                    <Text style={[t.caption, { color: c.secondaryLabel, fontWeight: '700' }]}>
                      {mediaType === 'movie' ? '电影' : '剧集'}
                      {year ? ` · ${year}` : ''}
                    </Text>
                  </View>
                  {badge ? (
                    <View style={[styles.typeBadge, { backgroundColor: badge.backgroundColor }]}>
                      <Text style={[t.caption, { color: badge.color, fontWeight: '700' }]}>
                        {badge.label}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[t.footnote, styles.overview, { color: c.secondaryLabel }]}>
                  {overview?.trim() || '暂无剧情简介'}
                </Text>
              </View>
            </View>

            {facts.length ? (
              <View style={[styles.section, { borderTopColor: c.separator }]}>
                <Text style={[t.caption, styles.sectionTitle, { color: c.tertiaryLabel }]}>详细信息</Text>
                <View style={styles.factGrid}>
                  {facts.map((fact) => (
                    <View
                      key={`${fact.label}:${fact.value}`}
                      style={[styles.fact, { width: compact ? '100%' : '48%' }]}
                    >
                      <Text style={[t.caption, { color: c.tertiaryLabel }]}>{fact.label}</Text>
                      <Text selectable style={[t.subhead, { color: c.label, marginTop: 3 }]}>
                        {fact.value}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {note ? (
              <View style={[styles.section, { borderTopColor: c.separator }]}>
                <Text style={[t.caption, styles.sectionTitle, { color: c.tertiaryLabel }]}>家庭备注</Text>
                <Text selectable style={[t.subhead, styles.note, { color: c.label, backgroundColor: c.fill }]}>
                  {note}
                </Text>
              </View>
            ) : null}

            {references.length ? (
              <View style={[styles.section, { borderTopColor: c.separator }]}>
                <Text style={[t.caption, styles.sectionTitle, { color: c.tertiaryLabel }]}>外部编号</Text>
                <View style={styles.references}>
                  {references.map((reference) => (
                    <View
                      key={`${reference.label}:${reference.value}`}
                      style={[styles.reference, { backgroundColor: c.fill }]}
                    >
                      <Text style={[t.caption, { color: c.secondaryLabel, fontWeight: '700' }]}>
                        {reference.label}
                      </Text>
                      <Text selectable style={[t.caption, { color: c.label }]}>
                        {reference.value}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </ScrollView>

          {actions.length ? (
            <View style={[styles.actions, { borderTopColor: c.separator }]}>
              {actions.map((action) => {
                const colors = actionColors(action.tone);
                const Icon = action.icon;
                return (
                  <Pressable
                    accessibilityLabel={action.accessibilityLabel ?? action.label}
                    accessibilityRole={action.role ?? 'button'}
                    disabled={action.disabled}
                    key={action.accessibilityLabel ?? action.label}
                    onPress={action.onPress}
                    style={({ pressed }) => [
                      styles.action,
                      {
                        backgroundColor: colors.background,
                        opacity: action.disabled ? 0.42 : pressed ? 0.78 : 1,
                      },
                    ]}
                  >
                    <Icon color={colors.foreground} size={17} />
                    <Text
                      numberOfLines={1}
                      style={[t.footnote, { color: colors.foreground, fontWeight: '700' }]}
                    >
                      {action.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 25, 20, 0.46)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  dialog: {
    width: '100%',
    maxWidth: 720,
    maxHeight: '92%',
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  header: {
    minHeight: 70,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { padding: 18, paddingBottom: 22 },
  hero: { flexDirection: 'row', alignItems: 'flex-start', gap: 18 },
  poster: { width: 170, height: 255, borderRadius: radius.sm },
  posterCompact: { width: 116, height: 174 },
  posterFallback: { alignItems: 'center', justifyContent: 'center' },
  heroContent: { flex: 1, minWidth: 0 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 12 },
  typeBadge: {
    minHeight: 27,
    borderRadius: radius.sm,
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overview: { lineHeight: 19, marginTop: 14 },
  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 20,
    paddingTop: 17,
  },
  sectionTitle: { fontWeight: '700' },
  factGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 11 },
  fact: { minWidth: 0 },
  note: { borderRadius: radius.sm, lineHeight: 20, marginTop: 10, padding: 12 },
  references: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  reference: {
    minHeight: 31,
    borderRadius: radius.sm,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actions: {
    minHeight: 68,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  action: {
    flexGrow: 1,
    minWidth: 130,
    minHeight: 44,
    borderRadius: radius.sm,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
});
