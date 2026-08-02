import * as Haptics from 'expo-haptics';
import {
  Archive,
  BellPlus,
  Check,
  ChevronRight,
  Circle,
  Layers3,
  ListChecks,
  Luggage,
  MapPin,
  Minus,
  Pencil,
  Plane,
  Plus,
  RotateCcw,
  SkipForward,
  Trash2,
  UserRound,
  X,
} from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageContainer, useDesktopLayout } from '../../components/app-shell';
import { DateSelector } from '../../components/date-selector';
import {
  Card,
  ConfirmDialog,
  EmptyState,
  PrimaryButton,
  Segmented,
} from '../../components/ui';
import { formatPlanDate, todayStr } from '../../lib/date';
import {
  useApplyTravelTemplate,
  useCreateTravelItem,
  useCreateTravelPlan,
  useCreateTravelTemplate,
  useMembers,
  useTravelItemAction,
  useTravelPlan,
  useTravelPlanAction,
  useTravelPlans,
  useTravelTemplateAction,
  useTravelTemplates,
  useUpdateTravelItem,
  useUpdateTravelPlan,
  useUpdateTravelTemplate,
} from '../../lib/queries';
import { radius, type as t, useTheme } from '../../lib/theme';
import type {
  Member,
  TravelChecklistCategory,
  TravelChecklistItem,
  TravelPackingTemplate,
  TravelPlan,
} from '../../lib/types';

type MainView = 'plans' | 'templates';
type PlanFilter = 'active' | 'completed' | 'cancelled' | 'archived';

const CATEGORY_META: Record<
  TravelChecklistCategory,
  { label: string; emoji: string }
> = {
  documents: { label: '凭证', emoji: '🎫' },
  clothing: { label: '衣物', emoji: '👕' },
  toiletries: { label: '洗护', emoji: '🧴' },
  electronics: { label: '电子', emoji: '🔌' },
  supplies: { label: '用品', emoji: '🧳' },
  other: { label: '其他', emoji: '📦' },
};

const CATEGORIES = Object.keys(CATEGORY_META) as TravelChecklistCategory[];

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function planStatus(plan: TravelPlan) {
  if (plan.archivedAt) return '已归档';
  if (plan.status === 'completed') return '已完成';
  if (plan.status === 'cancelled') return '已取消';
  return '计划中';
}

function planDates(plan: Pick<TravelPlan, 'startDate' | 'endDate'>) {
  return plan.startDate === plan.endDate
    ? formatPlanDate(plan.startDate)
    : `${formatPlanDate(plan.startDate)} - ${formatPlanDate(plan.endDate)}`;
}

function CategorySelector({
  onChange,
  value,
}: {
  onChange: (category: TravelChecklistCategory) => void;
  value: TravelChecklistCategory;
}) {
  const c = useTheme();
  return (
    <View style={styles.categoryWrap}>
      {CATEGORIES.map((category) => {
        const selected = category === value;
        return (
          <Pressable
            accessibilityRole="button"
            key={category}
            onPress={() => onChange(category)}
            style={({ pressed }) => [
              styles.categoryChip,
              {
                backgroundColor: selected ? c.tintSoft : pressed ? c.fillStrong : c.fill,
                borderColor: selected ? c.tint : 'transparent',
              },
            ]}
          >
            <Text style={{ fontSize: 15 }}>{CATEGORY_META[category].emoji}</Text>
            <Text
              style={[
                t.footnote,
                { color: selected ? c.tint : c.secondaryLabel, fontWeight: '700' },
              ]}
            >
              {CATEGORY_META[category].label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function QuantityStepper({
  onChange,
  value,
}: {
  onChange: (value: number) => void;
  value: number;
}) {
  const c = useTheme();
  return (
    <View style={[styles.stepper, { backgroundColor: c.fill }]}>
      <Pressable
        accessibilityLabel="减少数量"
        accessibilityRole="button"
        disabled={value <= 1}
        onPress={() => onChange(Math.max(1, value - 1))}
        style={[styles.stepperButton, { opacity: value <= 1 ? 0.35 : 1 }]}
      >
        <Minus color={c.secondaryLabel} size={17} />
      </Pressable>
      <Text style={[t.headline, { color: c.label, minWidth: 34, textAlign: 'center' }]}>
        {value}
      </Text>
      <Pressable
        accessibilityLabel="增加数量"
        accessibilityRole="button"
        disabled={value >= 99}
        onPress={() => onChange(Math.min(99, value + 1))}
        style={[styles.stepperButton, { opacity: value >= 99 ? 0.35 : 1 }]}
      >
        <Plus color={c.tint} size={17} />
      </Pressable>
    </View>
  );
}

function FormModal({
  children,
  onClose,
  title,
  visible,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
  visible: boolean;
}) {
  const c = useTheme();
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalOverlay}>
        <Pressable
          accessibilityLabel="关闭表单"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[styles.formSheet, { backgroundColor: c.card, borderColor: c.separator }]}
        >
          <View style={styles.formHeader}>
            <Text style={[t.title2, { color: c.label, flex: 1 }]}>{title}</Text>
            <Pressable
              accessibilityLabel="关闭"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.iconButton,
                { backgroundColor: pressed ? c.fill : 'transparent' },
              ]}
            >
              <X color={c.secondaryLabel} size={20} />
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function PlanForm({
  editing,
  onClose,
  onSaved,
  visible,
}: {
  editing: TravelPlan | null;
  onClose: () => void;
  onSaved: (plan: TravelPlan) => void;
  visible: boolean;
}) {
  const c = useTheme();
  const create = useCreateTravelPlan();
  const update = useUpdateTravelPlan();
  const [title, setTitle] = useState('');
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState(todayStr(7));
  const [endDate, setEndDate] = useState(todayStr(8));
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTitle(editing?.title ?? '');
    setDestination(editing?.destination ?? '');
    setStartDate(editing?.startDate ?? todayStr(7));
    setEndDate(editing?.endDate ?? todayStr(8));
    setNote(editing?.note ?? '');
    setMessage(null);
  }, [editing, visible]);

  const submit = async () => {
    if (!title.trim()) {
      setMessage('请填写行程名称');
      return;
    }
    if (endDate < startDate) {
      setMessage('返程日期不能早于出发日期');
      return;
    }
    setMessage(null);
    try {
      const input = {
        title: title.trim(),
        destination: destination.trim() || null,
        startDate,
        endDate,
        note: note.trim() || null,
      };
      const plan = editing
        ? await update.mutateAsync({
            id: editing.id,
            expectedVersion: editing.version,
            ...input,
          })
        : await create.mutateAsync(input);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved(plan);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，请稍后再试');
    }
  };
  const loading = create.isPending || update.isPending;

  return (
    <FormModal
      onClose={onClose}
      title={editing ? '编辑出行计划' : '新建出行计划'}
      visible={visible}
    >
      <ScrollView
        contentContainerStyle={styles.formContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.field}>
          <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>行程名称</Text>
          <TextInput
            accessibilityLabel="行程名称"
            maxLength={120}
            onChangeText={setTitle}
            placeholder="周末短途、探亲或家庭旅行"
            placeholderTextColor={c.tertiaryLabel}
            style={[t.body, styles.input, { backgroundColor: c.fill, color: c.label }]}
            value={title}
          />
        </View>
        <View style={styles.field}>
          <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>目的地区域</Text>
          <TextInput
            accessibilityLabel="目的地区域"
            maxLength={120}
            onChangeText={setDestination}
            placeholder="城市或区域即可"
            placeholderTextColor={c.tertiaryLabel}
            style={[t.body, styles.input, { backgroundColor: c.fill, color: c.label }]}
            value={destination}
          />
        </View>
        <View style={[styles.dateFields, styles.field]}>
          <View style={{ flex: 1, minWidth: 0, gap: 7 }}>
            <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>出发</Text>
            <DateSelector allowPast onChange={setStartDate} value={startDate} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 7 }}>
            <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>返程</Text>
            <DateSelector allowPast onChange={setEndDate} value={endDate} />
          </View>
        </View>
        <View style={styles.field}>
          <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>备注</Text>
          <TextInput
            accessibilityLabel="行程备注"
            maxLength={1000}
            multiline
            onChangeText={setNote}
            placeholder="集合方式或家庭约定"
            placeholderTextColor={c.tertiaryLabel}
            style={[t.body, styles.noteInput, { backgroundColor: c.fill, color: c.label }]}
            textAlignVertical="top"
            value={note}
          />
        </View>
        {message ? <Text style={[t.footnote, { color: c.red }]}>{message}</Text> : null}
        <View style={styles.formActions}>
          <Pressable
            accessibilityRole="button"
            disabled={loading}
            onPress={onClose}
            style={[styles.cancelButton, { backgroundColor: c.fill }]}
          >
            <Text style={[t.headline, { color: c.label }]}>取消</Text>
          </Pressable>
          <PrimaryButton
            loading={loading}
            onPress={() => void submit()}
            style={styles.saveButton}
            title={editing ? '保存修改' : '创建行程'}
          />
        </View>
      </ScrollView>
    </FormModal>
  );
}

function ItemForm({
  editing,
  members,
  onClose,
  onSaved,
  plan,
  visible,
}: {
  editing: TravelChecklistItem | null;
  members: Member[];
  onClose: () => void;
  onSaved: () => void;
  plan: TravelPlan | null;
  visible: boolean;
}) {
  const c = useTheme();
  const create = useCreateTravelItem();
  const update = useUpdateTravelItem();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<TravelChecklistCategory>('supplies');
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [assignedMemberId, setAssignedMemberId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTitle(editing?.title ?? '');
    setCategory(editing?.category ?? 'supplies');
    setQuantity(editing?.quantity ?? 1);
    setNote(editing?.note ?? '');
    setAssignedMemberId(editing?.assignedMember?.id ?? null);
    setMessage(null);
  }, [editing, visible]);

  const submit = async () => {
    if (!plan || !title.trim()) {
      setMessage('请填写清单项名称');
      return;
    }
    setMessage(null);
    try {
      const input = {
        title: title.trim(),
        category,
        quantity,
        note: note.trim() || null,
        assignedMemberId,
      };
      if (editing) {
        await update.mutateAsync({
          planId: plan.id,
          itemId: editing.id,
          expectedVersion: editing.version,
          ...input,
        });
      } else {
        await create.mutateAsync({
          planId: plan.id,
          sortOrder: plan.items.length,
          ...input,
        });
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，请稍后再试');
    }
  };
  const loading = create.isPending || update.isPending;

  return (
    <FormModal
      onClose={onClose}
      title={editing ? '编辑清单项' : '添加清单项'}
      visible={visible}
    >
      <ScrollView
        contentContainerStyle={styles.formContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.field}>
          <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>物品或事项</Text>
          <TextInput
            accessibilityLabel="清单项名称"
            maxLength={120}
            onChangeText={setTitle}
            placeholder="需要携带或出发前完成的事项"
            placeholderTextColor={c.tertiaryLabel}
            style={[t.body, styles.input, { backgroundColor: c.fill, color: c.label }]}
            value={title}
          />
        </View>
        <View style={styles.field}>
          <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>分类</Text>
          <CategorySelector onChange={setCategory} value={category} />
        </View>
        <View style={styles.field}>
          <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>数量</Text>
          <QuantityStepper onChange={setQuantity} value={quantity} />
        </View>
        <View style={styles.field}>
          <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>负责人</Text>
          <View style={styles.memberWrap}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setAssignedMemberId(null)}
              style={[
                styles.memberChip,
                {
                  backgroundColor: assignedMemberId ? c.fill : c.tintSoft,
                  borderColor: assignedMemberId ? 'transparent' : c.tint,
                },
              ]}
            >
              <Text style={[t.footnote, { color: assignedMemberId ? c.secondaryLabel : c.tint, fontWeight: '700' }]}>未分配</Text>
            </Pressable>
            {members.map((member) => {
              const selected = member.id === assignedMemberId;
              return (
                <Pressable
                  accessibilityRole="button"
                  key={member.id}
                  onPress={() => setAssignedMemberId(member.id)}
                  style={[
                    styles.memberChip,
                    {
                      backgroundColor: selected ? c.tintSoft : c.fill,
                      borderColor: selected ? c.tint : 'transparent',
                    },
                  ]}
                >
                  <Text>{member.avatarEmoji}</Text>
                  <Text style={[t.footnote, { color: selected ? c.tint : c.secondaryLabel, fontWeight: '700' }]}>{member.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={styles.field}>
          <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>备注</Text>
          <TextInput
            accessibilityLabel="清单项备注"
            maxLength={500}
            multiline
            onChangeText={setNote}
            placeholder="尺寸、领取方式或家庭约定"
            placeholderTextColor={c.tertiaryLabel}
            style={[t.body, styles.noteInputSmall, { backgroundColor: c.fill, color: c.label }]}
            textAlignVertical="top"
            value={note}
          />
        </View>
        {message ? <Text style={[t.footnote, { color: c.red }]}>{message}</Text> : null}
        <View style={styles.formActions}>
          <Pressable
            accessibilityRole="button"
            disabled={loading}
            onPress={onClose}
            style={[styles.cancelButton, { backgroundColor: c.fill }]}
          >
            <Text style={[t.headline, { color: c.label }]}>取消</Text>
          </Pressable>
          <PrimaryButton
            loading={loading}
            onPress={() => void submit()}
            style={styles.saveButton}
            title={editing ? '保存修改' : '添加清单项'}
          />
        </View>
      </ScrollView>
    </FormModal>
  );
}

interface TemplateDraftItem {
  key: string;
  title: string;
  category: TravelChecklistCategory;
  quantity: number;
}

function draftKey() {
  return `${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function TemplateForm({
  editing,
  onClose,
  onSaved,
  visible,
}: {
  editing: TravelPackingTemplate | null;
  onClose: () => void;
  onSaved: () => void;
  visible: boolean;
}) {
  const c = useTheme();
  const create = useCreateTravelTemplate();
  const update = useUpdateTravelTemplate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<TemplateDraftItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTitle(editing?.title ?? '');
    setDescription(editing?.description ?? '');
    setItems(
      editing?.items.map((item) => ({
        key: item.id,
        title: item.title,
        category: item.category,
        quantity: item.quantity,
      })) ?? [{ key: draftKey(), title: '', category: 'supplies', quantity: 1 }],
    );
    setMessage(null);
  }, [editing, visible]);

  const updateDraft = (key: string, fields: Partial<TemplateDraftItem>) => {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...fields } : item)),
    );
  };

  const submit = async () => {
    const normalizedItems = items
      .map((item) => ({
        title: item.title.trim(),
        category: item.category,
        quantity: item.quantity,
      }))
      .filter((item) => item.title);
    if (!title.trim()) {
      setMessage('请填写模板名称');
      return;
    }
    if (!normalizedItems.length || normalizedItems.length !== items.length) {
      setMessage('请填写每一个模板清单项');
      return;
    }
    setMessage(null);
    try {
      const input = {
        title: title.trim(),
        description: description.trim() || null,
        items: normalizedItems,
      };
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          expectedVersion: editing.version,
          ...input,
        });
      } else {
        await create.mutateAsync(input);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，请稍后再试');
    }
  };
  const loading = create.isPending || update.isPending;

  return (
    <FormModal
      onClose={onClose}
      title={editing ? '编辑打包模板' : '新建打包模板'}
      visible={visible}
    >
      <ScrollView
        contentContainerStyle={styles.formContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.field}>
          <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>模板名称</Text>
          <TextInput
            accessibilityLabel="模板名称"
            maxLength={120}
            onChangeText={setTitle}
            placeholder="周末短途、带娃出行或自驾"
            placeholderTextColor={c.tertiaryLabel}
            style={[t.body, styles.input, { backgroundColor: c.fill, color: c.label }]}
            value={title}
          />
        </View>
        <View style={styles.field}>
          <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>说明</Text>
          <TextInput
            accessibilityLabel="模板说明"
            maxLength={500}
            onChangeText={setDescription}
            placeholder="适用场景"
            placeholderTextColor={c.tertiaryLabel}
            style={[t.body, styles.input, { backgroundColor: c.fill, color: c.label }]}
            value={description}
          />
        </View>
        <View style={styles.templateItemsHeader}>
          <Text style={[t.footnote, styles.fieldLabel, { color: c.secondaryLabel }]}>模板清单</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              setItems((current) => [
                ...current,
                { key: draftKey(), title: '', category: 'supplies', quantity: 1 },
              ])
            }
            style={styles.inlineAction}
          >
            <Plus color={c.tint} size={15} />
            <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>添加一项</Text>
          </Pressable>
        </View>
        {items.map((item, index) => (
          <View
            key={item.key}
            style={[styles.templateDraft, { borderColor: c.separator }]}
          >
            <View style={styles.templateDraftTop}>
              <TextInput
                accessibilityLabel={`模板清单项${index + 1}`}
                maxLength={120}
                onChangeText={(value) => updateDraft(item.key, { title: value })}
                placeholder={`第 ${index + 1} 项`}
                placeholderTextColor={c.tertiaryLabel}
                style={[t.body, styles.draftInput, { backgroundColor: c.fill, color: c.label }]}
                value={item.title}
              />
              <Pressable
                accessibilityLabel={`移除模板清单项${index + 1}`}
                accessibilityRole="button"
                disabled={items.length === 1}
                onPress={() =>
                  setItems((current) => current.filter((entry) => entry.key !== item.key))
                }
                style={[styles.iconButton, { opacity: items.length === 1 ? 0.35 : 1 }]}
              >
                <Trash2 color={c.red} size={17} />
              </Pressable>
            </View>
            <CategorySelector
              onChange={(category) => updateDraft(item.key, { category })}
              value={item.category}
            />
            <QuantityStepper
              onChange={(quantity) => updateDraft(item.key, { quantity })}
              value={item.quantity}
            />
          </View>
        ))}
        {message ? <Text style={[t.footnote, { color: c.red }]}>{message}</Text> : null}
        <View style={styles.formActions}>
          <Pressable
            accessibilityRole="button"
            disabled={loading}
            onPress={onClose}
            style={[styles.cancelButton, { backgroundColor: c.fill }]}
          >
            <Text style={[t.headline, { color: c.label }]}>取消</Text>
          </Pressable>
          <PrimaryButton
            loading={loading}
            onPress={() => void submit()}
            style={styles.saveButton}
            title={editing ? '保存模板' : '创建模板'}
          />
        </View>
      </ScrollView>
    </FormModal>
  );
}

function ApplyTemplateModal({
  onClose,
  onSelect,
  plan,
  templates,
  visible,
}: {
  onClose: () => void;
  onSelect: (template: TravelPackingTemplate) => void;
  plan: TravelPlan | null;
  templates: TravelPackingTemplate[];
  visible: boolean;
}) {
  const c = useTheme();
  return (
    <FormModal onClose={onClose} title="应用打包模板" visible={visible}>
      <ScrollView contentContainerStyle={styles.formContent} showsVerticalScrollIndicator={false}>
        {templates.length ? (
          templates.map((template) => {
            const applied = plan?.appliedTemplateIds.includes(template.id) ?? false;
            return (
              <Pressable
                accessibilityRole="button"
                disabled={applied}
                key={template.id}
                onPress={() => onSelect(template)}
                style={({ pressed }) => [
                  styles.templateChoice,
                  {
                    backgroundColor: pressed ? c.fillStrong : c.fill,
                    opacity: applied ? 0.5 : 1,
                  },
                ]}
              >
                <Layers3 color={c.tint} size={19} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[t.subhead, { color: c.label, fontWeight: '700' }]}>{template.title}</Text>
                  <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>
                    {template.items.length} 项{applied ? ' · 已应用' : ''}
                  </Text>
                </View>
                {!applied ? <ChevronRight color={c.tertiaryLabel} size={18} /> : null}
              </Pressable>
            );
          })
        ) : (
          <EmptyState emoji="🧳" title="还没有打包模板" hint="先在模板页创建家庭常用模板" />
        )}
      </ScrollView>
    </FormModal>
  );
}

function PlanCard({ onOpen, plan }: { onOpen: () => void; plan: TravelPlan }) {
  const c = useTheme();
  const progress = plan.counts.total
    ? Math.round((plan.counts.completed / plan.counts.total) * 100)
    : 0;
  const statusColor =
    plan.status === 'completed'
      ? c.green
      : plan.status === 'cancelled' || plan.archivedAt
        ? c.secondaryLabel
        : c.tint;
  return (
    <Pressable accessibilityRole="button" onPress={onOpen}>
      {({ pressed }) => (
        <Card style={[styles.planCard, { opacity: pressed ? 0.75 : 1 }]}>
          <View style={[styles.planIcon, { backgroundColor: c.tintSoft }]}>
            <Plane color={c.tint} size={22} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.cardTitleRow}>
              <Text numberOfLines={1} style={[t.headline, { color: c.label, flex: 1 }]}>{plan.title}</Text>
              <Text style={[t.caption, { color: statusColor, fontWeight: '700' }]}>{planStatus(plan)}</Text>
            </View>
            <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 5 }]}>{planDates(plan)}</Text>
            {plan.destination ? (
              <View style={styles.metaLine}>
                <MapPin color={c.tertiaryLabel} size={13} />
                <Text numberOfLines={1} style={[t.caption, { color: c.tertiaryLabel }]}>{plan.destination}</Text>
              </View>
            ) : null}
            <View style={styles.progressLine}>
              <View style={[styles.progressTrack, { backgroundColor: c.fillStrong }]}>
                <View style={[styles.progressBar, { backgroundColor: c.green, width: `${progress}%` }]} />
              </View>
              <Text style={[t.caption, { color: c.secondaryLabel }]}>
                {plan.counts.completed}/{plan.counts.total}
              </Text>
            </View>
          </View>
          <ChevronRight color={c.tertiaryLabel} size={20} />
        </Card>
      )}
    </Pressable>
  );
}

function ChecklistRow({
  editable,
  item,
  onArchive,
  onEdit,
  onSkip,
  onToggle,
}: {
  editable: boolean;
  item: TravelChecklistItem;
  onArchive: () => void;
  onEdit: () => void;
  onSkip: () => void;
  onToggle: () => void;
}) {
  const c = useTheme();
  const completed = item.status === 'completed';
  const skipped = item.status === 'skipped';
  return (
    <View style={[styles.itemRow, { borderBottomColor: c.separator }]}>
      <Pressable
        accessibilityLabel={`${completed ? '恢复' : '完成'}${item.title}`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: completed }}
        disabled={!editable}
        onPress={onToggle}
        style={[styles.checkButton, { opacity: editable ? 1 : 0.6 }]}
      >
        {completed ? (
          <View style={[styles.checkedCircle, { backgroundColor: c.green }]}>
            <Check color="#FFFFFF" size={15} />
          </View>
        ) : skipped ? (
          <SkipForward color={c.secondaryLabel} size={21} />
        ) : (
          <Circle color={c.tertiaryLabel} size={22} />
        )}
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.itemTitleLine}>
          <Text style={{ fontSize: 16 }}>{CATEGORY_META[item.category].emoji}</Text>
          <Text
            numberOfLines={2}
            style={[
              t.subhead,
              {
                color: completed || skipped ? c.secondaryLabel : c.label,
                fontWeight: '700',
                textDecorationLine: completed ? 'line-through' : 'none',
                flex: 1,
              },
            ]}
          >
            {item.title}{item.quantity > 1 ? ` × ${item.quantity}` : ''}
          </Text>
        </View>
        <Text style={[t.caption, { color: c.tertiaryLabel, marginTop: 3 }]}>
          {item.assignedMember
            ? `${item.assignedMember.avatarEmoji} ${item.assignedMember.name}`
            : '未分配'}
          {item.note ? ` · ${item.note}` : ''}
        </Text>
      </View>
      {editable ? <View style={styles.itemActions}>
        {!completed && !skipped ? (
          <Pressable
            accessibilityLabel={`跳过${item.title}`}
            accessibilityRole="button"
            onPress={onSkip}
            style={styles.smallIconButton}
          >
            <SkipForward color={c.secondaryLabel} size={16} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityLabel={`编辑${item.title}`}
          accessibilityRole="button"
          onPress={onEdit}
          style={styles.smallIconButton}
        >
          <Pencil color={c.tint} size={15} />
        </Pressable>
        <Pressable
          accessibilityLabel={`移除${item.title}`}
          accessibilityRole="button"
          onPress={onArchive}
          style={styles.smallIconButton}
        >
          <Trash2 color={c.red} size={15} />
        </Pressable>
      </View> : null}
    </View>
  );
}

export default function TravelScreen() {
  const c = useTheme();
  const desktop = useDesktopLayout();
  const router = useRouter();
  const params = useLocalSearchParams<{ planId?: string; view?: string }>();
  const paramPlanId = firstParam(params.planId);
  const paramView = firstParam(params.view);
  const [view, setView] = useState<MainView>(paramView === 'templates' ? 'templates' : 'plans');
  const [planFilter, setPlanFilter] = useState<PlanFilter>('active');
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(paramPlanId ?? null);
  const [planFormOpen, setPlanFormOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<TravelPlan | null>(null);
  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<TravelChecklistItem | null>(null);
  const [templateFormOpen, setTemplateFormOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TravelPackingTemplate | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<TravelPackingTemplate | null>(null);
  const [pendingPlanAction, setPendingPlanAction] = useState<
    'complete' | 'reopen' | 'cancel' | 'archive' | 'restore' | null
  >(null);
  const [pendingItemAction, setPendingItemAction] = useState<{
    item: TravelChecklistItem;
    action: 'skip' | 'archive';
  } | null>(null);
  const [pendingTemplateAction, setPendingTemplateAction] = useState<{
    template: TravelPackingTemplate;
    action: 'archive' | 'restore';
  } | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { data: plans, isLoading: plansLoading, error: plansError } = useTravelPlans(planFilter);
  const { data: selectedPlan, isLoading: planLoading } = useTravelPlan(selectedPlanId);
  const { data: templates, isLoading: templatesLoading } = useTravelTemplates('all');
  const { data: members } = useMembers();
  const planAction = useTravelPlanAction();
  const itemAction = useTravelItemAction();
  const templateAction = useTravelTemplateAction();
  const applyTemplate = useApplyTravelTemplate();

  useEffect(() => {
    setSelectedPlanId(paramPlanId ?? null);
  }, [paramPlanId]);

  useEffect(() => {
    if (paramView === 'templates') setView('templates');
  }, [paramView]);

  const activeTemplates = useMemo(
    () => templates?.filter((template) => !template.archivedAt) ?? [],
    [templates],
  );

  const openPlan = (plan: TravelPlan) => {
    setSelectedPlanId(plan.id);
    router.replace({ pathname: '/travel', params: { planId: plan.id } });
  };

  const closePlan = () => {
    setSelectedPlanId(null);
    router.replace('/travel');
  };

  const showSuccess = (message: string) => {
    setSuccess(message);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const runItemToggle = async (item: TravelChecklistItem) => {
    if (!selectedPlan) return;
    try {
      await itemAction.mutateAsync({
        planId: selectedPlan.id,
        item,
        action: item.status === 'pending' ? 'complete' : 'restore',
      });
      showSuccess(item.status === 'pending' ? '清单项已完成' : '清单项已恢复');
    } catch (error) {
      Alert.alert('操作失败', error instanceof Error ? error.message : '请稍后再试');
    }
  };

  const confirmPlanAction = async () => {
    if (!selectedPlan || !pendingPlanAction) return;
    try {
      await planAction.mutateAsync({
        id: selectedPlan.id,
        action: pendingPlanAction,
        expectedVersion: selectedPlan.version,
      });
      showSuccess('行程状态已更新');
      setPendingPlanAction(null);
    } catch (error) {
      setPendingPlanAction(null);
      Alert.alert('操作失败', error instanceof Error ? error.message : '请稍后再试');
    }
  };

  const confirmItemAction = async () => {
    if (!selectedPlan || !pendingItemAction) return;
    try {
      await itemAction.mutateAsync({
        planId: selectedPlan.id,
        item: pendingItemAction.item,
        action: pendingItemAction.action,
      });
      showSuccess(pendingItemAction.action === 'skip' ? '清单项已跳过' : '清单项已移除');
      setPendingItemAction(null);
    } catch (error) {
      setPendingItemAction(null);
      Alert.alert('操作失败', error instanceof Error ? error.message : '请稍后再试');
    }
  };

  const confirmTemplateAction = async () => {
    if (!pendingTemplateAction) return;
    try {
      await templateAction.mutateAsync({
        id: pendingTemplateAction.template.id,
        action: pendingTemplateAction.action,
        expectedVersion: pendingTemplateAction.template.version,
      });
      showSuccess(pendingTemplateAction.action === 'archive' ? '模板已归档' : '模板已恢复');
      setPendingTemplateAction(null);
    } catch (error) {
      setPendingTemplateAction(null);
      Alert.alert('操作失败', error instanceof Error ? error.message : '请稍后再试');
    }
  };

  const confirmApplyTemplate = async () => {
    if (!selectedPlan || !pendingTemplate) return;
    try {
      await applyTemplate.mutateAsync({ plan: selectedPlan, template: pendingTemplate });
      showSuccess(`已添加 ${pendingTemplate.items.length} 项清单`);
      setPendingTemplate(null);
      setApplyOpen(false);
    } catch (error) {
      setPendingTemplate(null);
      Alert.alert('应用失败', error instanceof Error ? error.message : '请稍后再试');
    }
  };

  const planActionCopy = pendingPlanAction && selectedPlan
    ? {
        complete: {
          title: '完成这个行程？',
          label: '确认完成',
          message: `预计将「${selectedPlan.title}」标记为已完成。当前 ${selectedPlan.counts.completed} 项完成、${selectedPlan.counts.skipped} 项跳过、${selectedPlan.counts.pending} 项待处理。`,
        },
        reopen: {
          title: '重新打开行程？',
          label: '重新打开',
          message: '行程会恢复为计划中，原先已取消的提醒不会自动恢复。',
        },
        cancel: {
          title: '取消这个行程？',
          label: '确认取消',
          message: '行程会保留，尚未发送的相关提醒将取消。',
        },
        archive: {
          title: '归档这个行程？',
          label: '确认归档',
          message: '行程和清单历史会保留，并从使用中列表与日历隐藏。',
        },
        restore: {
          title: '恢复这个行程？',
          label: '确认恢复',
          message: '行程会重新出现在对应状态列表中，提醒不会自动恢复。',
        },
      }[pendingPlanAction]
    : null;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <PageContainer maxWidth={1120} style={[styles.page, desktop && styles.pageDesktop]}>
          {selectedPlanId ? (
            <>
              <View style={styles.detailHeader}>
                <Pressable accessibilityRole="button" onPress={closePlan} style={styles.backButton}>
                  <X color={c.secondaryLabel} size={18} />
                  <Text style={[t.footnote, { color: c.secondaryLabel, fontWeight: '700' }]}>返回出行列表</Text>
                </Pressable>
              </View>
              {planLoading || !selectedPlan ? (
                <ActivityIndicator color={c.tint} style={styles.loader} />
              ) : (
                <>
                  <View style={[styles.planHeading, desktop && styles.planHeadingDesktop]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={styles.headingTitleLine}>
                        <Text style={[desktop ? t.largeTitle : t.title1, { color: c.label, flex: 1 }]}>{selectedPlan.title}</Text>
                        <View style={[styles.statusBadge, { backgroundColor: c.tintSoft }]}>
                          <Text style={[t.caption, { color: c.tint, fontWeight: '700' }]}>{planStatus(selectedPlan)}</Text>
                        </View>
                      </View>
                      <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 6 }]}>{planDates(selectedPlan)}</Text>
                      {selectedPlan.destination ? (
                        <View style={styles.metaLine}>
                          <MapPin color={c.tertiaryLabel} size={14} />
                          <Text style={[t.footnote, { color: c.tertiaryLabel }]}>{selectedPlan.destination}</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.headingActions}>
                      {selectedPlan.status === 'planned' && !selectedPlan.archivedAt ? (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => router.push(`/reminders?sourceModule=travel&sourceId=${selectedPlan.id}`)}
                          style={[styles.outlineButton, { borderColor: c.separator }]}
                        >
                          <BellPlus color={c.tint} size={17} />
                          <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>设置提醒</Text>
                        </Pressable>
                      ) : null}
                      {selectedPlan.canManage && !selectedPlan.archivedAt && selectedPlan.status === 'planned' ? (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => {
                            setEditingPlan(selectedPlan);
                            setPlanFormOpen(true);
                          }}
                          style={[styles.outlineButton, { borderColor: c.separator }]}
                        >
                          <Pencil color={c.tint} size={16} />
                          <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>编辑</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>

                  {success ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setSuccess(null)}
                      style={[styles.successBanner, { backgroundColor: c.greenSoft }]}
                    >
                      <Check color={c.green} size={17} />
                      <Text style={[t.footnote, { color: c.green, fontWeight: '700', flex: 1 }]}>{success}</Text>
                      <X color={c.green} size={14} />
                    </Pressable>
                  ) : null}

                  <View style={[styles.detailGrid, desktop && styles.detailGridDesktop]}>
                    <View style={styles.checklistColumn}>
                      <View style={styles.sectionHeader}>
                        <View>
                          <Text style={[t.title2, { color: c.label }]}>出行清单</Text>
                          <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>
                            {selectedPlan.counts.completed} 完成 · {selectedPlan.counts.pending} 待处理 · {selectedPlan.counts.skipped} 跳过
                          </Text>
                        </View>
                        {selectedPlan.canEditChecklist ? (
                          <View style={styles.sectionActions}>
                            <Pressable
                              accessibilityRole="button"
                              disabled={!activeTemplates.length}
                              onPress={() => setApplyOpen(true)}
                              style={[styles.outlineButton, { borderColor: c.separator, opacity: activeTemplates.length ? 1 : 0.5 }]}
                            >
                              <Layers3 color={c.tint} size={16} />
                              <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>应用模板</Text>
                            </Pressable>
                            <Pressable
                              accessibilityRole="button"
                              onPress={() => {
                                setEditingItem(null);
                                setItemFormOpen(true);
                              }}
                              style={[styles.addButton, { backgroundColor: c.tint }]}
                            >
                              <Plus color="#FFFFFF" size={17} />
                              <Text style={[t.footnote, { color: '#FFFFFF', fontWeight: '700' }]}>添加</Text>
                            </Pressable>
                          </View>
                        ) : null}
                      </View>
                      <Card style={styles.checklistCard}>
                        {selectedPlan.items.length ? (
                          selectedPlan.items.map((item) => (
                            <ChecklistRow
                              editable={selectedPlan.canEditChecklist}
                              item={item}
                              key={item.id}
                              onArchive={() => setPendingItemAction({ item, action: 'archive' })}
                              onEdit={() => {
                                setEditingItem(item);
                                setItemFormOpen(true);
                              }}
                              onSkip={() => setPendingItemAction({ item, action: 'skip' })}
                              onToggle={() => void runItemToggle(item)}
                            />
                          ))
                        ) : (
                          <EmptyState emoji="🧳" title="清单还是空的" hint="可以添加清单项或应用家庭模板" />
                        )}
                      </Card>
                    </View>

                    <View style={styles.summaryColumn}>
                      <Card style={styles.summaryCard}>
                        <View style={styles.summaryTitle}>
                          <ListChecks color={c.tint} size={20} />
                          <Text style={[t.headline, { color: c.label }]}>准备进度</Text>
                        </View>
                        <View style={styles.countGrid}>
                          {[
                            ['待处理', selectedPlan.counts.pending, c.orange],
                            ['已完成', selectedPlan.counts.completed, c.green],
                            ['已跳过', selectedPlan.counts.skipped, c.secondaryLabel],
                          ].map(([label, count, color]) => (
                            <View key={String(label)} style={[styles.countCell, { backgroundColor: c.fill }]}>
                              <Text style={[t.title2, { color: String(color) }]}>{String(count)}</Text>
                              <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 2 }]}>{String(label)}</Text>
                            </View>
                          ))}
                        </View>
                        {selectedPlan.note ? (
                          <Text style={[t.footnote, { color: c.secondaryLabel, lineHeight: 20 }]}>{selectedPlan.note}</Text>
                        ) : null}
                        <View style={[styles.creatorLine, { borderTopColor: c.separator }]}>
                          <UserRound color={c.tertiaryLabel} size={14} />
                          <Text style={[t.caption, { color: c.tertiaryLabel }]}>{selectedPlan.createdBy.name} 创建</Text>
                        </View>
                      </Card>
                      {selectedPlan.canManage ? (
                        <View style={styles.planActions}>
                          {!selectedPlan.archivedAt && selectedPlan.status === 'planned' ? (
                            <>
                              <PrimaryButton onPress={() => setPendingPlanAction('complete')} title="完成行程" />
                              <Pressable
                                accessibilityRole="button"
                                onPress={() => setPendingPlanAction('cancel')}
                                style={[styles.secondaryAction, { backgroundColor: c.fill }]}
                              >
                                <X color={c.red} size={17} />
                                <Text style={[t.subhead, { color: c.red, fontWeight: '700' }]}>取消行程</Text>
                              </Pressable>
                            </>
                          ) : null}
                          {!selectedPlan.archivedAt && selectedPlan.status !== 'planned' ? (
                            <Pressable
                              accessibilityRole="button"
                              onPress={() => setPendingPlanAction('reopen')}
                              style={[styles.secondaryAction, { backgroundColor: c.fill }]}
                            >
                              <RotateCcw color={c.tint} size={17} />
                              <Text style={[t.subhead, { color: c.tint, fontWeight: '700' }]}>重新打开</Text>
                            </Pressable>
                          ) : null}
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => setPendingPlanAction(selectedPlan.archivedAt ? 'restore' : 'archive')}
                            style={[styles.secondaryAction, { backgroundColor: c.fill }]}
                          >
                            {selectedPlan.archivedAt ? <RotateCcw color={c.tint} size={17} /> : <Archive color={c.secondaryLabel} size={17} />}
                            <Text style={[t.subhead, { color: selectedPlan.archivedAt ? c.tint : c.secondaryLabel, fontWeight: '700' }]}>
                              {selectedPlan.archivedAt ? '恢复行程' : '归档行程'}
                            </Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </>
              )}
            </>
          ) : (
            <>
              <View style={[styles.pageHeader, desktop && styles.pageHeaderDesktop]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[desktop ? t.largeTitle : t.title1, { color: c.label }]}>家庭出行</Text>
                  <Text style={[t.subhead, { color: c.secondaryLabel, marginTop: 5 }]}>行程、打包清单与家庭分工</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    if (view === 'plans') {
                      setEditingPlan(null);
                      setPlanFormOpen(true);
                    } else {
                      setEditingTemplate(null);
                      setTemplateFormOpen(true);
                    }
                  }}
                  style={[styles.addButtonLarge, { backgroundColor: c.tint }]}
                >
                  <Plus color="#FFFFFF" size={18} />
                  <Text style={[t.subhead, { color: '#FFFFFF', fontWeight: '700' }]}>{view === 'plans' ? '新建行程' : '新建模板'}</Text>
                </Pressable>
              </View>
              <View style={styles.mainSegment}>
                <Segmented<MainView>
                  onChange={(next) => {
                    setView(next);
                    router.replace(next === 'templates' ? '/travel?view=templates' : '/travel');
                  }}
                  options={[
                    { label: '行程', value: 'plans' },
                    { label: '打包模板', value: 'templates' },
                  ]}
                  value={view}
                />
              </View>
              {success ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setSuccess(null)}
                  style={[styles.successBanner, { backgroundColor: c.greenSoft }]}
                >
                  <Check color={c.green} size={17} />
                  <Text style={[t.footnote, { color: c.green, fontWeight: '700', flex: 1 }]}>{success}</Text>
                  <X color={c.green} size={14} />
                </Pressable>
              ) : null}
              {view === 'plans' ? (
                <>
                  <View style={styles.filterWrap}>
                    <Segmented<PlanFilter>
                      onChange={setPlanFilter}
                      options={[
                        { label: '计划中', value: 'active' },
                        { label: '已完成', value: 'completed' },
                        { label: '已取消', value: 'cancelled' },
                        { label: '已归档', value: 'archived' },
                      ]}
                      value={planFilter}
                    />
                  </View>
                  {plansLoading ? <ActivityIndicator color={c.tint} style={styles.loader} /> : null}
                  {plansError ? <Card><EmptyState emoji="✈️" title="出行计划加载失败" hint="请检查 API 服务" /></Card> : null}
                  {!plansLoading && !plansError && plans?.length ? (
                    <View style={[styles.planGrid, desktop && styles.planGridDesktop]}>
                      {plans.map((plan) => <PlanCard key={plan.id} onOpen={() => openPlan(plan)} plan={plan} />)}
                    </View>
                  ) : null}
                  {!plansLoading && !plansError && !plans?.length ? (
                    <Card><EmptyState emoji="✈️" title="没有匹配的出行计划" hint="新行程会在这里集中准备" /></Card>
                  ) : null}
                </>
              ) : (
                <>
                  {templatesLoading ? <ActivityIndicator color={c.tint} style={styles.loader} /> : null}
                  {!templatesLoading && templates?.length ? (
                    <View style={[styles.templateGrid, desktop && styles.templateGridDesktop]}>
                      {templates.map((template) => (
                        <Card key={template.id} style={[styles.templateCard, { opacity: template.archivedAt ? 0.65 : 1 }]}>
                          <View style={styles.templateCardHeader}>
                            <View style={[styles.templateIcon, { backgroundColor: c.tintSoft }]}><Luggage color={c.tint} size={20} /></View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={[t.headline, { color: c.label }]}>{template.title}</Text>
                              <Text style={[t.caption, { color: c.secondaryLabel, marginTop: 3 }]}>{template.items.length} 项 · v{template.version}{template.archivedAt ? ' · 已归档' : ''}</Text>
                            </View>
                          </View>
                          {template.description ? <Text style={[t.footnote, { color: c.secondaryLabel }]}>{template.description}</Text> : null}
                          <View style={styles.templatePreview}>
                            {template.items.slice(0, 6).map((item) => (
                              <View key={item.id} style={[styles.previewRow, { borderBottomColor: c.separator }]}>
                                <Text>{CATEGORY_META[item.category].emoji}</Text>
                                <Text numberOfLines={1} style={[t.footnote, { color: c.label, flex: 1 }]}>{item.title}</Text>
                                {item.quantity > 1 ? <Text style={[t.caption, { color: c.secondaryLabel }]}>×{item.quantity}</Text> : null}
                              </View>
                            ))}
                          </View>
                          {template.canManage ? (
                            <View style={styles.templateActions}>
                              {!template.archivedAt ? (
                                <Pressable
                                  accessibilityRole="button"
                                  onPress={() => {
                                    setEditingTemplate(template);
                                    setTemplateFormOpen(true);
                                  }}
                                  style={[styles.outlineButton, { borderColor: c.separator }]}
                                >
                                  <Pencil color={c.tint} size={15} />
                                  <Text style={[t.footnote, { color: c.tint, fontWeight: '700' }]}>编辑</Text>
                                </Pressable>
                              ) : null}
                              <Pressable
                                accessibilityRole="button"
                                onPress={() => setPendingTemplateAction({ template, action: template.archivedAt ? 'restore' : 'archive' })}
                                style={[styles.outlineButton, { borderColor: c.separator }]}
                              >
                                {template.archivedAt ? <RotateCcw color={c.tint} size={15} /> : <Archive color={c.secondaryLabel} size={15} />}
                                <Text style={[t.footnote, { color: template.archivedAt ? c.tint : c.secondaryLabel, fontWeight: '700' }]}>{template.archivedAt ? '恢复' : '归档'}</Text>
                              </Pressable>
                            </View>
                          ) : null}
                        </Card>
                      ))}
                    </View>
                  ) : null}
                  {!templatesLoading && !templates?.length ? (
                    <Card><EmptyState emoji="🧳" title="还没有打包模板" hint="建立家庭常用清单后可重复使用" /></Card>
                  ) : null}
                </>
              )}
            </>
          )}
        </PageContainer>
      </ScrollView>

      <PlanForm
        editing={editingPlan}
        onClose={() => setPlanFormOpen(false)}
        onSaved={(plan) => {
          setPlanFormOpen(false);
          setEditingPlan(null);
          showSuccess(editingPlan ? '行程已更新' : '行程已创建');
          openPlan(plan);
        }}
        visible={planFormOpen}
      />
      <ItemForm
        editing={editingItem}
        members={members ?? []}
        onClose={() => setItemFormOpen(false)}
        onSaved={() => {
          setItemFormOpen(false);
          setEditingItem(null);
          showSuccess(editingItem ? '清单项已更新' : '清单项已添加');
        }}
        plan={selectedPlan ?? null}
        visible={itemFormOpen}
      />
      <TemplateForm
        editing={editingTemplate}
        onClose={() => setTemplateFormOpen(false)}
        onSaved={() => {
          setTemplateFormOpen(false);
          setEditingTemplate(null);
          showSuccess(editingTemplate ? '模板已更新' : '模板已创建');
        }}
        visible={templateFormOpen}
      />
      <ApplyTemplateModal
        onClose={() => setApplyOpen(false)}
        onSelect={(template) => setPendingTemplate(template)}
        plan={selectedPlan ?? null}
        templates={activeTemplates}
        visible={applyOpen}
      />

      <ConfirmDialog
        confirmLabel={planActionCopy?.label ?? '确认'}
        loading={planAction.isPending}
        message={planActionCopy?.message ?? ''}
        onCancel={() => setPendingPlanAction(null)}
        onConfirm={() => void confirmPlanAction()}
        title={planActionCopy?.title ?? ''}
        visible={Boolean(planActionCopy)}
      />
      <ConfirmDialog
        confirmLabel={pendingItemAction?.action === 'skip' ? '确认跳过' : '确认移除'}
        loading={itemAction.isPending}
        message={pendingItemAction?.action === 'skip' ? `「${pendingItemAction.item.title}」会保留在清单中并标记为已跳过。` : `「${pendingItemAction?.item.title ?? ''}」会从当前清单隐藏，历史操作仍保留。`}
        onCancel={() => setPendingItemAction(null)}
        onConfirm={() => void confirmItemAction()}
        title={pendingItemAction?.action === 'skip' ? '跳过这项？' : '移除这项？'}
        visible={Boolean(pendingItemAction)}
      />
      <ConfirmDialog
        confirmLabel={pendingTemplateAction?.action === 'archive' ? '确认归档' : '确认恢复'}
        loading={templateAction.isPending}
        message={pendingTemplateAction?.action === 'archive' ? '模板会从应用选择中隐藏，已经复制到行程的清单不受影响。' : '模板会重新出现在可应用模板中。'}
        onCancel={() => setPendingTemplateAction(null)}
        onConfirm={() => void confirmTemplateAction()}
        title={pendingTemplateAction?.action === 'archive' ? '归档这个模板？' : '恢复这个模板？'}
        visible={Boolean(pendingTemplateAction)}
      />
      <ConfirmDialog
        confirmLabel="添加到清单"
        loading={applyTemplate.isPending}
        message={`预计向「${selectedPlan?.title ?? ''}」增加 ${pendingTemplate?.items.length ?? 0} 项。每个模板只能应用一次，不会重复添加。`}
        onCancel={() => setPendingTemplate(null)}
        onConfirm={() => void confirmApplyTemplate()}
        title={`应用「${pendingTemplate?.title ?? ''}」？`}
        visible={Boolean(pendingTemplate)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { paddingTop: 22, paddingBottom: 48 },
  pageDesktop: { paddingTop: 32 },
  pageHeader: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 14 },
  pageHeaderDesktop: { alignItems: 'center' },
  addButtonLarge: { minHeight: 44, borderRadius: radius.md, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 7 },
  mainSegment: { maxWidth: 440, marginTop: 24, marginBottom: 18 },
  filterWrap: { maxWidth: 720, marginBottom: 18 },
  loader: { marginVertical: 60 },
  planGrid: { gap: 12 },
  planGridDesktop: { flexDirection: 'row', flexWrap: 'wrap' },
  planCard: { minHeight: 136, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 13, flex: 1, minWidth: 0 },
  planIcon: { width: 46, height: 46, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  progressLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 11 },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  progressBar: { height: 6, borderRadius: 3 },
  detailHeader: { minHeight: 38 },
  backButton: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  planHeading: { marginTop: 12, gap: 16 },
  planHeadingDesktop: { flexDirection: 'row', alignItems: 'flex-start' },
  headingTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusBadge: { minHeight: 26, paddingHorizontal: 9, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  headingActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  outlineButton: { minHeight: 38, paddingHorizontal: 11, borderWidth: 1, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  successBanner: { minHeight: 42, borderRadius: radius.sm, marginTop: 16, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailGrid: { marginTop: 24, gap: 20 },
  detailGridDesktop: { flexDirection: 'row', alignItems: 'flex-start' },
  checklistColumn: { flex: 1.7, minWidth: 0 },
  summaryColumn: { flex: 1, minWidth: 0, gap: 12 },
  sectionHeader: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 },
  sectionActions: { flexDirection: 'row', gap: 7, flexWrap: 'wrap', justifyContent: 'flex-end' },
  addButton: { minHeight: 38, paddingHorizontal: 11, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', gap: 5 },
  checklistCard: { overflow: 'hidden', minHeight: 150 },
  itemRow: { minHeight: 76, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkButton: { width: 42, height: 52, alignItems: 'center', justifyContent: 'center' },
  checkedCircle: { width: 23, height: 23, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  itemTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  itemActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  smallIconButton: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  summaryCard: { padding: 16, gap: 16 },
  summaryTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  countGrid: { flexDirection: 'row', gap: 8 },
  countCell: { flex: 1, minWidth: 0, borderRadius: radius.sm, paddingVertical: 10, alignItems: 'center' },
  creatorLine: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, flexDirection: 'row', alignItems: 'center', gap: 5 },
  planActions: { gap: 8 },
  secondaryAction: { minHeight: 46, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  templateGrid: { gap: 12 },
  templateGridDesktop: { flexDirection: 'row', flexWrap: 'wrap' },
  templateCard: { padding: 16, gap: 14, flex: 1, minWidth: 300, maxWidth: 540 },
  templateCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  templateIcon: { width: 42, height: 42, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  templatePreview: { gap: 0 },
  previewRow: { minHeight: 34, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 8 },
  templateActions: { flexDirection: 'row', gap: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(17, 25, 20, 0.42)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  formSheet: { width: '100%', maxWidth: 620, maxHeight: '92%', borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  formHeader: { minHeight: 70, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconButton: { width: 38, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  formContent: { paddingHorizontal: 20, paddingBottom: 22, gap: 16 },
  field: { gap: 7 },
  fieldLabel: { fontWeight: '600' },
  input: { height: 46, borderRadius: radius.sm, paddingHorizontal: 12 },
  noteInput: { minHeight: 92, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10 },
  noteInputSmall: { minHeight: 72, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10 },
  dateFields: { flexDirection: 'row', gap: 12 },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelButton: { flex: 1, height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  saveButton: { flex: 1 },
  categoryWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  categoryChip: { minHeight: 36, paddingHorizontal: 9, borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
  stepper: { minHeight: 42, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  stepperButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  memberWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  memberChip: { minHeight: 36, paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
  templateItemsHeader: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inlineAction: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 4 },
  templateDraft: { borderWidth: 1, borderRadius: radius.sm, padding: 11, gap: 10 },
  templateDraftTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  draftInput: { flex: 1, minWidth: 0, height: 42, borderRadius: radius.sm, paddingHorizontal: 11 },
  templateChoice: { minHeight: 68, borderRadius: radius.sm, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 11 },
});
