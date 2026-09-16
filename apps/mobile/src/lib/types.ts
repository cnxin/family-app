// 已迁移到 packages/contracts 的域：类型从契约包导入再 re-export，本文件不再手工维护它们
import type {
  ActivityModule,
  AppNotification,
  CalendarEntry,
  CalendarEvent,
  Dish,
  DishCategory,
  DishIngredient,
  DishRecipeStep,
  DishRecipeVariant,
  DishRecipeVariantIngredient,
  DishRecipeVariantLink,
  DishRecipeVariantStep,
  DishReferenceLink,
  DishSkillLevel,
  Ingredient,
  InventoryActionResult,
  InventoryBatch,
  InventoryBatchStatus,
  InventoryCategory,
  InventoryItem,
  InventoryTransaction,
  InventoryTransactionType,
  MemberDishSkill,
  MenuInventoryPreview,
  RecipeDish,
  ShoppingInventoryPreview,
  ShoppingItem,
  HouseholdPoll,
  HouseholdReminder,
  HouseholdTask,
  PointsAccount,
  PointsLedger,
  PointsLedgerType,
  PollCategory,
  PollOptionResult,
  PollStatus,
  PollVoteMode,
  ReminderRecipient,
  MediaType,
  MediaMetadataSource,
  MediaMetadataExternalProvider,
  MediaSourceSearchStatus,
  HouseholdMediaStatus,
  MediaExternalRef,
  MediaSearchResult,
  MediaSearchResponse,
  MediaSourceConfig,
  MediaTitle,
  HouseholdMedia,
  MediaConnectorKind,
  MediaConnectorState,
  MediaConnectorSummary,
  MediaConnectorSettings,
  MediaPlaybackUserDirectory,
  MoviePilotWebhookResult,
  PlaybackWebhookResult,
  ViewingSessionStatus,
  ViewingSession,
  ViewingProgress,
  MediaLibraryMatch,
  MediaLibraryAvailability,
  MediaLibraryItem,
  MediaLibraryResponse,
  MediaLibrarySyncResponse,
  MediaRequestStatus,
  MediaRequest,
  BackupScheduleFrequency,
  BackupCapacityStatus,
  BackupRunKind,
  BackupRunStatus,
  BackupPolicy,
  BackupRun,
  BackupDashboard,
  KnowledgeArticleCategory,
  KnowledgeRevisionChangeType,
  KnowledgeArticle,
  KnowledgeArticleRevision,
  FamilyMemoryCategory,
  FamilyMemorySourceModule,
  FamilyMemoryPhoto,
  FamilyMemory,
  AssetCategory,
  AssetRenewalIntervalMonths,
  AssetStatus,
  AssetDocumentType,
  AssetDocument,
  MaintenancePlan,
  MaintenanceConsumable,
  MaintenanceConsumableSnapshot,
  MaintenanceRecord,
  HomeAsset,
  MaintenanceCompletionResult,
  MaintenanceConsumablesPreview,
  MaintenanceShoppingResult,
  Guest,
  VisitStatus,
  GuestWifiSecurity,
  GuestMealRequestStatus,
  GuestWifiProfile,
  GuestInvitation,
  CreatedGuestInvitation,
  Visit,
  GuestInvitationPreview,
  GuestMealRequest,
  GuestMealOption,
  GuestMoviePoll,
  TravelPlanStatus,
  TravelChecklistStatus,
  TravelChecklistCategory,
  TravelChecklistItem,
  TravelPlan,
  TravelTemplateItem,
  TravelPackingTemplate,
  ReminderSource,
  ReminderSourceModule,
  ReminderStatus,
  Reward,
  RewardRedemption,
  RewardRedemptionStatus,
  TaskInstanceStatus,
  TaskOccurrence,
  TaskRecurrence,
  DishRecipeSnapshot,
  HouseholdActivity,
  MealType,
  Menu,
  MenuDateCount,
  MenuEvent,
  MenuEventType,
  MenuItem,
  MenuItemStatus,
  NotificationChannel,
  NotificationChannelKind,
  NotificationChannelPreference,
  NotificationDelivery,
  NotificationDeliveryAttempt,
  NotificationDeliveryStatus,
  NotificationModule,
  AccountProfile,
  CreatedHouseholdInvitation,
  FinanceAccount,
  FinanceAccountType,
  FinanceBudget,
  FinanceCategory,
  FinanceCategoryKind,
  FinancePosting,
  FinanceSummary,
  FinanceTransaction,
  FinanceTransactionType,
  HouseholdInvitation,
  InvitationPreview,
  ManagedMember,
  SmartMenuCandidate,
  SmartMenuPlan,
} from '@family/contracts';

// 菜品 / 菜谱 / 购物 / 库存域类型已迁到 packages/contracts
export type {
  Dish,
  DishCategory,
  DishIngredient,
  DishRecipeStep,
  DishRecipeVariant,
  DishRecipeVariantIngredient,
  DishRecipeVariantLink,
  DishRecipeVariantStep,
  DishReferenceLink,
  DishSkillLevel,
  Ingredient,
  InventoryActionResult,
  InventoryBatch,
  InventoryBatchStatus,
  InventoryCategory,
  InventoryItem,
  InventoryTransaction,
  InventoryTransactionType,
  MemberDishSkill,
  MenuInventoryPreview,
  RecipeDish,
  ShoppingInventoryPreview,
  ShoppingItem,
};

// 菜单 / 通知 / 活动域类型已迁到 packages/contracts
export type {
  ActivityModule,
  AppNotification,
  DishRecipeSnapshot,
  HouseholdActivity,
  MealType,
  Menu,
  MenuDateCount,
  MenuEvent,
  MenuEventType,
  MenuItem,
  MenuItemStatus,
  NotificationChannel,
  NotificationChannelKind,
  NotificationChannelPreference,
  NotificationDelivery,
  NotificationDeliveryAttempt,
  NotificationDeliveryStatus,
  NotificationModule,
};

// 账号 / 财务 / 智能菜单域类型已迁到 packages/contracts
export type {
  AccountProfile,
  CreatedHouseholdInvitation,
  FinanceAccount,
  FinanceAccountType,
  FinanceBudget,
  FinanceCategory,
  FinanceCategoryKind,
  FinancePosting,
  FinanceSummary,
  FinanceTransaction,
  FinanceTransactionType,
  HouseholdInvitation,
  InvitationPreview,
  ManagedMember,
  SmartMenuCandidate,
  SmartMenuPlan,
};

export type MemberRole = 'owner' | 'admin' | 'member';
// 出行域类型已迁到 packages/contracts
export type {
  TravelPlanStatus,
  TravelChecklistStatus,
  TravelChecklistCategory,
  TravelChecklistItem,
  TravelPlan,
  TravelTemplateItem,
  TravelPackingTemplate,
};

// 备份运维 / 知识库 / 家庭回忆 域类型已迁到 packages/contracts
export type {
  BackupScheduleFrequency,
  BackupCapacityStatus,
  BackupRunKind,
  BackupRunStatus,
  BackupPolicy,
  BackupRun,
  BackupDashboard,
  KnowledgeArticleCategory,
  KnowledgeRevisionChangeType,
  KnowledgeArticle,
  KnowledgeArticleRevision,
  FamilyMemoryCategory,
  FamilyMemorySourceModule,
  FamilyMemoryPhoto,
  FamilyMemory,
};

export interface Member {
  id: string;
  householdId: string;
  name: string;
  avatarEmoji: string;
  role: MemberRole;
  prefersCooking: boolean;
  disabledAt?: string | null;
  createdAt?: string;
}

export interface AuthSetupStatus {
  initialized: boolean;
}

// 资产维护域类型已迁到 packages/contracts
export type {
  AssetCategory,
  AssetRenewalIntervalMonths,
  AssetStatus,
  AssetDocumentType,
  AssetDocument,
  MaintenancePlan,
  MaintenanceConsumable,
  MaintenanceConsumableSnapshot,
  MaintenanceRecord,
  HomeAsset,
  MaintenanceCompletionResult,
  MaintenanceConsumablesPreview,
  MaintenanceShoppingResult,
};

// 观影与媒体域类型已迁到 packages/contracts
export type {
  MediaType,
  MediaMetadataSource,
  MediaMetadataExternalProvider,
  MediaSourceSearchStatus,
  HouseholdMediaStatus,
  MediaExternalRef,
  MediaSearchResult,
  MediaSearchResponse,
  MediaSourceConfig,
  MediaTitle,
  HouseholdMedia,
  MediaConnectorKind,
  MediaConnectorState,
  MediaConnectorSummary,
  MediaConnectorSettings,
  MediaPlaybackUserDirectory,
  MoviePilotWebhookResult,
  PlaybackWebhookResult,
  ViewingSessionStatus,
  ViewingSession,
  ViewingProgress,
  MediaLibraryMatch,
  MediaLibraryAvailability,
  MediaLibraryItem,
  MediaLibraryResponse,
  MediaLibrarySyncResponse,
  MediaRequestStatus,
  MediaRequest,
};

// 日历域类型已迁到 packages/contracts
export type { CalendarEntry, CalendarEvent };

// 访客域类型已迁到 packages/contracts
export type {
  Guest,
  VisitStatus,
  GuestWifiSecurity,
  GuestMealRequestStatus,
  GuestWifiProfile,
  GuestInvitation,
  CreatedGuestInvitation,
  Visit,
  GuestInvitationPreview,
  GuestMealRequest,
  GuestMealOption,
  GuestMoviePoll,
};

// 任务域类型已迁到 packages/contracts（Zod schema 推导），这里只做 re-export
export type {
  HouseholdTask,
  TaskInstanceStatus,
  TaskOccurrence,
  TaskRecurrence,
};

// 积分与奖励域类型已迁到 packages/contracts
export type {
  PointsAccount,
  PointsLedger,
  PointsLedgerType,
  Reward,
  RewardRedemption,
  RewardRedemptionStatus,
};

// 投票域类型已迁到 packages/contracts（Zod schema 推导），这里只做 re-export
export type {
  HouseholdPoll,
  PollCategory,
  PollOptionResult,
  PollStatus,
  PollVoteMode,
};

// 提醒域类型已迁到 packages/contracts
export type {
  HouseholdReminder,
  ReminderRecipient,
  ReminderSource,
  ReminderSourceModule,
  ReminderStatus,
};

export type AgentRuntimeKind = 'fake' | 'hermes';
export type AgentPageEntityType =
  | 'dish'
  | 'asset'
  | 'knowledge'
  | 'travel'
  | 'poll';

export interface AgentPageContext {
  route: string;
  entityType?: AgentPageEntityType;
  entityId?: string;
  selectedDate?: string;
}

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentRuntimeHealth {
  available: boolean;
  configured: boolean;
  version: string;
  message?: string;
}

export interface AgentStatus {
  enabled: boolean;
  runtimeKind: AgentRuntimeKind;
  selected: AgentRuntimeHealth;
  runtimes: Record<AgentRuntimeKind, AgentRuntimeHealth>;
  fallbackAvailable: boolean;
  persistenceEncrypted: boolean;
  readToolsEnabled: string[];
  proposalToolsEnabled: string[];
}

export interface AgentSettings {
  enabled: boolean;
  runtimeKind: AgentRuntimeKind;
  runtimeProfile: string;
  modelAlias: string;
  retentionDays: number;
  dailyRoutineNotificationLimit: number;
  routineNotificationsEnabled: boolean;
  readToolsEnabled: string[];
  proposalToolsEnabled: string[];
  version: number;
  updatedAt: string;
}

export type AgentRoutineKind = 'nightly_digest' | 'weekly_report';

export interface AgentRoutine {
  id: string;
  kind: AgentRoutineKind;
  enabled: boolean;
  scheduleHour: number;
  scheduleMinute: number;
  lastRunAt: string | null;
  nextRunAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type AgentResponseStyle = 'concise' | 'balanced' | 'detailed';

export interface AgentMemberProfile {
  id: string;
  memberId: string;
  enabled: boolean;
  assistantName: string;
  responseStyle: AgentResponseStyle;
  memoryEnabled: boolean;
  memorySuggestionEnabled: boolean;
  proactiveRoutinesEnabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type AgentMemoryScope = 'member_private' | 'household';
export type AgentMemoryKind =
  | 'preference'
  | 'fact'
  | 'episodic_summary'
  | 'routine_context';
export type AgentMemoryStatus =
  | 'candidate'
  | 'active'
  | 'revoked'
  | 'forgotten'
  | 'expired';
export type AgentMemoryConfidenceSource =
  | 'explicit'
  | 'business'
  | 'summary_candidate';
export type AgentMemoryKey =
  | 'diet_restriction'
  | 'spice_level'
  | 'cooking_skill'
  | 'schedule_preference'
  | 'reply_style'
  | 'other';

export interface AgentMemoryItem {
  id: string;
  ownerMemberId: string;
  scope: AgentMemoryScope;
  kind: AgentMemoryKind;
  category: string;
  memoryKey: AgentMemoryKey;
  content: string | null;
  status: AgentMemoryStatus;
  confidenceSource: AgentMemoryConfidenceSource;
  confirmedByMemberId: string | null;
  validFrom: string | null;
  expiresAt: string | null;
  source: {
    type: string;
    id: string | null;
    conversationId: string | null;
    messageId: string | null;
  };
  visibility: AgentMemoryScope;
  untrustedContent: true;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentMemoryCandidateDto {
  content: string;
  memoryKey: AgentMemoryKey;
  category?: AgentMemoryKey;
  kind?: AgentMemoryKind;
}

export interface AgentMemoryForgetResult {
  id: string;
  forgotten: true;
  status: 'forgotten' | 'expired';
}

export interface AgentMemoryClearResult {
  forgottenCount: number;
}

export interface AgentRun {
  id: string;
  conversationId: string;
  retryOfRunId: string | null;
  runtimeKind: AgentRuntimeKind;
  status: AgentRunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  cancelRequestedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentConversation {
  id: string;
  title: string;
  status: 'active' | 'archived' | 'expired';
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  latestRun: AgentRun | null;
}

export interface AgentMessage {
  id: string;
  runId: string | null;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface AgentToolPresentationItem {
  id: string;
  title: string;
  detail: string;
  status: string;
  targetPath: string;
}

export interface AgentToolPresentation {
  kind:
    | 'tasks'
    | 'shopping'
    | 'meals'
    | 'schedule'
    | 'inventory'
    | 'recipes'
    | 'dish-plan'
    | 'weather'
    | 'member-profile'
    | 'asset-detail'
    | 'finance';
  title: string;
  emptyText: string;
  targetPath: string;
  items: AgentToolPresentationItem[];
  footer?: string;
}

export interface AgentToolEvent {
  id: string;
  runId: string;
  toolName: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  presentation: AgentToolPresentation | null;
}

export type AgentProposalStatus =
  | 'pending'
  | 'confirmed'
  | 'executed'
  | 'rejected'
  | 'expired'
  | 'failed';

export interface AgentActionProposal {
  id: string;
  runId: string;
  actionType: 'task' | 'reminder' | 'poll' | 'menu' | 'shopping' | 'finance';
  actionLabel: string;
  preview: {
    title: string;
    summary: string;
    changes: { label: string; value: string }[];
    targetPath?: string;
    warning?: string;
  };
  status: AgentProposalStatus;
  expiresAt: string;
  confirmedAt: string | null;
  executedAt: string | null;
  resultModule: string | null;
  resultId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type AgentProposalGroupStatus =
  | 'pending'
  | 'confirmed'
  | 'rejected'
  | 'expired'
  | 'failed';

export interface AgentProposalGroupStep extends AgentActionProposal {
  groupId: string;
  stepOrder: number;
}

export interface AgentProposalGroupEvent {
  id: string;
  operation: 'created' | 'confirmed' | 'rejected' | 'expired' | 'failed';
  actorMemberId: string;
  stepCount: number;
  createdAt: string;
}

export interface AgentProposalGroup {
  id: string;
  conversationId: string | null;
  runId: string;
  requestedByMemberId: string;
  title: string;
  summary: string;
  status: AgentProposalGroupStatus;
  confirmedByMemberId: string | null;
  confirmedAt: string | null;
  rejectedAt: string | null;
  expiresAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  steps: AgentProposalGroupStep[];
  events: AgentProposalGroupEvent[];
}

export interface AgentConversationDetail extends AgentConversation {
  messages: AgentMessage[];
  runs: AgentRun[];
  toolEvents: AgentToolEvent[];
  proposals: AgentActionProposal[];
}

export type AgentChannelPairingStatus =
  | 'pending'
  | 'used'
  | 'expired'
  | 'revoked';

export interface AgentMemberChannel {
  id: string;
  memberId: string;
  memberName: string | null;
  platform: string;
  externalAccountLabel: string | null;
  externalAccountHint: string | null;
  pairedAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  version: number;
  canRevoke: boolean;
}

export interface AgentChannelPairing {
  id: string;
  memberId: string;
  memberName: string | null;
  platform: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  channelId: string | null;
  status: AgentChannelPairingStatus;
  version: number;
  createdAt: string;
  pairingCode?: string | null;
  replayed?: boolean;
}
