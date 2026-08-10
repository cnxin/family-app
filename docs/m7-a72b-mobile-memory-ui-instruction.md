# A7.2b 执行指令：移动端「我的 > 小管家记忆」管理页

仓库 https://github.com/cnxin/family-app，分支 uitest。
A7.2 后端已完成（682aa90），文档与勘误见 bc33396 / c4d1f30 / d30fc3b。

**本批只做移动端 UI，不改后端**。在 `apps/mobile` 实现记忆管理页，接入 A7.2 的 7 个端点。
不要做例行任务（A7.4）、页面上下文（A7.3）、多步骤提案（A7.5）。
不要修改 API、不要改 `agent-memory.service.ts`、不要动迁移。

## 已决策事项（出处见审核文档 §8 与附录二、四）

- 第一阶段只有两级范围：`member_private`（我的记忆）和 `household`（家庭共享）。
  不要做 `selected_members`、不要做向量检索、不要做自定义有效期。
- 候选记忆 14 天未确认自动过期，expired 状态不可见。
- episodic_summary 默认 60 天过期，preference 永不过期。
- 记忆功能开关只用 A7.1 的 `agent_member_profiles.memoryEnabled`，
  没有其他 feature flag。
- 共享后不保留私有正文（后端已这样实现，前端只需正确理解行为）。
- memoryKey 是受约束枚举（diet_restriction / spice_level / cooking_skill /
  schedule_preference / reply_style / other），不是自由文本。

## 背景事实（已核查）

1. 路由：expo-router file-based，tabs 在 `apps/mobile/src/app/(tabs)/`。
   现有 `profile.tsx`（我的）、`assistant.tsx`（小管家）。
2. 查询：`apps/mobile/src/lib/queries.ts` 导出 `useXxx()` hooks，
   用 `@tanstack/react-query`。本批需新增 7 个 hook 对应后端 7 个端点。
3. UI 组件：`apps/mobile/src/components/ui.tsx` 提供 `Card`、`SectionHeader`、
   `PressableScale`（0.975 scale + haptic）、`PressSurface`、`IconButton`、
   `AdaptiveDialog`（移动端 bottom sheet，桌面端 modal）、`Segmented`、
   `SkeletonRows`、`ConfirmDialog`。
4. 主题：`apps/mobile/src/lib/theme.ts` 的 `useTheme()` 返回颜色变量
   （`c.bg` / `c.card` / `c.label` / `c.tint` / `c.fill` / `c.separator` 等）；
   `type as t` 导出字体样式（`t.largeTitle` / `t.title1` / `t.body` / `t.footnote` 等）；
   `radius` 常量（`radius.sm` / `radius.md` / `radius.lg` / `radius.full`）。
5. 动效：`react-native-reanimated`，enter 用 `withSpring`（ease-out 感），
   确认操作配 `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)`。
   `useReducedMotion()` 开启时跳过动画。
6. 暗色模式：必须支持，所有颜色从 `useTheme()` 取。
7. 响应式：`useDesktopLayout()` / `useLayoutMode()` 判断宽屏，
   `PageContainer` 自动居中并限制 maxWidth。消费者角色（`member?.role === 'member'`）
   用 720px，管理员用 1040px。
8. 无障碍：触控目标最小 44pt，交互元素必须有 `accessibilityLabel`，
   列表项用 `accessibilityRole="button"`，状态变化用 `accessibilityLiveRegion="polite"`。
9. 现有 `assistant.tsx` 已有 `RuntimeSettings` 组件（家庭级总开关 + runtime 选择），
   在对话页内嵌显示。本批的记忆管理是**成员级**，在「我的」tab 里。

## 任务 1：查询 hooks（`apps/mobile/src/lib/queries.ts`）

新增 7 个 hook，调用后端 7 个端点（方案 §16）：

```typescript
// GET /agent/memories?status=&scope=
export function useAgentMemories(status?: string, scope?: string) {
  return useQuery<AgentMemoryItem[]>({ ... });
}

// POST /agent/memories/candidates
export function useCreateAgentMemoryCandidate() {
  return useMutation<AgentMemoryItem, Error, CreateMemoryCandidateDto>({ ... });
}

// POST /agent/memories/:id/confirm
export function useConfirmAgentMemory() {
  return useMutation<AgentMemoryItem, Error, { id: string; expectedVersion: number }>({ ... });
}

// POST /agent/memories/:id/share
export function useShareAgentMemory() {
  return useMutation<AgentMemoryItem, Error, { id: string; expectedVersion: number }>({ ... });
}

// PATCH /agent/memories/:id
export function useCorrectAgentMemory() {
  return useMutation<AgentMemoryItem, Error, { id: string; content: string; expectedVersion: number }>({ ... });
}

// DELETE /agent/memories/:id
export function useForgetAgentMemory() {
  return useMutation<void, Error, { id: string; expectedVersion: number }>({ ... });
}

// DELETE /agent/memories
export function useClearAgentMemories() {
  return useMutation<{ deleted: number }, Error, void>({ ... });
}
```

查询 key 用 `['agent', 'memories', { status, scope }]`。
写操作成功后 `invalidateQueries(['agent', 'memories'])`。
错误处理沿用现有模式（throw Error，上层 Alert.alert）。

## 任务 2：类型定义（`apps/mobile/src/lib/types.ts`）

新增类型（对应后端 DTO）：

```typescript
export type AgentMemoryScope = 'member_private' | 'household';
export type AgentMemoryKind = 'preference' | 'fact' | 'episodic_summary' | 'routine_context';
export type AgentMemoryStatus = 'candidate' | 'active' | 'revoked' | 'forgotten' | 'expired';
export type AgentMemoryConfidenceSource = 'explicit' | 'business' | 'summary_candidate';

export interface AgentMemoryItem {
  id: string;
  householdId: string;
  ownerMemberId: string;
  scope: AgentMemoryScope;
  kind: AgentMemoryKind;
  category: string;
  memoryKey: string;
  content: string;  // 已解密
  sourceType: string | null;
  sourceId: string | null;
  sourceConversationId: string | null;
  status: AgentMemoryStatus;
  confirmedByMemberId: string | null;
  confidenceSource: AgentMemoryConfidenceSource;
  validFrom: string;
  expiresAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMemoryCandidateDto {
  kind: AgentMemoryKind;
  category: string;
  memoryKey: string;
  content: string;
  sourceType?: string;
  sourceId?: string;
}
```

## 任务 3：记忆管理页（`apps/mobile/src/app/(tabs)/agent-memory.tsx`）

新建文件，路由为 `/agent-memory`（从「我的」或「小管家」导航进入）。

### 布局

- 顶部：大标题「小管家记忆」+ 副标题「管理您的个人偏好与共享知识」
- Segmented 切换：「我的记忆」(member_private) / 「家庭共享」(household)
- 二级 Segmented：「偏好」(preference) / 「事实」(fact) / 「对话摘要」(episodic_summary)
- 列表：每条记忆一个 Card，按 `createdAt` DESC
- 空状态：无记忆时显示引导文案 + Sparkles 图标
- 底部：「清空我的记忆」危险操作按钮（`scope='member_private'` 时可见）

### 记忆卡片

每个 Card 包含：
- 左侧：根据 memoryKey 映射的图标（饮食🍽️ / 口味🌶️ / 厨艺👨‍🍳 / 日程📅 / 回复💬 / 其他💡）
- 主体：
  - 第一行：category（如「饮食偏好」）+ 右上角状态标签（candidate 显示「待确认」橙色 pill）
  - 第二行：content（最多 2 行，超出省略）
  - 第三行：validFrom 时间 + confidenceSource（explicit 显示「您的确认」/ business 显示「业务记录」/ summary_candidate 显示「对话推测」）
- 右侧：ChevronRight 导航箭头

点击进入详情页（任务 4）。

### 交互

- candidate 状态的记忆在列表顶部，背景色用 `c.tintSoft`，带「待确认」pill。
- 「清空我的记忆」按钮用 `ConfirmDialog`，标题「确认清空？」，
  正文「将删除您的所有个人记忆（不含家庭共享），此操作不可撤销。」，
  确认按钮文案「清空」，确认后调 `useClearAgentMemories()`，成功后 haptic + Alert.alert('已清空')。
- scope / kind 切换时列表用 `SkeletonRows` 过渡，不闪白屏。

### 样式要点

- 卡片 padding 14，gap 10，minHeight 82。
- 图标 32x32 圆形背景（`c.fill`），icon size 18，color `c.secondaryLabel`。
- 状态 pill：borderRadius 999，paddingHorizontal 9，paddingVertical 4，
  fontSize 12，fontWeight 600，candidate 用 `#F59E0B` 背景 + 白色文字。
- content 文本：2 行省略，lineHeight 20，color `c.label`。
- 底部按钮：full width，marginTop 20，danger 配色（red tint）。

## 任务 4：记忆详情页（`apps/mobile/src/app/(tabs)/agent-memory/[id].tsx`）

expo-router 动态路由，用 `useLocalSearchParams<{ id: string }>()` 取 id，
调 `useAgentMemories()` 后 `.find(m => m.id === id)` 得详情（或单独封装 `useAgentMemory(id)`）。

### 布局

- 顶部：返回按钮 + 右上角更多菜单（IconButton，三个点，打开 AdaptiveDialog）
- 卡片 1：图标 + category + memoryKey 可读文案（如「饮食限制：素食」）
- 卡片 2：完整 content，可多行，左侧竖线装饰（`c.tint`，2px 宽）
- 卡片 3：元信息
  - 范围：「仅自己可见」或「家庭共享」
  - 来源：confidenceSource 映射 + sourceConversationId（若有）可点击跳转
  - 时间：validFrom + expiresAt（若有）
  - 状态：status 映射（active 绿色「生效中」/ candidate 橙色「待确认」）
- candidate 状态时底部显示两个按钮：「确认」（主按钮）+「忽略」（次按钮）

### 操作菜单（AdaptiveDialog）

- 「修改内容」：打开 TextInput 对话框，预填 content，确认后调 `useCorrectAgentMemory()`
- 「共享到家庭」：仅 scope='member_private' 且 status='active' 时可见，
  ConfirmDialog 确认后调 `useShareAgentMemory()`，
  正文「共享后家庭成员均可见，您的个人版本将被移除。」
- 「遗忘」：ConfirmDialog 确认后调 `useForgetAgentMemory()`，
  正文「遗忘后无法恢复，小管家将不再使用此信息。」

### 交互

- candidate 的「确认」调 `useConfirmAgentMemory()`，成功后 haptic + 返回列表。
- candidate 的「忽略」调 `useForgetAgentMemory()`（candidate 的忽略 = 遗忘），
  ConfirmDialog 正文「忽略后此建议将被移除。」
- 修改内容后 version 自增，若 409 冲突显示「内容已被修改，请刷新后重试」。
- 遗忘成功后返回列表并从缓存移除该项（`queryClient.setQueryData` 手动过滤）。

## 任务 5：导航入口

在 `apps/mobile/src/app/(tabs)/profile.tsx` 的「家庭偏好」section 下方，
新增一个 section「小管家」，包含一个导航项：

```tsx
<PressSurface
  accessibilityLabel="管理小管家记忆"
  onPress={() => router.push('/agent-memory')}
>
  <View style={styles.navRow}>
    <View style={[styles.navIcon, { backgroundColor: c.fill }]}>
      <Sparkles color={c.tint} size={18} />
    </View>
    <View style={{ flex: 1 }}>
      <Text style={[t.body, { color: c.label }]}>我的记忆</Text>
      <Text style={[t.footnote, { color: c.secondaryLabel, marginTop: 3 }]}>
        管理个人偏好与共享知识
      </Text>
    </View>
    <ChevronRight color={c.tertiaryLabel} size={20} />
  </View>
</PressSurface>
```

样式沿用现有 `styles.navRow`（minHeight 64, paddingHorizontal 14, gap 12）。

可选：在 `assistant.tsx` 的 `RuntimeSettings` 旁边也加一个「管理记忆」快捷入口，
但只在 desktop 模式下显示（移动端通过「我的」进入更自然）。

## 任务 6：功能开关联动

读取 `agent_member_profiles.memoryEnabled`（A7.1 已有），
在 `agent-memory.tsx` 顶部显示开关状态：

- 若 `memoryEnabled === false`，列表上方显示通知 Card：
  「记忆功能未启用。小管家不会记录您的偏好，也无法生成个性化建议。」
  + 「前往设置」按钮（跳转到 profile 或 assistant settings）。
- 若 `memoryEnabled === true`，正常显示列表。

开关本身在 profile 或 assistant settings 里已有（A7.1），本批不重复造。

## 任务 7：无障碍与测试

- 所有交互元素必须有 `accessibilityLabel`。
- 列表项 `accessibilityRole="button"`。
- 状态变化（确认、遗忘、清空）后用 `accessibilityLiveRegion="polite"` 通知。
- 最小触控目标 44pt（按钮 minHeight 44，hitSlop 6）。
- 暗色模式下所有颜色从 `useTheme()` 取，不要硬编码 hex。
- 长文本（content）支持多行显示，不要截断到无法阅读。
- 手动测试：Expo Go 扫码 + 真机暗色模式 + VoiceOver / TalkBack。

## 验收

在 `apps/mobile` 下执行（pnpm 用 npx 调）：
- `npx pnpm typecheck`（`tsc --noEmit`）
- `npx pnpm mobile`，Expo Go 真机扫码
- 手动测试流程：
  1. 「我的」> 「我的记忆」进入管理页
  2. 切换「我的记忆」/「家庭共享」，切换 kind
  3. 点击任意记忆进详情，修改内容，确认成功
  4. candidate 记忆：确认 / 忽略
  5. 私有记忆：共享到家庭，确认原记忆消失
  6. 遗忘一条记忆，确认列表移除
  7. 「清空我的记忆」，确认只清自己的
  8. 暗色模式切换，颜色正确
  9. VoiceOver 导航（iOS）或 TalkBack（Android）可用

## 约定

- 提交信息用中文。
- 不要修改 API 代码、不要动迁移、不要改 `agent-memory.service.ts`。
- 图标从 `lucide-react-native` 选，沿用现有风格。
- 日期格式化用 `new Date(value).toLocaleString('zh-CN', {...})`。
- 错误提示用 `Alert.alert`，成功操作配 haptic。
- 代码风格与现有文件一致：functional components，hooks 在顶部，
  样式用 `StyleSheet.create` 放文件底部。

完成后报告改动文件清单、typecheck 输出，以及你认为文档有误或需要澄清的地方。
只报告有证据的分歧，不要推断文档未写明的要求。
