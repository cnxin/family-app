// 实体按域拆在同目录的各文件里（J7.4）；业务代码照旧从 '../entities' 引。
export * from './household';
export * from './assistant';
export * from './recipes';
export * from './menus';
export * from './inventory';
export * from './inventory-ledger';
export * from './points';
export * from './finance';
export * from './finance-plans';
export * from './knowledge';
export * from './memories';
export * from './travel';
export * from './travel-templates';
export * from './tasks';
export * from './polls';
export * from './media';
export * from './integrations';
export * from './media-library';
export * from './reminders';
export * from './assets';
export * from './guests';
export * from './notifications';
export * from './backups';
export * from './agent-settings';
export * from './agent-memory';
export * from './agent-runs';
export * from './agent-channels';
export * from './agent-proposals';
export * from './calendar';
export * from './shopping';
export * from './smart-home';
export * from './locations';

import {
  Account,
  Household,
  Member,
  HouseholdActivityLog,
  AuthSession,
  HouseholdInvitation,
  HouseholdModuleOverride,
} from './household';
import { AssistantUtteranceRecord } from './assistant';
import {
  Ingredient,
  Dish,
  DishIngredient,
  DishRecipeVariant,
  DishRecipeVariantStep,
  DishRecipeVariantLink,
  DishRecipeVariantIngredient,
  MemberDishSkill,
} from './recipes';
import { Menu, MenuItem, MenuEvent, SmartMenuPlan, SmartMenuCandidate } from './menus';
import { InventoryItem, InventoryBatch } from './inventory';
import { InventoryTransaction, InventoryBatchMovement } from './inventory-ledger';
import { PointsAccount, PointsLedger, Reward, RewardRedemption } from './points';
import { FinanceAccount, FinanceCategory, FinanceTransaction, FinancePosting } from './finance';
import {
  FinanceBudget,
  FinanceRecurring,
  FinanceImport,
  FinanceMerchantRule,
} from './finance-plans';
import { KnowledgeArticle, KnowledgeArticleRevision } from './knowledge';
import { FamilyMemory, FamilyMemoryPhoto, FamilyMemoryOperation } from './memories';
import { TravelPlan, TravelChecklistItem, TravelOperation } from './travel';
import {
  TravelPackingTemplate,
  TravelPackingTemplateItem,
  TravelTemplateApplication,
} from './travel-templates';
import { HouseholdTask, HouseholdTaskInstance } from './tasks';
import { Poll, PollOption, PollVote } from './polls';
import {
  MediaTitle,
  MediaExternalRef,
  HouseholdMediaSourceConfig,
  HouseholdMedia,
  MediaRequest,
} from './media';
import { Integration, IntegrationSecret, IntegrationEvent } from './integrations';
import {
  MediaUserMapping,
  MediaLibraryItem,
  ViewingSession,
  ViewingParticipant,
  ViewingProgress,
} from './media-library';
import { Reminder, ReminderRecipient } from './reminders';
import {
  HomeAsset,
  AssetDocument,
  MaintenancePlan,
  MaintenanceRecord,
  MaintenanceConsumable,
} from './assets';
import {
  Guest,
  Visit,
  VisitGuest,
  GuestInvitation,
  GuestWifiProfile,
  GuestPollVote,
  GuestMealRequest,
} from './guests';
import {
  Notification,
  NotificationChannel,
  MemberNotificationPreference,
  NotificationDelivery,
  NotificationDeliveryAttempt,
} from './notifications';
import { BackupPolicy, BackupRun } from './backups';
import { AgentSetting, AgentRoutine, AgentRoutineItem, AgentMemberProfile } from './agent-settings';
import { AgentMemoryItem, AgentMemoryEvent } from './agent-memory';
import { AgentConversation, AgentMessage, AgentRun, AgentToolEvent } from './agent-runs';
import { AgentMemberChannel, AgentChannelPairing } from './agent-channels';
import {
  AgentProposalGroup,
  AgentProposalGroupEvent,
  AgentActionProposal,
} from './agent-proposals';
import { CalendarEvent } from './calendar';
import { ShoppingItem } from './shopping';
import {
  SmartHomeDevice,
  SmartHomeMergeReportRecord,
  SmartHomeCommandRecord,
  SmartHomeWebhookSettings,
  SmartHomeEventRecord,
  SmartHomeLink,
  SmartHomeLinkRun,
} from './smart-home';
import { StorageLocation, HouseholdMap } from './locations';

export const ALL_ENTITIES = [
  AssistantUtteranceRecord,
  HouseholdMap,
  StorageLocation,
  HouseholdModuleOverride,
  SmartHomeLink,
  SmartHomeLinkRun,
  SmartHomeWebhookSettings,
  SmartHomeEventRecord,
  SmartHomeCommandRecord,
  SmartHomeDevice,
  SmartHomeMergeReportRecord,
  Account,
  Household,
  Member,
  HouseholdActivityLog,
  AuthSession,
  HouseholdInvitation,
  Ingredient,
  Dish,
  DishIngredient,
  DishRecipeVariant,
  DishRecipeVariantStep,
  DishRecipeVariantLink,
  DishRecipeVariantIngredient,
  MemberDishSkill,
  Menu,
  MenuItem,
  MenuEvent,
  CalendarEvent,
  Guest,
  Visit,
  VisitGuest,
  GuestInvitation,
  GuestWifiProfile,
  HouseholdTask,
  HouseholdTaskInstance,
  Notification,
  NotificationChannel,
  MemberNotificationPreference,
  NotificationDelivery,
  NotificationDeliveryAttempt,
  Poll,
  PollOption,
  PollVote,
  GuestPollVote,
  GuestMealRequest,
  MediaTitle,
  MediaExternalRef,
  HouseholdMediaSourceConfig,
  Integration,
  IntegrationSecret,
  IntegrationEvent,
  MediaUserMapping,
  MediaLibraryItem,
  ViewingSession,
  ViewingParticipant,
  ViewingProgress,
  HouseholdMedia,
  MediaRequest,
  Reminder,
  ReminderRecipient,
  HomeAsset,
  AssetDocument,
  MaintenancePlan,
  MaintenanceRecord,
  ShoppingItem,
  InventoryItem,
  InventoryBatch,
  MaintenanceConsumable,
  InventoryTransaction,
  InventoryBatchMovement,
  PointsAccount,
  PointsLedger,
  FinanceAccount,
  FinanceCategory,
  FinanceTransaction,
  FinancePosting,
  FinanceBudget,
  FinanceRecurring,
  FinanceImport,
  FinanceMerchantRule,
  Reward,
  RewardRedemption,
  TravelPlan,
  TravelChecklistItem,
  TravelPackingTemplate,
  TravelPackingTemplateItem,
  TravelTemplateApplication,
  TravelOperation,
  KnowledgeArticle,
  KnowledgeArticleRevision,
  FamilyMemory,
  FamilyMemoryPhoto,
  FamilyMemoryOperation,
  BackupPolicy,
  BackupRun,
  AgentSetting,
  AgentRoutine,
  AgentRoutineItem,
  AgentMemberProfile,
  AgentMemberChannel,
  AgentChannelPairing,
  AgentConversation,
  AgentMessage,
  AgentRun,
  AgentToolEvent,
  AgentMemoryItem,
  AgentMemoryEvent,
  AgentProposalGroup,
  AgentProposalGroupEvent,
  AgentActionProposal,
  SmartMenuPlan,
  SmartMenuCandidate,
];
