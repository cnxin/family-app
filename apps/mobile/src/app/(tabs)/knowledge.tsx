import {
  Archive,
  ArrowLeft,
  BookOpenText,
  Check,
  ChevronRight,
  Clock3,
  Edit3,
  ExternalLink,
  FilePlus2,
  FileText,
  Pin,
  RotateCcw,
  Search,
  X,
} from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
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
import { PageContainer, useDesktopLayout } from '../../components/app-shell';
import {
  Card,
  ConfirmDialog,
  EmptyState,
  PrimaryButton,
  Segmented,
} from '../../components/ui';
import {
  type KnowledgeArticleInput,
  useArchiveKnowledgeArticle,
  useCreateKnowledgeArticle,
  useKnowledgeArticles,
  useKnowledgeRevisions,
  useRestoreKnowledgeArticle,
  useRestoreKnowledgeRevision,
  useUpdateKnowledgeArticle,
} from '../../lib/queries';
import { useSession } from '../../lib/session';
import { radius, type as t, useTheme } from '../../lib/theme';
import type {
  KnowledgeArticle,
  KnowledgeArticleCategory,
  KnowledgeArticleRevision,
} from '../../lib/types';

const CATEGORIES: {
  value: KnowledgeArticleCategory;
  label: string;
}[] = [
  { value: 'procedure', label: '家庭流程' },
  { value: 'appliance', label: '设备说明' },
  { value: 'contact', label: '常用联系' },
  { value: 'home', label: '居家资料' },
  { value: 'other', label: '其他' },
];

const CHANGE_LABELS: Record<KnowledgeArticleRevision['changeType'], string> = {
  create: '创建',
  update: '编辑',
  archive: '归档',
  restore: '恢复',
  restore_revision: '历史还原',
};

interface Draft {
  title: string;
  category: KnowledgeArticleCategory;
  summary: string;
  content: string;
  referenceUrl: string;
  tags: string;
  isPinned: boolean;
}

type Confirmation =
  | { kind: 'archive'; article: KnowledgeArticle }
  | { kind: 'restore'; article: KnowledgeArticle }
  | {
      kind: 'restore_revision';
      article: KnowledgeArticle;
      revision: KnowledgeArticleRevision;
    };

function emptyDraft(): Draft {
  return {
    title: '',
    category: 'procedure',
    summary: '',
    content: '',
    referenceUrl: '',
    tags: '',
    isPinned: false,
  };
}

function draftFromArticle(article: KnowledgeArticle): Draft {
  return {
    title: article.title,
    category: article.category,
    summary: article.summary ?? '',
    content: article.content,
    referenceUrl: article.referenceUrl ?? '',
    tags: article.tags.join('，'),
    isPinned: article.isPinned,
  };
}

function categoryLabel(category: KnowledgeArticleCategory) {
  return CATEGORIES.find((item) => item.value === category)?.label ?? '其他';
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function parseTags(value: string) {
  return value
    .split(/[，,]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请稍后再试';
}

function ArticleCard({
  article,
  onPress,
}: {
  article: KnowledgeArticle;
  onPress: () => void;
}) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityLabel={`打开${article.title}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
    >
      <Card style={styles.articleCard}>
        <View style={styles.cardTopRow}>
          <View style={[styles.categoryBadge, { backgroundColor: c.tintSoft }]}>
            <Text style={[t.caption, { color: c.tint, fontWeight: '700' }]}>
              {categoryLabel(article.category)}
            </Text>
          </View>
          {article.isPinned ? <Pin color={c.orange} fill={c.orange} size={15} /> : null}
          <Text style={[t.caption, { color: c.tertiaryLabel, marginLeft: 'auto' }]}>v{article.version}</Text>
        </View>
        <Text numberOfLines={2} style={[t.headline, { color: c.label, marginTop: 12 }]}>
          {article.title}
        </Text>
        {article.summary ? (
          <Text
            numberOfLines={2}
            style={[t.subhead, { color: c.secondaryLabel, lineHeight: 21, marginTop: 6 }]}
          >
            {article.summary}
          </Text>
        ) : (
          <Text
            numberOfLines={2}
            style={[t.subhead, { color: c.secondaryLabel, lineHeight: 21, marginTop: 6 }]}
          >
            {article.content}
          </Text>
        )}
        <View style={styles.cardFooter}>
          <Text style={[t.caption, { color: c.tertiaryLabel, flex: 1 }]}>
            {article.updatedBy.name} · {formatTime(article.updatedAt)}
          </Text>
          <ChevronRight color={c.tertiaryLabel} size={17} />
        </View>
      </Card>
    </Pressable>
  );
}

function Field({
  label,
  multiline,
  onChangeText,
  placeholder,
  value,
  maxLength,
}: {
  label: string;
  multiline?: boolean;
  onChangeText: (value: string) => void;
  placeholder?: string;
  value: string;
  maxLength: number;
}) {
  const c = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[t.footnote, { color: c.secondaryLabel }]}>{label}</Text>
      <TextInput
        maxLength={maxLength}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.tertiaryLabel}
        style={[
          styles.input,
          multiline && styles.multiline,
          { backgroundColor: c.fill, color: c.label, borderColor: c.separator },
        ]}
        textAlignVertical={multiline ? 'top' : 'center'}
        value={value}
      />
    </View>
  );
}

export default function KnowledgeScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const { member } = useSession();
  const canPin = member?.role === 'owner' || member?.role === 'admin';
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [category, setCategory] = useState<KnowledgeArticleCategory | 'all'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<KnowledgeArticle | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editing, setEditing] = useState<KnowledgeArticle | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const articlesQuery = useKnowledgeArticles(status, category, search);
  const revisionsQuery = useKnowledgeRevisions(selected?.id ?? null);
  const createArticle = useCreateKnowledgeArticle();
  const updateArticle = useUpdateKnowledgeArticle();
  const archiveArticle = useArchiveKnowledgeArticle();
  const restoreArticle = useRestoreKnowledgeArticle();
  const restoreRevision = useRestoreKnowledgeRevision();

  const busy =
    createArticle.isPending ||
    updateArticle.isPending ||
    archiveArticle.isPending ||
    restoreArticle.isPending ||
    restoreRevision.isPending;
  const tags = useMemo(() => parseTags(draft.tags), [draft.tags]);

  const openCreate = () => {
    setEditing(null);
    setDraft(emptyDraft());
    setEditorVisible(true);
  };

  const openEdit = (article: KnowledgeArticle) => {
    setEditing(article);
    setDraft(draftFromArticle(article));
    setEditorVisible(true);
  };

  const closeDetail = () => {
    setSelected(null);
    setHistoryOpen(false);
  };

  const handleSaved = (article: KnowledgeArticle) => {
    setSelected(article);
    setEditorVisible(false);
    setEditing(null);
  };

  const save = () => {
    if (!draft.title.trim() || !draft.content.trim()) {
      Alert.alert('无法保存', '请填写标题和正文');
      return;
    }
    const input: KnowledgeArticleInput = {
      title: draft.title.trim(),
      category: draft.category,
      summary: draft.summary.trim() || null,
      content: draft.content.trim(),
      referenceUrl: draft.referenceUrl.trim() || null,
      tags,
      isPinned: canPin ? draft.isPinned : undefined,
    };
    if (editing) {
      updateArticle.mutate(
        { id: editing.id, expectedVersion: editing.version, ...input },
        {
          onSuccess: handleSaved,
          onError: (error) => Alert.alert('保存失败', errorMessage(error)),
        },
      );
    } else {
      createArticle.mutate(input, {
        onSuccess: handleSaved,
        onError: (error) => Alert.alert('创建失败', errorMessage(error)),
      });
    }
  };

  const executeConfirmation = () => {
    if (!confirmation) return;
    const callbacks = {
      onSuccess: (article: KnowledgeArticle) => {
        setSelected(article);
        setConfirmation(null);
        setHistoryOpen(false);
      },
      onError: (error: unknown) => {
        setConfirmation(null);
        Alert.alert('操作失败', errorMessage(error));
      },
    };
    if (confirmation.kind === 'archive') {
      archiveArticle.mutate(
        {
          id: confirmation.article.id,
          expectedVersion: confirmation.article.version,
        },
        callbacks,
      );
      return;
    }
    if (confirmation.kind === 'restore') {
      restoreArticle.mutate(
        {
          id: confirmation.article.id,
          expectedVersion: confirmation.article.version,
        },
        callbacks,
      );
      return;
    }
    restoreRevision.mutate(
      {
        id: confirmation.article.id,
        expectedVersion: confirmation.article.version,
        version: confirmation.revision.version,
      },
      callbacks,
    );
  };

  const confirmationCopy = confirmation
    ? confirmation.kind === 'archive'
      ? {
          title: '归档文章',
          message: `确认归档「${confirmation.article.title}」？`,
          label: '归档',
          destructive: true,
        }
      : confirmation.kind === 'restore'
        ? {
            title: '恢复文章',
            message: `确认恢复「${confirmation.article.title}」？`,
            label: '恢复',
            destructive: false,
          }
        : {
            title: '还原历史版本',
            message: `确认将「${confirmation.article.title}」还原为 v${confirmation.revision.version}？当前内容会保留在历史中。`,
            label: '还原',
            destructive: false,
          }
    : null;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <PageContainer style={styles.page}>
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[desktop ? t.largeTitle : t.title1, { color: c.label }]}>家庭知识库</Text>
            <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 4 }]}>流程、说明与常用资料</Text>
          </View>
          <Pressable
            accessibilityLabel="新建知识文章"
            accessibilityRole="button"
            onPress={openCreate}
            style={({ pressed }) => [
              styles.createButton,
              { backgroundColor: pressed ? c.green : c.tint },
            ]}
          >
            <FilePlus2 color="#FFFFFF" size={18} />
            <Text style={[t.subhead, { color: '#FFFFFF', fontWeight: '700' }]}>新建</Text>
          </Pressable>
        </View>

        <View style={[styles.toolbar, desktop && styles.toolbarDesktop]}>
          <View style={[styles.searchBox, { backgroundColor: c.card, borderColor: c.separator }]}>
            <Search color={c.tertiaryLabel} size={18} />
            <TextInput
              accessibilityLabel="搜索家庭知识库"
              onChangeText={setSearchInput}
              onSubmitEditing={() => setSearch(searchInput)}
              placeholder="搜索标题或正文"
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
                style={styles.iconHit}
              >
                <X color={c.secondaryLabel} size={17} />
              </Pressable>
            ) : null}
            <Pressable
              accessibilityLabel="执行搜索"
              accessibilityRole="button"
              onPress={() => setSearch(searchInput)}
              style={[styles.searchButton, { backgroundColor: c.fill }]}
            >
              <Search color={c.tint} size={17} />
            </Pressable>
          </View>
          <View style={styles.statusFilter}>
            <Segmented
              options={[
                { label: '使用中', value: 'active' },
                { label: '已归档', value: 'archived' },
              ]}
              value={status}
              onChange={(value) => {
                setStatus(value);
                closeDetail();
              }}
            />
          </View>
        </View>

        <ScrollView
          horizontal
          contentContainerStyle={styles.categoryFilters}
          showsHorizontalScrollIndicator={false}
        >
          {[{ value: 'all' as const, label: '全部' }, ...CATEGORIES].map((item) => {
            const active = category === item.value;
            return (
              <Pressable
                key={item.value}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  setCategory(item.value);
                  closeDetail();
                }}
                style={[
                  styles.filterButton,
                  {
                    backgroundColor: active ? c.tintSoft : c.card,
                    borderColor: active ? c.tint : c.separator,
                  },
                ]}
              >
                <Text style={[t.footnote, { color: active ? c.tint : c.secondaryLabel, fontWeight: active ? '700' : '500' }]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <ScrollView
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
        >
          {articlesQuery.isLoading ? (
            <ActivityIndicator color={c.tint} style={styles.loader} />
          ) : articlesQuery.isError ? (
            <View style={styles.errorState}>
              <Text style={[t.headline, { color: c.label }]}>知识库加载失败</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void articlesQuery.refetch()}
                style={[styles.retryButton, { backgroundColor: c.fill }]}
              >
                <RotateCcw color={c.tint} size={17} />
                <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]}>重试</Text>
              </Pressable>
            </View>
          ) : articlesQuery.data?.length ? (
            <View style={[styles.articleGrid, desktop && styles.articleGridDesktop]}>
              {articlesQuery.data.map((article) => (
                <View key={article.id} style={desktop ? styles.articleCellDesktop : undefined}>
                  <ArticleCard
                    article={article}
                    onPress={() => {
                      setSelected(article);
                      setHistoryOpen(false);
                    }}
                  />
                </View>
              ))}
            </View>
          ) : (
            <EmptyState
              emoji="🗂️"
              title={status === 'active' ? '还没有知识文章' : '没有已归档文章'}
            />
          )}
        </ScrollView>
      </PageContainer>

      <Modal
        animationType="fade"
        onRequestClose={closeDetail}
        transparent
        visible={Boolean(selected)}
      >
        <View style={styles.overlay}>
          <Pressable
            accessibilityLabel="关闭文章详情"
            accessibilityRole="button"
            onPress={closeDetail}
            style={StyleSheet.absoluteFill}
          />
          {selected ? (
            <SafeAreaView style={[styles.detailPanel, { backgroundColor: c.card, borderColor: c.separator }]}>
              <View style={[styles.modalHeader, { borderBottomColor: c.separator }]}>
                {historyOpen ? (
                  <Pressable
                    accessibilityLabel="返回文章详情"
                    accessibilityRole="button"
                    onPress={() => setHistoryOpen(false)}
                    style={styles.modalIconButton}
                  >
                    <ArrowLeft color={c.label} size={21} />
                  </Pressable>
                ) : (
                  <View style={[styles.detailIcon, { backgroundColor: c.tintSoft }]}>
                    <BookOpenText color={c.tint} size={20} />
                  </View>
                )}
                <Text numberOfLines={1} style={[t.headline, { color: c.label, flex: 1 }]}>
                  {historyOpen ? '版本历史' : selected.title}
                </Text>
                <Pressable
                  accessibilityLabel="关闭"
                  accessibilityRole="button"
                  onPress={closeDetail}
                  style={styles.modalIconButton}
                >
                  <X color={c.secondaryLabel} size={21} />
                </Pressable>
              </View>

              {historyOpen ? (
                <ScrollView contentContainerStyle={styles.historyContent}>
                  {revisionsQuery.isLoading ? (
                    <ActivityIndicator color={c.tint} style={styles.loader} />
                  ) : (
                    revisionsQuery.data?.map((revision) => (
                      <View
                        key={revision.id}
                        style={[styles.historyRow, { borderBottomColor: c.separator }]}
                      >
                        <View style={[styles.versionBadge, { backgroundColor: revision.version === selected.version ? c.tintSoft : c.fill }]}>
                          <Text style={[t.footnote, { color: revision.version === selected.version ? c.tint : c.secondaryLabel, fontWeight: '700' }]}>v{revision.version}</Text>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]}>
                            {CHANGE_LABELS[revision.changeType]} · {revision.changedBy.name}
                          </Text>
                          <Text style={[t.caption, { color: c.tertiaryLabel, marginTop: 3 }]}>
                            {formatTime(revision.createdAt)}
                          </Text>
                          <Text numberOfLines={2} style={[t.caption, { color: c.secondaryLabel, lineHeight: 18, marginTop: 6 }]}>
                            {revision.summary ?? revision.content}
                          </Text>
                        </View>
                        {selected.canEdit && !selected.archivedAt && revision.version !== selected.version ? (
                          <Pressable
                            accessibilityLabel={`还原版本${revision.version}`}
                            accessibilityRole="button"
                            onPress={() =>
                              setConfirmation({
                                kind: 'restore_revision',
                                article: selected,
                                revision,
                              })
                            }
                            style={[styles.restoreVersionButton, { backgroundColor: c.fill }]}
                          >
                            <RotateCcw color={c.tint} size={16} />
                            <Text style={[t.caption, { color: c.tint, fontWeight: '700' }]}>还原</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ))
                  )}
                </ScrollView>
              ) : (
                <>
                  <ScrollView contentContainerStyle={styles.detailContent}>
                    <View style={styles.detailMetaRow}>
                      <View style={[styles.categoryBadge, { backgroundColor: c.tintSoft }]}>
                        <Text style={[t.caption, { color: c.tint, fontWeight: '700' }]}>
                          {categoryLabel(selected.category)}
                        </Text>
                      </View>
                      {selected.isPinned ? (
                        <View style={[styles.pinnedBadge, { backgroundColor: c.orangeSoft }]}>
                          <Pin color={c.orange} fill={c.orange} size={13} />
                          <Text style={[t.caption, { color: c.orange, fontWeight: '700' }]}>置顶</Text>
                        </View>
                      ) : null}
                      {selected.archivedAt ? (
                        <View style={[styles.pinnedBadge, { backgroundColor: c.fill }]}>
                          <Archive color={c.secondaryLabel} size={13} />
                          <Text style={[t.caption, { color: c.secondaryLabel, fontWeight: '700' }]}>已归档</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={[t.title1, { color: c.label, marginTop: 16 }]}>{selected.title}</Text>
                    {selected.summary ? (
                      <Text style={[t.body, { color: c.secondaryLabel, lineHeight: 26, marginTop: 10 }]}>{selected.summary}</Text>
                    ) : null}
                    {selected.tags.length ? (
                      <View style={styles.tags}>
                        {selected.tags.map((tag) => (
                          <View key={tag} style={[styles.tag, { backgroundColor: c.fill }]}>
                            <Text style={[t.caption, { color: c.secondaryLabel }]}>#{tag}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    <View style={[styles.contentDivider, { backgroundColor: c.separator }]} />
                    <Text selectable style={[t.body, styles.articleContent, { color: c.label }]}>
                      {selected.content}
                    </Text>
                    {selected.referenceUrl ? (
                      <Pressable
                        accessibilityRole="link"
                        onPress={() =>
                          void Linking.openURL(selected.referenceUrl!).catch(() =>
                            Alert.alert('无法打开链接'),
                          )
                        }
                        style={[styles.referenceButton, { backgroundColor: c.blueSoft }]}
                      >
                        <ExternalLink color={c.blue} size={17} />
                        <Text numberOfLines={1} style={[t.subhead, { color: c.blue, fontWeight: '700', flex: 1 }]}>打开参考链接</Text>
                      </Pressable>
                    ) : null}
                    <Text style={[t.caption, { color: c.tertiaryLabel, marginTop: 22 }]}>
                      v{selected.version} · {selected.updatedBy.name}更新于 {formatTime(selected.updatedAt)}
                    </Text>
                  </ScrollView>
                  <View style={[styles.detailActions, { borderTopColor: c.separator }]}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setHistoryOpen(true)}
                      style={[styles.actionButton, { backgroundColor: c.fill }]}
                    >
                      <Clock3 color={c.secondaryLabel} size={18} />
                      <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]}>历史</Text>
                    </Pressable>
                    {selected.canEdit && !selected.archivedAt ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => openEdit(selected)}
                        style={[styles.actionButton, { backgroundColor: c.tintSoft }]}
                      >
                        <Edit3 color={c.tint} size={18} />
                        <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]}>编辑</Text>
                      </Pressable>
                    ) : null}
                    {selected.canEdit ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                          setConfirmation({
                            kind: selected.archivedAt ? 'restore' : 'archive',
                            article: selected,
                          })
                        }
                        style={[
                          styles.actionButton,
                          { backgroundColor: selected.archivedAt ? c.greenSoft : c.redSoft },
                        ]}
                      >
                        {selected.archivedAt ? (
                          <RotateCcw color={c.green} size={18} />
                        ) : (
                          <Archive color={c.red} size={18} />
                        )}
                        <Text style={[t.subhead, { color: selected.archivedAt ? c.green : c.red, fontWeight: '700' }]}>
                          {selected.archivedAt ? '恢复' : '归档'}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </>
              )}
            </SafeAreaView>
          ) : null}
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setEditorVisible(false)}
        transparent
        visible={editorVisible}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.overlay}
        >
          <Pressable
            accessibilityLabel="关闭编辑窗口"
            accessibilityRole="button"
            onPress={() => setEditorVisible(false)}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView style={[styles.editorPanel, { backgroundColor: c.card, borderColor: c.separator }]}>
            <View style={[styles.modalHeader, { borderBottomColor: c.separator }]}>
              <View style={[styles.detailIcon, { backgroundColor: c.tintSoft }]}>
                <FileText color={c.tint} size={20} />
              </View>
              <Text style={[t.headline, { color: c.label, flex: 1 }]}>
                {editing ? '编辑文章' : '新建文章'}
              </Text>
              <Pressable
                accessibilityLabel="关闭"
                accessibilityRole="button"
                disabled={busy}
                onPress={() => setEditorVisible(false)}
                style={styles.modalIconButton}
              >
                <X color={c.secondaryLabel} size={21} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
              <Field
                label="标题"
                maxLength={120}
                onChangeText={(title) => setDraft((value) => ({ ...value, title }))}
                placeholder="文章标题"
                value={draft.title}
              />
              <View style={styles.field}>
                <Text style={[t.footnote, { color: c.secondaryLabel }]}>分类</Text>
                <View style={styles.categoryPicker}>
                  {CATEGORIES.map((item) => {
                    const active = draft.category === item.value;
                    return (
                      <Pressable
                        key={item.value}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        onPress={() =>
                          setDraft((value) => ({ ...value, category: item.value }))
                        }
                        style={[
                          styles.categoryOption,
                          {
                            backgroundColor: active ? c.tintSoft : c.fill,
                            borderColor: active ? c.tint : c.separator,
                          },
                        ]}
                      >
                        {active ? <Check color={c.tint} size={14} /> : null}
                        <Text style={[t.footnote, { color: active ? c.tint : c.secondaryLabel, fontWeight: active ? '700' : '500' }]}>{item.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <Field
                label="摘要"
                maxLength={500}
                multiline
                onChangeText={(summary) => setDraft((value) => ({ ...value, summary }))}
                placeholder="简短摘要"
                value={draft.summary}
              />
              <Field
                label="正文"
                maxLength={20_000}
                multiline
                onChangeText={(content) => setDraft((value) => ({ ...value, content }))}
                placeholder="正文内容"
                value={draft.content}
              />
              <Field
                label="参考链接"
                maxLength={2000}
                onChangeText={(referenceUrl) =>
                  setDraft((value) => ({ ...value, referenceUrl }))
                }
                placeholder="https://"
                value={draft.referenceUrl}
              />
              <Field
                label="标签"
                maxLength={200}
                onChangeText={(tagsValue) => setDraft((value) => ({ ...value, tags: tagsValue }))}
                placeholder="用逗号分隔，最多 8 个"
                value={draft.tags}
              />
              {canPin ? (
                <View style={[styles.pinRow, { borderColor: c.separator }]}>
                  <View style={[styles.detailIcon, { backgroundColor: c.orangeSoft }]}>
                    <Pin color={c.orange} size={18} />
                  </View>
                  <Text style={[t.body, { color: c.label, flex: 1 }]}>置顶文章</Text>
                  <Switch
                    accessibilityLabel="置顶文章"
                    onValueChange={(isPinned) =>
                      setDraft((value) => ({ ...value, isPinned }))
                    }
                    thumbColor={draft.isPinned ? c.tint : c.tertiaryLabel}
                    trackColor={{ false: c.fillStrong, true: c.tintSoft }}
                    value={draft.isPinned}
                  />
                </View>
              ) : null}
              <PrimaryButton
                disabled={!draft.title.trim() || !draft.content.trim()}
                icon={<Check color="#FFFFFF" size={18} />}
                loading={createArticle.isPending || updateArticle.isPending}
                onPress={save}
                title={editing ? '保存修改' : '创建文章'}
              />
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      <ConfirmDialog
        confirmLabel={confirmationCopy?.label}
        destructive={confirmationCopy?.destructive}
        loading={busy}
        message={confirmationCopy?.message ?? ''}
        onCancel={() => setConfirmation(null)}
        onConfirm={executeConfirmation}
        title={confirmationCopy?.title ?? ''}
        visible={Boolean(confirmation)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { flex: 1, paddingTop: 22 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  createButton: {
    minHeight: 42,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  toolbar: { marginTop: 20, gap: 10 },
  toolbarDesktop: { flexDirection: 'row', alignItems: 'center' },
  searchBox: {
    flex: 1,
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 13,
  },
  searchInput: { flex: 1, minWidth: 0, fontSize: 16, paddingHorizontal: 10, paddingVertical: 10 },
  searchButton: { width: 42, height: 34, marginRight: 5, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  iconHit: { width: 34, height: 38, alignItems: 'center', justifyContent: 'center' },
  statusFilter: { width: 220 },
  categoryFilters: { gap: 8, paddingTop: 12, paddingBottom: 14 },
  filterButton: { minHeight: 34, paddingHorizontal: 13, borderWidth: 1, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 40, flexGrow: 1 },
  loader: { marginVertical: 48 },
  articleGrid: { gap: 12 },
  articleGridDesktop: { flexDirection: 'row', flexWrap: 'wrap' },
  articleCellDesktop: { width: '32%', minWidth: 280, flexGrow: 1 },
  articleCard: { minHeight: 174, padding: 16 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  categoryBadge: { minHeight: 25, borderRadius: radius.sm, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center' },
  cardFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 'auto', paddingTop: 15 },
  errorState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 72, gap: 16 },
  retryButton: { minHeight: 40, borderRadius: radius.md, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 7 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  detailPanel: { width: '100%', maxWidth: 760, height: '90%', borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  editorPanel: { width: '100%', maxWidth: 720, maxHeight: '94%', borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  modalHeader: { minHeight: 58, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  modalIconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  detailIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  detailContent: { padding: 22, paddingBottom: 34 },
  detailMetaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  pinnedBadge: { minHeight: 25, borderRadius: radius.sm, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 14 },
  tag: { minHeight: 26, borderRadius: radius.sm, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center' },
  contentDivider: { height: StyleSheet.hairlineWidth, marginVertical: 22 },
  articleContent: { lineHeight: 28 },
  referenceButton: { minHeight: 44, borderRadius: radius.md, paddingHorizontal: 13, marginTop: 22, flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailActions: { borderTopWidth: StyleSheet.hairlineWidth, padding: 12, flexDirection: 'row', gap: 8 },
  actionButton: { minHeight: 42, borderRadius: radius.md, paddingHorizontal: 14, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  historyContent: { padding: 18, paddingBottom: 36 },
  historyRow: { minHeight: 92, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingVertical: 14 },
  versionBadge: { minWidth: 44, height: 30, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  restoreVersionButton: { minHeight: 34, borderRadius: radius.sm, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5 },
  formContent: { padding: 20, gap: 17, paddingBottom: 34 },
  field: { gap: 7 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, fontSize: 16 },
  multiline: { minHeight: 92, paddingTop: 11, lineHeight: 22 },
  categoryPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryOption: { minHeight: 36, borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 5 },
  pinRow: { minHeight: 58, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
});
