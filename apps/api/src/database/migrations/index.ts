import { InitialSchema1785226400000 } from './1785226400000-initial-schema';
import { AddHouseholdScope1785226500000 } from './1785226500000-add-household-scope';
import { HardenAuthAndOrders1785226600000 } from './1785226600000-harden-auth-and-orders';
import { AddKitchenCollaboration1785226700000 } from './1785226700000-add-kitchen-collaboration';
import { AddRevocableAuthSessions1785226800000 } from './1785226800000-add-revocable-auth-sessions';
import { SeparateAccountsAndInvitations1785226900000 } from './1785226900000-separate-accounts-and-invitations';
import { AddUnifiedCalendar1785227000000 } from './1785227000000-add-unified-calendar';
import { AddRecipeVariants1785227100000 } from './1785227100000-add-recipe-variants';
import { AddHouseholdTasks1785227200000 } from './1785227200000-add-household-tasks';
import { AddHouseholdPolls1785227300000 } from './1785227300000-add-household-polls';
import { AddConfigurableReminders1785227400000 } from './1785227400000-add-configurable-reminders';
import { AddMembersAndActivity1785227500000 } from './1785227500000-add-members-and-activity';
import { AddMediaWatchlist1785227600000 } from './1785227600000-add-media-watchlist';
import { LinkMediaPolls1785227700000 } from './1785227700000-link-media-polls';
import { AddMediaRequests1785227800000 } from './1785227800000-add-media-requests';
import { AddMediaMetadataSources1785227900000 } from './1785227900000-add-media-metadata-sources';
import { AddHouseholdMediaSourceConfigs1785228000000 } from './1785228000000-add-household-media-source-configs';
import { AddHouseholdIntegrations1785228100000 } from './1785228100000-add-household-integrations';
import { AddMediaPollCandidates1785228200000 } from './1785228200000-add-media-poll-candidates';
import { AddMediaLibraryItems1785228300000 } from './1785228300000-add-media-library-items';
import { AddIntegrationEvents1785228400000 } from './1785228400000-add-integration-events';
import { AddMediaUserMappings1785228500000 } from './1785228500000-add-media-user-mappings';
import { AddViewingHistory1785228600000 } from './1785228600000-add-viewing-history';
import { AddGuestVisits1785228700000 } from './1785228700000-add-guest-visits';
import { AddGuestWifiProfiles1785228800000 } from './1785228800000-add-guest-wifi-profiles';
import { AddGuestMovieVotes1785228900000 } from './1785228900000-add-guest-movie-votes';
import { AddGuestMealRequests1785229000000 } from './1785229000000-add-guest-meal-requests';
import { LinkGuestMealRequestsToMenu1785229100000 } from './1785229100000-link-guest-meal-requests-to-menu';
import { AddGuestAnonymization1785229200000 } from './1785229200000-add-guest-anonymization';
import { LinkInventoryToIngredients1785229300000 } from './1785229300000-link-inventory-to-ingredients';
import { AddInventoryTransactions1785229400000 } from './1785229400000-add-inventory-transactions';
import { AddHomeAssets1785229500000 } from './1785229500000-add-home-assets';
import { AddAssetActivityModule1785229600000 } from './1785229600000-add-asset-activity-module';
import { AddPointsAndRewards1785229700000 } from './1785229700000-add-points-and-rewards';
import { NormalizePointsUniqueIndexes1785229800000 } from './1785229800000-normalize-points-unique-indexes';
import { AddMaintenanceConsumables1785229900000 } from './1785229900000-add-maintenance-consumables';
import { AddExternalNotificationDelivery1785230000000 } from './1785230000000-add-external-notification-delivery';
import { AddBackupOperations1785230100000 } from './1785230100000-add-backup-operations';
import { AddBackupRunNotificationState1785230200000 } from './1785230200000-add-backup-run-notification-state';
import { AddHouseholdKnowledge1785230300000 } from './1785230300000-add-household-knowledge';
import { ConvergeHouseholdKnowledge1785230400000 } from './1785230400000-converge-household-knowledge';
import { AddHouseholdTravel1785230500000 } from './1785230500000-add-household-travel';
import { AddFamilyMemories1785230600000 } from './1785230600000-add-family-memories';
import { AddFamilyAgent1785230700000 } from './1785230700000-add-family-agent';
import { AddAgentActionProposals1785230800000 } from './1785230800000-add-agent-action-proposals';
import { AddAgentChannelBindings1785230900000 } from './1785230900000-add-agent-channel-bindings';
import { NormalizeAgentChannelPairingIndex1785231000000 } from './1785231000000-normalize-agent-channel-pairing-index';
import { LinkAgentMessagesToRuns1785231100000 } from './1785231100000-link-agent-messages-to-runs';
import { AddAgentDailyReadTools1785231200000 } from './1785231200000-add-agent-daily-read-tools';
import { AgentRunRetryPresentations1785231300000 } from './1785231300000-agent-run-retry-presentations';
import { AddFoodBatchesAndSmartMenus1785231400000 } from './1785231400000-add-food-batches-and-smart-menus';
import { AllowAgentToolEventPresentationPurge1785231500000 } from './1785231500000-allow-agent-tool-event-presentation-purge';
import { AddAgentMemberProfiles1785231600000 } from './1785231600000-add-agent-member-profiles';
import { AddAgentMemory1785231700000 } from './1785231700000-add-agent-memory';

export const ALL_MIGRATIONS = [
  InitialSchema1785226400000,
  AddHouseholdScope1785226500000,
  HardenAuthAndOrders1785226600000,
  AddKitchenCollaboration1785226700000,
  AddRevocableAuthSessions1785226800000,
  SeparateAccountsAndInvitations1785226900000,
  AddUnifiedCalendar1785227000000,
  AddRecipeVariants1785227100000,
  AddHouseholdTasks1785227200000,
  AddHouseholdPolls1785227300000,
  AddConfigurableReminders1785227400000,
  AddMembersAndActivity1785227500000,
  AddMediaWatchlist1785227600000,
  LinkMediaPolls1785227700000,
  AddMediaRequests1785227800000,
  AddMediaMetadataSources1785227900000,
  AddHouseholdMediaSourceConfigs1785228000000,
  AddHouseholdIntegrations1785228100000,
  AddMediaPollCandidates1785228200000,
  AddMediaLibraryItems1785228300000,
  AddIntegrationEvents1785228400000,
  AddMediaUserMappings1785228500000,
  AddViewingHistory1785228600000,
  AddGuestVisits1785228700000,
  AddGuestWifiProfiles1785228800000,
  AddGuestMovieVotes1785228900000,
  AddGuestMealRequests1785229000000,
  LinkGuestMealRequestsToMenu1785229100000,
  AddGuestAnonymization1785229200000,
  LinkInventoryToIngredients1785229300000,
  AddInventoryTransactions1785229400000,
  AddHomeAssets1785229500000,
  AddAssetActivityModule1785229600000,
  AddPointsAndRewards1785229700000,
  NormalizePointsUniqueIndexes1785229800000,
  AddMaintenanceConsumables1785229900000,
  AddExternalNotificationDelivery1785230000000,
  AddBackupOperations1785230100000,
  AddBackupRunNotificationState1785230200000,
  AddHouseholdKnowledge1785230300000,
  ConvergeHouseholdKnowledge1785230400000,
  AddHouseholdTravel1785230500000,
  AddFamilyMemories1785230600000,
  AddFamilyAgent1785230700000,
  AddAgentActionProposals1785230800000,
  AddAgentChannelBindings1785230900000,
  NormalizeAgentChannelPairingIndex1785231000000,
  LinkAgentMessagesToRuns1785231100000,
  AddAgentDailyReadTools1785231200000,
  AgentRunRetryPresentations1785231300000,
  AddFoodBatchesAndSmartMenus1785231400000,
  AllowAgentToolEventPresentationPurge1785231500000,
  AddAgentMemberProfiles1785231600000,
  AddAgentMemory1785231700000,
];
