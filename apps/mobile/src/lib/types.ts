export type MemberRole = 'owner' | 'admin' | 'member';
export type MealType = 'breakfast' | 'lunch' | 'dinner';
export type MenuItemStatus = 'pending' | 'accepted' | 'cooking' | 'done' | 'rejected';
export type MenuEventType =
  | 'item_ordered'
  | 'item_status_changed'
  | 'item_assigned'
  | 'item_note_changed'
  | 'meal_chef_assigned'
  | 'menu_completed';
export type DishCategory = '荤菜' | '素菜' | '汤' | '主食' | '甜品';
export type InventoryCategory = '调料' | '主食' | '饮料' | '零食' | '日用品' | '其他';

export interface DishRecipeStep {
  text: string;
  imageUrl?: string | null;
}

export interface DishReferenceLink {
  title?: string;
  url: string;
}

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

export interface ManagedMember extends Member {
  disabledAt: string | null;
  account: {
    loginName: string;
    disabledAt: string | null;
  } | null;
}

export type ActivityModule =
  | 'member'
  | 'invitation'
  | 'menu'
  | 'calendar'
  | 'task'
  | 'poll'
  | 'reminder'
  | 'shopping'
  | 'inventory'
  | 'recipe'
  | 'media'
  | 'guest'
  | 'system';

export interface HouseholdActivity {
  id: string;
  module: ActivityModule;
  action: string;
  summary: string;
  detail: string | null;
  actor: {
    id: string | null;
    name: string;
    avatarEmoji: string;
  };
  subjectMemberId: string | null;
  targetPath: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export interface AccountProfile {
  id: string;
  loginName: string;
  requiresPasswordSetup: boolean;
}

export interface AuthSetupStatus {
  initialized: boolean;
}

export interface HouseholdInvitation {
  id: string;
  memberName: string;
  avatarEmoji: string;
  role: Exclude<MemberRole, 'owner'>;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedHouseholdInvitation extends HouseholdInvitation {
  invitationToken: string;
}

export interface InvitationPreview {
  householdName: string;
  memberName: string;
  avatarEmoji: string;
  role: Exclude<MemberRole, 'owner'>;
  expiresAt: string;
}

export interface Ingredient {
  id: string;
  name: string;
  category: string;
  defaultUnit: string;
  isPantryStaple: boolean;
}

export interface DishIngredient {
  id: string;
  ingredientId: string;
  ingredient: Ingredient;
  quantity: string;
  unit: string;
}

export type DishSkillLevel = 'learning' | 'can_cook' | 'signature';

export interface DishRecipeVariantStep {
  id: string;
  position: number;
  text: string;
  imageUrl: string | null;
}

export interface DishRecipeVariantLink {
  id: string;
  position: number;
  title: string | null;
  url: string;
}

export interface DishRecipeVariantIngredient {
  id: string;
  ingredientId: string;
  ingredient: Ingredient;
  quantity: string;
  unit: string;
}

export interface DishRecipeVariant {
  id: string;
  dishId: string;
  name: string;
  authorMemberId: string | null;
  author: Member | null;
  isDefault: boolean;
  note: string | null;
  estMinutes: number | null;
  ingredients: DishRecipeVariantIngredient[];
  steps: DishRecipeVariantStep[];
  referenceLinks: DishRecipeVariantLink[];
  canManage: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MemberDishSkill {
  id: string;
  memberId: string;
  member: Member;
  dishId: string;
  preferredRecipeId: string | null;
  level: DishSkillLevel;
  note: string | null;
}

export interface Dish {
  id: string;
  name: string;
  photoUrl: string | null;
  category: DishCategory;
  difficulty: number;
  estMinutes: number | null;
  note: string | null;
  recipeSteps: DishRecipeStep[];
  referenceLinks: DishReferenceLink[];
  ingredients: DishIngredient[];
}

export interface RecipeDish extends Dish {
  recipeVariants: DishRecipeVariant[];
  skills: MemberDishSkill[];
}

export interface DishRecipeSnapshot {
  variantId: string;
  name: string;
  authorMemberId: string | null;
  authorName: string | null;
  note: string | null;
  estMinutes: number | null;
  ingredients: {
    ingredientId: string;
    name: string;
    category: string;
    isPantryStaple: boolean;
    quantity: number;
    unit: string;
  }[];
  steps: DishRecipeStep[];
  referenceLinks: DishReferenceLink[];
}

export interface MenuItem {
  id: string;
  dishId: string;
  dish: Dish;
  requestedBy: Member;
  assignedTo: Member | null;
  assignedToId: string | null;
  note: string | null;
  status: MenuItemStatus;
  statusReason: string | null;
  recipeVariantId: string | null;
  recipeSnapshot: DishRecipeSnapshot | null;
  createdAt: string;
}

export interface Menu {
  id: string;
  date: string;
  mealType: MealType;
  status: 'open' | 'done';
  chef: Member | null;
  chefId: string | null;
  completedAt: string | null;
  completedBy: Member | null;
  items: MenuItem[];
}

export interface MenuEvent {
  id: string;
  menuId: string;
  menu: Menu;
  menuItemId: string | null;
  menuItem: MenuItem | null;
  actor: Member;
  recipientId: string | null;
  type: MenuEventType;
  fromValue: string | null;
  toValue: string | null;
  reason: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface ShoppingItem {
  id: string;
  date: string;
  ingredient: Ingredient | null;
  customName: string | null;
  totalQty: string | null;
  requiredQty: string | null;
  availableQty: string | null;
  unit: string | null;
  checked: boolean;
  source: 'auto' | 'manual';
}

export interface InventoryItem {
  id: string;
  ingredientId: string | null;
  ingredient: Ingredient | null;
  name: string;
  category: InventoryCategory;
  quantity: string;
  unit: string;
  lowStockThreshold: string;
  restockQuantity: string;
  updatedAt: string;
}

export interface MenuDateCount {
  date: string;
  count: number;
}

export type MediaType = 'movie' | 'series';
export type MediaMetadataSource = 'tmdb' | 'douban' | 'bangumi';
export type MediaMetadataExternalProvider =
  | MediaMetadataSource
  | 'imdb';
export type HouseholdMediaStatus =
  | 'watchlist'
  | 'voting'
  | 'scheduled'
  | 'watching'
  | 'completed'
  | 'dropped';

export interface MediaExternalRef {
  id: string;
  provider:
    | MediaMetadataExternalProvider
    | 'plex'
    | 'emby'
    | 'moviepilot';
  externalId: string;
  connectorKey: string | null;
}

export interface MediaSearchResult {
  key: string;
  type: MediaType;
  title: string;
  originalTitle: string | null;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  sources: MediaMetadataSource[];
  externalRefs: {
    provider: MediaMetadataExternalProvider;
    mediaType: MediaType;
    externalId: string;
  }[];
  metadata: Record<string, unknown>;
}

export interface MediaSourceSearchStatus {
  provider: MediaMetadataSource;
  name: string;
  state: 'not_configured' | 'online' | 'offline';
  resultCount: number;
  message: string;
}

export interface MediaSearchResponse {
  query: string;
  results: MediaSearchResult[];
  sources: MediaSourceSearchStatus[];
}

export interface MediaSourceConfig {
  provider: MediaMetadataSource;
  name: string;
  mode: 'household' | 'server_default';
  isEnabled: boolean;
  baseUrl: string | null;
  credentialKind: 'token' | 'api_key';
  credentialConfigured: boolean;
  credentialHint: string | null;
  configured: boolean;
  settings: {
    imageBaseUrl?: string;
    userAgent?: string;
  };
  updatedAt: string | null;
}

export interface MediaTitle {
  id: string;
  type: MediaType;
  title: string;
  originalTitle: string | null;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  externalRefs: MediaExternalRef[];
}

export interface HouseholdMedia {
  id: string;
  householdId: string;
  status: HouseholdMediaStatus;
  scheduledFor: string | null;
  note: string | null;
  mediaTitle: MediaTitle;
  createdBy: Pick<Member, 'id' | 'name' | 'avatarEmoji'>;
  createdAt: string;
  updatedAt: string;
}

export type MediaConnectorKind = 'plex' | 'emby' | 'moviepilot';
export type MediaConnectorState =
  | 'disabled'
  | 'not_configured'
  | 'needs_credential'
  | 'online'
  | 'offline';

export interface MediaConnectorSummary {
  key: string;
  kind: MediaConnectorKind;
  name: string;
  role: 'library' | 'automation';
  primary: boolean;
  state: MediaConnectorState;
  available: boolean;
  message: string;
  checkedAt: string | null;
}

export interface MediaConnectorSettings {
  kind: MediaConnectorKind;
  name: string;
  role: 'library' | 'automation';
  mode: 'server_default' | 'household';
  isEnabled: boolean;
  baseUrl: string | null;
  credentialConfigured: boolean;
  credentialHint: string | null;
  isPrimary: boolean;
  configured: boolean;
  capabilities: string[];
  webhookConfigured: boolean;
  webhookSourceIp: string | null;
  webhookUpdatedAt: string | null;
  playbackServerId: string | null;
  updatedAt: string | null;
}

export interface MediaPlaybackUserDirectory {
  connectorKey: string;
  provider: 'plex' | 'emby';
  name: string;
  state: MediaConnectorState;
  message: string;
  serverId: string | null;
  users: {
    serverId: string | null;
    externalUserId: string;
    name: string;
    isDisabled: boolean;
    isStale: boolean;
    mapping: {
      id: string;
      member: Pick<Member, 'id' | 'name' | 'avatarEmoji' | 'disabledAt'>;
    } | null;
  }[];
}

export interface MoviePilotWebhookResult {
  callbackPath: string;
  sourceIp: string;
  updatedAt: string;
}

export interface PlaybackWebhookResult extends MoviePilotWebhookResult {
  serverId: string;
}

export type ViewingSessionStatus =
  | 'active'
  | 'paused'
  | 'stopped'
  | 'completed';

export interface ViewingSession {
  id: string;
  provider: 'plex' | 'emby';
  connectorName: string;
  mediaLibraryItemId: string | null;
  mediaTitleId: string | null;
  libraryItemId: string;
  contentItemId: string;
  mediaType: MediaType;
  title: string;
  deviceName: string | null;
  status: ViewingSessionStatus;
  positionMs: number;
  durationMs: number | null;
  percentage: number;
  startedAt: string;
  endedAt: string | null;
  lastEventAt: string;
  posterUrl: string | null;
  playbackUrl: string | null;
  participants: {
    id: string;
    member: Pick<Member, 'id' | 'name' | 'avatarEmoji'>;
    joinedAt: string;
    lastSeenAt: string;
  }[];
}

export interface ViewingProgress {
  id: string;
  provider: 'plex' | 'emby';
  mediaLibraryItemId: string | null;
  mediaTitleId: string | null;
  contentItemId: string;
  title: string;
  positionMs: number;
  durationMs: number | null;
  percentage: number;
  completed: boolean;
  lastWatchedAt: string;
  posterUrl: string | null;
  playbackUrl: string | null;
  member: Pick<Member, 'id' | 'name' | 'avatarEmoji'>;
}

export interface MediaLibraryMatch {
  connectorKey: string;
  provider: 'plex' | 'emby';
  name: string;
  primary: boolean;
  libraryItemId: string;
  playbackUrl: string | null;
  seasons: {
    season: number;
    // Number reported by the media server; it is not an expected total.
    episodeCount: number | null;
  }[];
}

export type MediaLibraryAvailability = Record<string, MediaLibraryMatch[]>;

export interface MediaLibraryItem {
  id: string;
  connectorKey: string;
  provider: 'plex' | 'emby';
  connectorName: string;
  libraryItemId: string;
  type: MediaType;
  title: string;
  originalTitle: string | null;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  externalRefs: {
    provider: 'tmdb' | 'imdb';
    mediaType: MediaType;
    externalId: string;
  }[];
  playbackUrl: string | null;
  householdMediaId: string | null;
  lastSeenAt: string;
}

export interface MediaLibraryResponse {
  items: MediaLibraryItem[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  lastSyncedAt: string | null;
  connectors: {
    connectorKey: 'plex' | 'emby';
    name: string;
    provider: 'plex' | 'emby';
    lastSyncedAt: string | null;
  }[];
}

export interface MediaLibrarySyncResponse {
  results: {
    connectorKey: string;
    name: string;
    provider: 'plex' | 'emby';
    itemCount: number;
    matchedCount: number;
    syncedAt: string;
  }[];
}

export type MediaRequestStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface MediaRequest {
  id: string;
  householdMediaId: string;
  connectorKey: string;
  season: number;
  status: MediaRequestStatus;
  externalRequestId: string | null;
  message: string | null;
  requestedBy: Pick<Member, 'id' | 'name' | 'avatarEmoji'>;
  cancelledBy: Pick<Member, 'id' | 'name' | 'avatarEmoji'> | null;
  canCancel: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEvent {
  id: string;
  householdId: string;
  date: string;
  startsAt: string | null;
  endsAt: string | null;
  title: string;
  note: string | null;
  createdById: string;
  createdBy?: Member;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEntry {
  id: string;
  sourceId: string;
  module: 'menu' | 'calendar' | 'task' | 'media' | 'guest';
  date: string;
  startsAt: string | null;
  endsAt: string | null;
  title: string;
  summary: string | null;
  status:
    | 'open'
    | 'done'
    | 'scheduled'
    | 'pending'
    | 'skipped'
    | 'cancelled'
    | 'completed'
    | HouseholdMediaStatus;
  targetPath: string;
  metadata: {
    mealType?: MealType;
    itemCount?: number;
    createdById?: string;
    createdByName?: string;
    canManage?: boolean;
    canUpdate?: boolean;
    assigneeId?: string | null;
    assigneeName?: string | null;
    recurrence?: TaskRecurrence;
    mediaType?: MediaType;
    year?: number | null;
    hostMemberId?: string;
    hostMemberName?: string;
    guestCount?: number;
  };
}

export interface Guest {
  id: string;
  name: string;
  avatarEmoji: string;
  note: string | null;
  isActive: boolean;
  anonymizedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type VisitStatus = 'scheduled' | 'cancelled' | 'completed';
export type GuestWifiSecurity = 'WPA' | 'nopass';
export type GuestMealRequestStatus = 'pending' | 'accepted' | 'rejected';

export interface GuestWifiProfile {
  id: string;
  name: string;
  ssid: string;
  security: GuestWifiSecurity;
  passwordConfigured: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GuestInvitation {
  id: string;
  guestId: string;
  expiresAt: string;
  acceptedAt: string | null;
  allowsMovieVoting: boolean;
  allowsMealRequests: boolean;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedGuestInvitation extends GuestInvitation {
  invitationToken: string;
}

export interface Visit {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  note: string | null;
  status: VisitStatus;
  guestWifiProfile: GuestWifiProfile | null;
  hostMember: Pick<Member, 'id' | 'name' | 'avatarEmoji'> | null;
  guests: {
    id: string;
    guest: Guest;
    isAttending: boolean | null;
    respondedAt: string | null;
    invitation: GuestInvitation | null;
  }[];
  mealRequests: GuestMealRequest[];
  createdAt: string;
  updatedAt: string;
}

export interface GuestInvitationPreview {
  guest: Pick<Guest, 'name' | 'avatarEmoji'>;
  householdName: string;
  visit: Pick<Visit, 'title' | 'startsAt' | 'endsAt' | 'note'>;
  response: { attending: boolean | null; respondedAt: string | null };
  capabilities: { movieVoting: boolean; mealRequests: boolean };
  mealRequestDates: string[];
  wifi: { ssid: string; security: GuestWifiSecurity; qrPayload: string } | null;
  expiresAt: string;
}

export interface GuestMealRequest {
  id: string;
  menuItemId: string | null;
  mealDate: string;
  mealType: MealType;
  dishName: string;
  note: string | null;
  status: GuestMealRequestStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  guest?: Pick<Guest, 'id' | 'name' | 'avatarEmoji'> | null;
}

export interface GuestMealOption {
  id: string;
  mealDate: string;
  mealType: MealType;
  items: {
    id: string;
    dishName: string;
    dishCategory: DishCategory;
    photoUrl: string | null;
    request: GuestMealRequest | null;
  }[];
}

export interface GuestMoviePoll {
  id: string;
  title: string;
  description: string | null;
  voteMode: PollVoteMode;
  maxChoices: number;
  closesAt: string | null;
  totalVoters: number;
  selectedOptionIds: string[];
  options: {
    id: string;
    label: string;
    description: string | null;
    voteCount: number;
    media: { title: string; originalTitle: string | null; year: number | null; posterUrl: string | null } | null;
  }[];
}

export type TaskRecurrence = 'once' | 'daily' | 'weekly' | 'monthly';
export type TaskInstanceStatus = 'pending' | 'done' | 'skipped';

export interface HouseholdTask {
  id: string;
  title: string;
  note: string | null;
  startsOn: string;
  recurrence: TaskRecurrence;
  repeatInterval: number;
  endsOn: string | null;
  createdById: string;
  createdBy: Member;
  defaultAssigneeId: string | null;
  defaultAssignee: Member | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskOccurrence {
  id: string;
  taskId: string;
  dueDate: string;
  status: TaskInstanceStatus;
  assigneeId: string | null;
  assignee: Member | null;
  resolvedById: string | null;
  resolvedBy: Member | null;
  resolvedAt: string | null;
  canManageTask: boolean;
  canUpdate: boolean;
  task: HouseholdTask;
}

export type NotificationModule =
  | 'menu'
  | 'task'
  | 'poll'
  | 'calendar'
  | 'reminder'
  | 'media'
  | 'guest'
  | 'system';

export interface AppNotification {
  id: string;
  householdId: string;
  recipientId: string;
  recipient: Member;
  module: NotificationModule;
  type: string;
  sourceId: string | null;
  title: string;
  body: string | null;
  targetPath: string;
  readAt: string | null;
  createdAt: string;
}

export type PollCategory = 'general' | 'meal' | 'activity' | 'movie' | 'shopping';
export type PollVoteMode = 'single' | 'multiple';
export type PollStatus = 'open' | 'closed';

export interface PollOptionResult {
  id: string;
  label: string;
  description: string | null;
  mediaId: string | null;
  media: {
    id: string;
    status: HouseholdMediaStatus;
    mediaTitle: Pick<
      MediaTitle,
      'id' | 'type' | 'title' | 'originalTitle' | 'year' | 'posterUrl'
    >;
  } | null;
  sortOrder: number;
  voteCount: number;
  percentage: number;
  voters: Member[];
}

export interface HouseholdPoll {
  id: string;
  title: string;
  description: string | null;
  category: PollCategory;
  voteMode: PollVoteMode;
  maxChoices: number;
  closesAt: string | null;
  status: PollStatus;
  sourceModule: string | null;
  sourceId: string | null;
  createdById: string;
  createdBy: Member;
  closedById: string | null;
  closedBy: Member | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  canManage: boolean;
  canVote: boolean;
  totalVoters: number;
  totalVotes: number;
  selectedOptionIds: string[];
  options: PollOptionResult[];
}

export type ReminderSourceModule = 'menu' | 'task' | 'calendar' | 'poll';
export type ReminderStatus = 'scheduled' | 'sent' | 'cancelled';

export interface ReminderSource {
  module: ReminderSourceModule;
  sourceId: string;
  occurrenceDate: string | null;
  title: string;
  summary: string | null;
  date: string | null;
  startsAt: string | null;
  targetPath: string;
  status: string;
}

export interface ReminderRecipient {
  id: string;
  member: Member;
  deliveredAt: string | null;
}

export interface HouseholdReminder {
  id: string;
  sourceModule: ReminderSourceModule;
  sourceId: string;
  occurrenceDate: string | null;
  remindAt: string;
  status: ReminderStatus;
  source: ReminderSource | null;
  createdById: string;
  createdBy: Member;
  recipients: ReminderRecipient[];
  sentAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  canManage: boolean;
  createdAt: string;
  updatedAt: string;
}
