import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import {
  Archive,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Edit3,
  Heart,
  ImagePlus,
  Images,
  Plane,
  RotateCcw,
  Search,
  Sparkles,
  Utensils,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageContainer, PageHeader, useLayoutMode } from '../../components/app-shell';
import { DateSelector } from '../../components/date-selector';
import {
  AdaptiveDialog,
  Card,
  ConfirmDialog,
  EmptyState,
  PrimaryButton,
  PressableScale,
  PressSurface,
  Segmented,
} from '../../components/ui';
import { parseDate, todayStr } from '../../lib/date';
import { photoUri } from '../../lib/api';
import {
  type FamilyMemoryInput,
  useArchiveMemory,
  useCreateMemory,
  useMemories,
  useRestoreMemory,
  useUpdateMemory,
  useUploadMemoryPhoto,
} from '../../lib/queries';
import { radius, type as t, useTheme } from '../../lib/theme';
import type { FamilyMemory, FamilyMemoryCategory } from '../../lib/types';

const CATEGORIES: {
  value: FamilyMemoryCategory;
  label: string;
  icon: LucideIcon;
}[] = [
  { value: 'daily', label: '日常', icon: CalendarDays },
  { value: 'celebration', label: '庆祝', icon: Sparkles },
  { value: 'travel', label: '出行', icon: Plane },
  { value: 'meal', label: '聚餐', icon: Utensils },
  { value: 'visit', label: '相聚', icon: UsersRound },
  { value: 'milestone', label: '里程碑', icon: Heart },
  { value: 'other', label: '其他', icon: Images },
];

const SOURCE_LABELS = {
  calendar: '家庭日历',
  travel: '家庭出行',
  menu: '家庭菜单',
  media: '家庭观影',
  visit: '访客来访',
};

interface Draft {
  title: string;
  happenedOn: string;
  category: FamilyMemoryCategory;
  story: string;
  tags: string;
}

type Confirmation =
  | { kind: 'archive'; memory: FamilyMemory }
  | { kind: 'restore'; memory: FamilyMemory };

function emptyDraft(): Draft {
  return {
    title: '',
    happenedOn: todayStr(),
    category: 'daily',
    story: '',
    tags: '',
  };
}

function draftFromMemory(memory: FamilyMemory): Draft {
  return {
    title: memory.title,
    happenedOn: memory.happenedOn,
    category: memory.category,
    story: memory.story ?? '',
    tags: memory.tags.join('，'),
  };
}

function draftsMatch(left: Draft, right: Draft) {
  return (
    left.title === right.title &&
    left.happenedOn === right.happenedOn &&
    left.category === right.category &&
    left.story === right.story &&
    left.tags === right.tags
  );
}

function categoryInfo(category: FamilyMemoryCategory) {
  return CATEGORIES.find((item) => item.value === category) ?? CATEGORIES[6];
}

function parseTags(value: string) {
  return value
    .split(/[，,]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function memoryDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(parseDate(value));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请稍后再试';
}

function Field({
  label,
  maxLength,
  multiline,
  onChangeText,
  placeholder,
  value,
}: {
  label: string;
  maxLength: number;
  multiline?: boolean;
  onChangeText: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  const c = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        maxLength={maxLength}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.tertiaryLabel}
        style={[
          styles.input,
          multiline && styles.multiline,
          { backgroundColor: c.fill, borderColor: c.separator, color: c.label },
        ]}
        textAlignVertical={multiline ? 'top' : 'center'}
        value={value}
      />
    </View>
  );
}

function MemoryCard({
  memory,
  onPress,
  wide,
}: {
  memory: FamilyMemory;
  onPress: () => void;
  wide: boolean;
}) {
  const c = useTheme();
  const category = categoryInfo(memory.category);
  const CategoryIcon = category.icon;
  const cover = memory.photos[0];
  return (
    <PressableScale
      accessibilityLabel={`打开回忆${memory.title}`}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.cardPressable, wide && styles.cardPressableWide]}
    >
      <Card style={styles.memoryCard}>
        {cover ? (
          <Image
            accessibilityLabel={cover.caption || memory.title}
            contentFit="cover"
            source={{ uri: photoUri(cover.contentUrl) ?? undefined }}
            style={styles.cardImage}
          />
        ) : (
          <View style={[styles.cardImagePlaceholder, { backgroundColor: c.tintSoft }]}>
            <CategoryIcon color={c.tint} size={28} strokeWidth={1.8} />
          </View>
        )}
        <View style={styles.memoryCardCopy}>
          <View style={styles.metaRow}>
            <View style={[styles.categoryBadge, { backgroundColor: c.tintSoft }]}>
              <CategoryIcon color={c.tint} size={14} />
              <Text style={[t.caption, { color: c.tint, fontWeight: '700' }]}>{category.label}</Text>
            </View>
            <Text style={[t.caption, { color: c.tertiaryLabel }]}>{memoryDate(memory.happenedOn)}</Text>
          </View>
          <Text numberOfLines={2} style={[t.headline, { color: c.label, marginTop: 10 }]}>
            {memory.title}
          </Text>
          {memory.story ? (
            <Text numberOfLines={2} style={[t.subhead, styles.cardStory, { color: c.secondaryLabel }]}>
              {memory.story}
            </Text>
          ) : null}
          <View style={styles.cardFooter}>
            <Text numberOfLines={1} style={[t.caption, { color: c.tertiaryLabel, flex: 1 }]}>
              {memory.createdBy.name}{memory.photos.length ? ` · ${memory.photos.length} 张照片` : ''}
            </Text>
            <ArrowRight color={c.tertiaryLabel} size={16} />
          </View>
        </View>
      </Card>
    </PressableScale>
  );
}

function FeaturedMemory({
  memory,
  onPress,
  wide,
}: {
  memory: FamilyMemory;
  onPress: () => void;
  wide: boolean;
}) {
  const c = useTheme();
  const category = categoryInfo(memory.category);
  const CategoryIcon = category.icon;
  const cover = memory.photos[0];

  return (
    <PressableScale
      accessibilityLabel={`打开回忆${memory.title}`}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.featuredPressable}
    >
      <Card style={[styles.featuredCard, wide && styles.featuredCardWide]}>
        {cover ? (
          <Image
            accessibilityLabel={cover.caption || memory.title}
            contentFit="cover"
            source={{ uri: photoUri(cover.contentUrl) ?? undefined }}
            style={[styles.featuredImage, wide && styles.featuredImageWide]}
            testID="memory-featured-image"
            transition={180}
          />
        ) : (
          <View
            style={[
              styles.featuredPlaceholder,
              wide && styles.featuredImageWide,
              { backgroundColor: c.tintSoft },
            ]}
          >
            <CategoryIcon color={c.tint} size={40} strokeWidth={1.6} />
          </View>
        )}
        <View style={styles.featuredCopy}>
          <View style={[styles.categoryBadge, { backgroundColor: c.tintSoft }]}>
            <CategoryIcon color={c.tint} size={14} />
            <Text style={[t.caption, { color: c.tint, fontWeight: '700' }]}>
              {category.label}
            </Text>
          </View>
          <Text numberOfLines={2} style={[t.title1, styles.featuredTitle, { color: c.label }]}>
            {memory.title}
          </Text>
          {memory.story ? (
            <Text
              numberOfLines={3}
              style={[t.body, styles.featuredStory, { color: c.secondaryLabel }]}
            >
              {memory.story}
            </Text>
          ) : null}
          <View style={styles.featuredFooter}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.footnote, { color: c.secondaryLabel }]}>
                {memoryDate(memory.happenedOn)}
              </Text>
              <Text numberOfLines={1} style={[t.caption, { color: c.tertiaryLabel, marginTop: 3 }]}>
                {memory.createdBy.name}记录{memory.photos.length ? ` · ${memory.photos.length} 张照片` : ''}
              </Text>
            </View>
            <View style={[styles.featuredOpen, { backgroundColor: c.fill }]}>
              <ArrowRight color={c.tint} size={18} />
            </View>
          </View>
        </View>
      </Card>
    </PressableScale>
  );
}

export default function MemoriesScreen() {
  const c = useTheme();
  const router = useRouter();
  const layout = useLayoutMode();
  const params = useLocalSearchParams<{ memoryId?: string }>();
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [category, setCategory] = useState<FamilyMemoryCategory | 'all'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<FamilyMemory | null>(null);
  const [editing, setEditing] = useState<FamilyMemory | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [editorOpen, setEditorOpen] = useState(false);
  const [discardEditorOpen, setDiscardEditorOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [photoCaption, setPhotoCaption] = useState('');
  const [photoAsset, setPhotoAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);

  const memoriesQuery = useMemories(status, category, search);
  const createMemory = useCreateMemory();
  const updateMemory = useUpdateMemory();
  const archiveMemory = useArchiveMemory();
  const restoreMemory = useRestoreMemory();
  const uploadPhoto = useUploadMemoryPhoto();
  const memories = useMemo(() => memoriesQuery.data ?? [], [memoriesQuery.data]);
  const showFeatured = status === 'active' && category === 'all' && !search;
  const featuredMemory = showFeatured ? memories[0] : undefined;
  const remainingMemories = featuredMemory ? memories.slice(1) : memories;
  const selectedId = selected?.id;
  const busy = createMemory.isPending || updateMemory.isPending;

  useEffect(() => {
    if (!selectedId) return;
    const refreshed = memories.find((memory) => memory.id === selectedId);
    if (refreshed) setSelected(refreshed);
  }, [memories, selectedId]);

  useEffect(() => {
    if (!params.memoryId || !memories.length) return;
    const target = memories.find((memory) => memory.id === params.memoryId);
    if (target) setSelected(target);
  }, [memories, params.memoryId]);

  const tags = useMemo(() => parseTags(draft.tags), [draft.tags]);

  const openCreate = () => {
    setEditing(null);
    setDraft(emptyDraft());
    setEditorOpen(true);
  };

  const openEdit = (memory: FamilyMemory) => {
    setEditing(memory);
    setDraft(draftFromMemory(memory));
    setEditorOpen(true);
  };

  const finishCloseEditor = () => {
    setEditorOpen(false);
    setEditing(null);
    setDiscardEditorOpen(false);
  };

  const requestCloseEditor = () => {
    if (busy) return;
    const initial = editing ? draftFromMemory(editing) : emptyDraft();
    if (draftsMatch(draft, initial)) {
      finishCloseEditor();
      return;
    }
    setDiscardEditorOpen(true);
  };

  const save = () => {
    if (!draft.title.trim()) {
      Alert.alert('无法保存', '请填写回忆标题');
      return;
    }
    const input: FamilyMemoryInput = {
      title: draft.title.trim(),
      happenedOn: draft.happenedOn,
      category: draft.category,
      story: draft.story.trim() || null,
      tags,
    };
    const callbacks = {
      onSuccess: (memory: FamilyMemory) => {
        setSelected(memory);
        finishCloseEditor();
        setFeedback(editing ? '回忆已更新' : '回忆已保存');
      },
      onError: (error: unknown) => Alert.alert('保存失败', errorMessage(error)),
    };
    if (editing) {
      updateMemory.mutate(
        { id: editing.id, expectedVersion: editing.version, ...input },
        callbacks,
      );
    } else {
      createMemory.mutate(input, callbacks);
    }
  };

  const executeConfirmation = () => {
    if (!confirmation) return;
    const mutation = confirmation.kind === 'archive' ? archiveMemory : restoreMemory;
    const label = confirmation.kind === 'archive' ? '回忆已归档' : '回忆已恢复';
    mutation.mutate(
      {
        id: confirmation.memory.id,
        expectedVersion: confirmation.memory.version,
      },
      {
        onSuccess: () => {
          setConfirmation(null);
          setSelected(null);
          setFeedback(label);
        },
        onError: (error) => {
          setConfirmation(null);
          Alert.alert('操作失败', errorMessage(error));
        },
      },
    );
  };

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.82,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) setPhotoAsset(result.assets[0]);
  };

  const addPhoto = () => {
    if (!selected || !photoAsset) return;
    uploadPhoto.mutate(
      {
        memoryId: selected.id,
        caption: photoCaption,
        asset: {
          uri: photoAsset.uri,
          file: photoAsset.file,
          fileName: photoAsset.fileName,
          mimeType: photoAsset.mimeType,
        },
      },
      {
        onSuccess: () => {
          setPhotoCaption('');
          setPhotoAsset(null);
          setFeedback('照片已添加到回忆');
        },
        onError: (error) => Alert.alert('照片上传失败', errorMessage(error)),
      },
    );
  };

  const activeCategory = selected ? categoryInfo(selected.category) : null;
  const ActiveCategoryIcon = activeCategory?.icon ?? Images;
  const confirmationCopy = confirmation?.kind === 'archive'
    ? {
        title: '归档回忆',
        message: `确认归档「${confirmation.memory.title}」？照片和历史记录会保留。`,
        label: '归档',
        destructive: true,
      }
    : confirmation
      ? {
          title: '恢复回忆',
          message: `确认恢复「${confirmation.memory.title}」？`,
          label: '恢复',
          destructive: false,
        }
      : null;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <PageContainer maxWidth={1080} style={styles.page}>
          <PageHeader
            action={(
              <PressableScale
                accessibilityLabel="新建家庭回忆"
                haptic
                onPress={openCreate}
                style={[styles.createButton, { backgroundColor: c.tint }]}
                testID="memory-create-button"
              >
                <ImagePlus color="#FFFFFF" size={18} />
                <Text style={[t.subhead, { color: '#FFFFFF', fontWeight: '700' }]}>记录</Text>
              </PressableScale>
            )}
            subtitle="把值得记住的日常留在家里"
            title="家庭回忆"
          />

          {feedback ? (
            <PressSurface
              accessibilityLabel={`${feedback}，点击关闭`}
              onPress={() => setFeedback(null)}
              style={[styles.feedback, { backgroundColor: c.greenSoft }]}
            >
              <CheckCircle2 color={c.green} size={18} />
              <Text style={[t.footnote, { color: c.green, fontWeight: '700', flex: 1 }]}>{feedback}</Text>
              <X color={c.green} size={16} />
            </PressSurface>
          ) : null}

          <View style={[styles.toolbar, layout !== 'compact' && styles.toolbarWide]}>
            <View style={[styles.searchBox, { backgroundColor: c.card, borderColor: c.separator }]}>
              <Search color={c.tertiaryLabel} size={18} />
              <TextInput
                accessibilityLabel="搜索家庭回忆"
                onChangeText={setSearchInput}
                onSubmitEditing={() => setSearch(searchInput)}
                placeholder="搜索标题或故事"
                placeholderTextColor={c.tertiaryLabel}
                returnKeyType="search"
                style={[styles.searchInput, { color: c.label }]}
                value={searchInput}
              />
              {searchInput ? (
                <Pressable
                  accessibilityLabel="清除搜索"
                  accessibilityRole="button"
                  onPress={() => {
                    setSearchInput('');
                    setSearch('');
                  }}
                  style={({ pressed }) => [styles.iconHit, pressed && { backgroundColor: c.fill }]}
                >
                  <X color={c.secondaryLabel} size={17} />
                </Pressable>
              ) : null}
              <Pressable
                accessibilityLabel="执行回忆搜索"
                accessibilityRole="button"
                onPress={() => setSearch(searchInput)}
                style={({ pressed }) => [styles.iconHit, { backgroundColor: pressed ? c.tintSoft : c.fill }]}
              >
                <Search color={c.tint} size={17} />
              </Pressable>
            </View>
            <View style={styles.statusFilter}>
              <Segmented
                options={[
                  { label: '珍藏中', value: 'active' },
                  { label: '已归档', value: 'archived' },
                ]}
                value={status}
                onChange={(value) => {
                  setStatus(value);
                  setSelected(null);
                }}
              />
            </View>
          </View>

          <ScrollView
            contentContainerStyle={styles.categoryFilters}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {[{ value: 'all' as const, label: '全部', icon: Images }, ...CATEGORIES].map((item) => {
              const active = category === item.value;
              const Icon = item.icon;
              return (
                <Pressable
                  key={item.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setCategory(item.value)}
                  style={({ pressed }) => [
                    styles.filterButton,
                    {
                      backgroundColor: active ? c.tintSoft : pressed ? c.fill : c.card,
                      borderColor: active ? c.tint : c.separator,
                    },
                  ]}
                >
                  <Icon color={active ? c.tint : c.secondaryLabel} size={15} />
                  <Text style={[t.footnote, { color: active ? c.tint : c.secondaryLabel, fontWeight: active ? '700' : '500' }]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {memoriesQuery.isLoading ? (
            <View style={styles.loading}><ActivityIndicator color={c.tint} /></View>
          ) : memoriesQuery.isError ? (
            <EmptyState icon={Images} title="暂时无法读取回忆" hint={errorMessage(memoriesQuery.error)} />
          ) : memories.length ? (
            <>
              {featuredMemory ? (
                <View style={styles.featuredSection} testID="memory-featured">
                  <Text style={[t.footnote, styles.featuredEyebrow, { color: c.secondaryLabel }]}>
                    最近记录
                  </Text>
                  <FeaturedMemory
                    memory={featuredMemory}
                    onPress={() => setSelected(featuredMemory)}
                    wide={layout !== 'compact'}
                  />
                </View>
              ) : null}
              {remainingMemories.length ? (
                <View style={styles.memorySection}>
                  {featuredMemory ? (
                    <Text style={[t.footnote, styles.featuredEyebrow, { color: c.secondaryLabel }]}>
                      更多回忆
                    </Text>
                  ) : null}
                  <View style={[styles.memoryGrid, layout !== 'compact' && styles.memoryGridWide]}>
                    {remainingMemories.map((memory) => (
                      <MemoryCard
                        key={memory.id}
                        memory={memory}
                        onPress={() => setSelected(memory)}
                        wide={layout !== 'compact'}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
            </>
          ) : (
            <EmptyState
              icon={Images}
              iconBackground={c.tintSoft}
              iconColor={c.tint}
              title={status === 'archived' ? '没有已归档回忆' : '还没有家庭回忆'}
              hint={status === 'archived' ? '归档后的内容会保留在这里' : '从一顿饭、一次出行或平常的一天开始记录'}
            />
          )}
        </PageContainer>
      </ScrollView>

      <AdaptiveDialog
        accessibilityLabel={editing ? '编辑家庭回忆' : '新建家庭回忆'}
        maxWidth={620}
        onClose={requestCloseEditor}
        style={styles.dialog}
        testID="memory-form-dialog"
        visible={editorOpen}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.dialogContent} keyboardShouldPersistTaps="handled">
            <View style={styles.dialogHeader}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[t.title2, { color: c.label }]}>{editing ? '编辑回忆' : '记录这一刻'}</Text>
                <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 4 }]}>文字和照片仅在当前家庭内可见</Text>
              </View>
              <Pressable
                accessibilityLabel="关闭"
                accessibilityRole="button"
                disabled={busy}
                onPress={requestCloseEditor}
                style={({ pressed }) => [styles.closeButton, pressed && { backgroundColor: c.fill }]}
              >
                <X color={c.secondaryLabel} size={19} />
              </Pressable>
            </View>
            <Field
              label="标题"
              maxLength={120}
              onChangeText={(title) => setDraft((current) => ({ ...current, title }))}
              placeholder="今天发生了什么"
              value={draft.title}
            />
            <View style={styles.field}>
              <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>回忆日期</Text>
              <DateSelector
                allowPast
                onChange={(happenedOn) => setDraft((current) => ({ ...current, happenedOn }))}
                value={draft.happenedOn}
              />
            </View>
            <View style={styles.field}>
              <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>类别</Text>
              <View style={styles.categoryChoiceGrid}>
                {CATEGORIES.map((item) => {
                  const active = draft.category === item.value;
                  const Icon = item.icon;
                  return (
                    <Pressable
                      key={item.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => setDraft((current) => ({ ...current, category: item.value }))}
                      style={({ pressed }) => [
                        styles.categoryChoice,
                        {
                          backgroundColor: active ? c.tintSoft : pressed ? c.fillStrong : c.fill,
                          borderColor: active ? c.tint : c.separator,
                        },
                      ]}
                    >
                      <Icon color={active ? c.tint : c.secondaryLabel} size={17} />
                      <Text style={[t.footnote, { color: active ? c.tint : c.label, fontWeight: active ? '700' : '500' }]}>{item.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <Field
              label="故事（选填）"
              maxLength={5000}
              multiline
              onChangeText={(story) => setDraft((current) => ({ ...current, story }))}
              placeholder="写下当时的人、事和心情"
              value={draft.story}
            />
            <Field
              label="标签（选填，用逗号分隔）"
              maxLength={200}
              onChangeText={(value) => setDraft((current) => ({ ...current, tags: value }))}
              placeholder="例如：周末，第一次，团聚"
              value={draft.tags}
            />
            <PrimaryButton
              disabled={!draft.title.trim()}
              loading={busy}
              onPress={save}
              title={editing ? '保存修改' : '保存回忆'}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </AdaptiveDialog>

      <AdaptiveDialog
        accessibilityLabel="家庭回忆详情"
        maxWidth={700}
        onClose={() => setSelected(null)}
        style={styles.dialog}
        testID="memory-detail-dialog"
        visible={Boolean(selected)}
      >
        {selected ? (
          <ScrollView contentContainerStyle={styles.detailContent}>
            <View style={styles.dialogHeader}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.detailCategory}>
                  <ActiveCategoryIcon color={c.tint} size={16} />
                  <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>{activeCategory?.label}</Text>
                </View>
                <Text style={[t.title1, styles.detailTitle, { color: c.label }]}>{selected.title}</Text>
                <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 6 }]}>
                  {memoryDate(selected.happenedOn)} · {selected.createdBy.name} 记录
                </Text>
              </View>
              <Pressable
                accessibilityLabel="关闭"
                accessibilityRole="button"
                onPress={() => setSelected(null)}
                style={({ pressed }) => [styles.closeButton, pressed && { backgroundColor: c.fill }]}
              >
                <X color={c.secondaryLabel} size={19} />
              </Pressable>
            </View>

            {selected.photos.length ? (
              <View style={styles.photoGrid}>
                {selected.photos.map((photo) => (
                  <View key={photo.id} style={styles.photoItem}>
                    <Image
                      accessibilityLabel={photo.caption || selected.title}
                      contentFit="cover"
                      source={{ uri: photoUri(photo.contentUrl) ?? undefined }}
                      style={styles.detailPhoto}
                    />
                    {photo.caption ? <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 6 }]}>{photo.caption}</Text> : null}
                  </View>
                ))}
              </View>
            ) : null}

            {selected.story ? (
              <Text style={[t.body, styles.detailStory, { color: c.label }]}>{selected.story}</Text>
            ) : (
              <Text style={[t.subhead, { color: c.secondaryLabel }]}>这条回忆还没有补充故事。</Text>
            )}

            {selected.tags.length ? (
              <View style={styles.tags}>
                {selected.tags.map((tag) => (
                  <View key={tag} style={[styles.tag, { backgroundColor: c.fill }]}>
                    <Text style={[t.caption, { color: c.secondaryLabel }]}>#{tag}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {selected.source ? (
              <PressSurface
                accessibilityLabel={`打开来源${SOURCE_LABELS[selected.source.module]}`}
                accessibilityRole="link"
                onPress={() => router.push(selected.source!.targetPath as Href)}
                style={[styles.sourceLink, { backgroundColor: c.fill }]}
              >
                <Text style={[t.subhead, { color: c.label, flex: 1 }]}>来源：{SOURCE_LABELS[selected.source.module]}</Text>
                <ArrowRight color={c.tertiaryLabel} size={17} />
              </PressSurface>
            ) : null}

            {selected.canEdit && !selected.archivedAt ? (
              <View style={[styles.photoComposer, { borderColor: c.separator }]}>
                <Text style={[t.headline, { color: c.label }]}>添加照片</Text>
                <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 4 }]}>每条回忆最多 6 张，每张不超过 10MB</Text>
                {photoAsset ? (
                  <Image
                    accessibilityLabel="待上传照片预览"
                    contentFit="cover"
                    source={{ uri: photoAsset.uri }}
                    style={styles.pendingPhoto}
                    testID="memory-photo-preview"
                  />
                ) : null}
                <View style={styles.photoActions}>
                  <PressableScale
                    accessibilityLabel="选择回忆照片"
                    onPress={pickPhoto}
                    style={[styles.secondaryButton, { backgroundColor: c.fill }]}
                  >
                    <ImagePlus color={c.tint} size={18} />
                    <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]}>{photoAsset ? '重新选择' : '选择照片'}</Text>
                  </PressableScale>
                  {photoAsset ? (
                    <PressableScale
                      accessibilityLabel="移除待上传照片"
                      onPress={() => setPhotoAsset(null)}
                      style={[styles.iconAction, { backgroundColor: c.fill }]}
                    >
                      <X color={c.secondaryLabel} size={18} />
                    </PressableScale>
                  ) : null}
                </View>
                <TextInput
                  accessibilityLabel="照片说明"
                  maxLength={240}
                  onChangeText={setPhotoCaption}
                  placeholder="照片说明（选填）"
                  placeholderTextColor={c.tertiaryLabel}
                  style={[styles.input, { backgroundColor: c.fill, borderColor: c.separator, color: c.label }]}
                  value={photoCaption}
                />
                <PrimaryButton
                  disabled={!photoAsset}
                  loading={uploadPhoto.isPending}
                  onPress={addPhoto}
                  title="添加照片"
                />
              </View>
            ) : null}

            <View style={styles.detailActions}>
              {selected.canEdit && !selected.archivedAt ? (
                <PressableScale
                  accessibilityLabel="编辑家庭回忆"
                  onPress={() => openEdit(selected)}
                  style={[styles.secondaryButton, { backgroundColor: c.fill }]}
                >
                  <Edit3 color={c.tint} size={18} />
                  <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]}>编辑</Text>
                </PressableScale>
              ) : null}
              {selected.canEdit ? (
                <PressableScale
                  accessibilityLabel={selected.archivedAt ? '恢复家庭回忆' : '归档家庭回忆'}
                  onPress={() => setConfirmation({ kind: selected.archivedAt ? 'restore' : 'archive', memory: selected })}
                  style={[styles.secondaryButton, { backgroundColor: selected.archivedAt ? c.tintSoft : c.redSoft }]}
                >
                  {selected.archivedAt ? <RotateCcw color={c.tint} size={18} /> : <Archive color={c.red} size={18} />}
                  <Text style={[t.subhead, { color: selected.archivedAt ? c.tint : c.red, fontWeight: '700' }]}>
                    {selected.archivedAt ? '恢复' : '归档'}
                  </Text>
                </PressableScale>
              ) : null}
            </View>
          </ScrollView>
        ) : null}
      </AdaptiveDialog>

      <ConfirmDialog
        confirmLabel={confirmationCopy?.label}
        destructive={confirmationCopy?.destructive}
        loading={archiveMemory.isPending || restoreMemory.isPending}
        message={confirmationCopy?.message ?? ''}
        onCancel={() => setConfirmation(null)}
        onConfirm={executeConfirmation}
        title={confirmationCopy?.title ?? ''}
        visible={Boolean(confirmationCopy)}
      />
      <ConfirmDialog
        confirmLabel="放弃"
        loading={false}
        message="当前填写的内容尚未保存，确认放弃这些修改？"
        onCancel={() => setDiscardEditorOpen(false)}
        onConfirm={finishCloseEditor}
        title="放弃未保存内容"
        visible={discardEditorOpen}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { paddingBottom: 56, paddingTop: 18 },
  createButton: { alignItems: 'center', borderRadius: radius.sm, flexDirection: 'row', gap: 7, minHeight: 44, paddingHorizontal: 15 },
  feedback: { alignItems: 'center', borderRadius: radius.sm, flexDirection: 'row', gap: 8, minHeight: 44, marginBottom: 14, paddingHorizontal: 12 },
  toolbar: { gap: 10, marginBottom: 12 },
  toolbarWide: { alignItems: 'center', flexDirection: 'row' },
  searchBox: { alignItems: 'center', borderRadius: radius.sm, borderWidth: 1, flex: 1, flexDirection: 'row', minHeight: 48, paddingLeft: 13 },
  searchInput: { flex: 1, fontSize: 16, minHeight: 44, minWidth: 0, paddingHorizontal: 9 },
  iconHit: { alignItems: 'center', borderRadius: radius.sm, height: 44, justifyContent: 'center', width: 44 },
  statusFilter: { minWidth: 220 },
  categoryFilters: { gap: 8, paddingBottom: 18 },
  filterButton: { alignItems: 'center', borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', gap: 6, minHeight: 44, paddingHorizontal: 13 },
  loading: { alignItems: 'center', justifyContent: 'center', minHeight: 220 },
  featuredSection: { gap: 9 },
  featuredEyebrow: { fontWeight: '700', paddingHorizontal: 4 },
  featuredPressable: { width: '100%' },
  featuredCard: { overflow: 'hidden' },
  featuredCardWide: { flexDirection: 'row', minHeight: 286 },
  featuredImage: { aspectRatio: 16 / 10, width: '100%' },
  featuredImageWide: { aspectRatio: undefined, minHeight: 286, width: '56%' },
  featuredPlaceholder: { alignItems: 'center', aspectRatio: 16 / 10, justifyContent: 'center', width: '100%' },
  featuredCopy: { flex: 1, minWidth: 0, padding: 20 },
  featuredTitle: { lineHeight: 34, marginTop: 13 },
  featuredStory: { lineHeight: 24, marginTop: 9 },
  featuredFooter: { alignItems: 'center', flexDirection: 'row', gap: 12, marginTop: 'auto', paddingTop: 18 },
  featuredOpen: { alignItems: 'center', borderRadius: radius.md, height: 44, justifyContent: 'center', width: 44 },
  memorySection: { gap: 9, marginTop: 22 },
  memoryGrid: { gap: 12 },
  memoryGridWide: { flexDirection: 'row', flexWrap: 'wrap' },
  cardPressable: { flexGrow: 1, minWidth: 0 },
  cardPressableWide: { minWidth: 320, width: '48%' },
  memoryCard: { flexDirection: 'row', minHeight: 156, overflow: 'hidden' },
  cardImage: { height: '100%', minHeight: 156, width: 126 },
  cardImagePlaceholder: { alignItems: 'center', justifyContent: 'center', minHeight: 156, width: 126 },
  memoryCardCopy: { flex: 1, minWidth: 0, padding: 14 },
  metaRow: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  categoryBadge: { alignItems: 'center', borderRadius: radius.sm, flexDirection: 'row', gap: 5, minHeight: 28, paddingHorizontal: 8 },
  cardStory: { lineHeight: 21, marginTop: 6 },
  cardFooter: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 'auto', paddingTop: 10 },
  dialog: { maxHeight: '90%' },
  dialogContent: { gap: 18, paddingBottom: 24, paddingHorizontal: 20, paddingTop: 12 },
  dialogHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  closeButton: { alignItems: 'center', borderRadius: radius.sm, height: 44, justifyContent: 'center', width: 44 },
  field: { gap: 7 },
  fieldLabel: { fontWeight: '600' },
  input: { borderRadius: radius.sm, borderWidth: 1, fontSize: 16, minHeight: 48, paddingHorizontal: 12 },
  multiline: { minHeight: 126, paddingTop: 12 },
  categoryChoiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryChoice: { alignItems: 'center', borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', gap: 6, minHeight: 44, paddingHorizontal: 12 },
  detailContent: { gap: 18, paddingBottom: 26, paddingHorizontal: 20, paddingTop: 12 },
  detailCategory: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  detailTitle: { lineHeight: 34, marginTop: 8 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoItem: { flexGrow: 1, minWidth: 150, width: '47%' },
  detailPhoto: { aspectRatio: 4 / 3, borderRadius: radius.sm, width: '100%' },
  detailStory: { lineHeight: 27 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  tag: { borderRadius: radius.sm, minHeight: 32, paddingHorizontal: 10, paddingVertical: 7 },
  sourceLink: { alignItems: 'center', borderRadius: radius.sm, flexDirection: 'row', minHeight: 48, paddingHorizontal: 12 },
  photoComposer: { borderTopWidth: StyleSheet.hairlineWidth, gap: 12, paddingTop: 18 },
  pendingPhoto: { aspectRatio: 4 / 3, borderRadius: radius.sm, maxHeight: 300, width: '100%' },
  photoActions: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  secondaryButton: { alignItems: 'center', borderRadius: radius.sm, flexDirection: 'row', gap: 7, minHeight: 44, paddingHorizontal: 14 },
  iconAction: { alignItems: 'center', borderRadius: radius.sm, height: 44, justifyContent: 'center', width: 44 },
  detailActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
