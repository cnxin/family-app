import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, uploadAssetDocument } from './api';
import type {
  AccountProfile,
  AppNotification,
  AssetCategory,
  AssetDocument,
  AssetDocumentType,
  BackupDashboard,
  BackupPolicy,
  BackupRun,
  BackupScheduleFrequency,
  CalendarEntry,
  CalendarEvent,
  CreatedGuestInvitation,
  CreatedHouseholdInvitation,
  Dish,
  Guest,
  GuestInvitationPreview,
  GuestMealRequest,
  GuestMealOption,
  GuestMoviePoll,
  GuestWifiProfile,
  HouseholdPoll,
  HouseholdReminder,
  HomeAsset,
  DishRecipeVariant,
  DishRecipeStep,
  DishReferenceLink,
  DishSkillLevel,
  Ingredient,
  HouseholdInvitation,
  HouseholdActivity,
  HouseholdMedia,
  HouseholdMediaStatus,
  MediaConnectorSummary,
  MediaConnectorSettings,
  MediaLibraryAvailability,
  MediaLibraryResponse,
  MediaLibrarySyncResponse,
  MediaPlaybackUserDirectory,
  MoviePilotWebhookResult,
  PlaybackWebhookResult,
  MediaRequest,
  MediaSearchResponse,
  MediaSourceConfig,
  InventoryCategory,
  InventoryActionResult,
  InventoryItem,
  InventoryTransaction,
  KnowledgeArticle,
  KnowledgeArticleCategory,
  KnowledgeArticleRevision,
  Member,
  ManagedMember,
  MealType,
  MediaType,
  Menu,
  MenuDateCount,
  MenuEvent,
  MenuItem,
  MenuItemStatus,
  MenuInventoryPreview,
  NotificationChannel,
  NotificationChannelKind,
  NotificationDelivery,
  NotificationDeliveryStatus,
  NotificationModule,
  MaintenanceCompletionResult,
  MaintenanceConsumable,
  MaintenanceConsumablesPreview,
  MaintenancePlan,
  MaintenanceShoppingResult,
  MemberDishSkill,
  PollCategory,
  PollVoteMode,
  PointsAccount,
  PointsLedger,
  RecipeDish,
  Reward,
  RewardRedemption,
  RewardRedemptionStatus,
  ReminderSource,
  ReminderSourceModule,
  ReminderStatus,
  ShoppingItem,
  ShoppingInventoryPreview,
  TaskInstanceStatus,
  TaskOccurrence,
  TaskRecurrence,
  ViewingProgress,
  ViewingSession,
  Visit,
  VisitStatus,
} from './types';

export interface KnowledgeArticleInput {
  title: string;
  category: KnowledgeArticleCategory;
  summary?: string | null;
  content: string;
  referenceUrl?: string | null;
  tags?: string[];
  isPinned?: boolean;
}

function operationKey(prefix: string) {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function useKnowledgeArticles(
  status: 'active' | 'archived' | 'all' = 'active',
  category: KnowledgeArticleCategory | 'all' = 'all',
  q = '',
) {
  const query = [
    `status=${status}`,
    ...(category === 'all' ? [] : [`category=${category}`]),
    ...(q.trim() ? [`q=${encodeURIComponent(q.trim())}`] : []),
  ].join('&');
  return useQuery({
    queryKey: ['knowledge-articles', status, category, q.trim()],
    queryFn: () => api<KnowledgeArticle[]>(`/knowledge-articles?${query}`),
  });
}

export function useKnowledgeRevisions(articleId: string | null) {
  return useQuery({
    queryKey: ['knowledge-article-revisions', articleId],
    queryFn: () =>
      api<KnowledgeArticleRevision[]>(
        `/knowledge-articles/${articleId}/revisions`,
      ),
    enabled: Boolean(articleId),
  });
}

export function useCreateKnowledgeArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: KnowledgeArticleInput) =>
      api<KnowledgeArticle>('/knowledge-articles', {
        method: 'POST',
        body: { ...input, idempotencyKey: operationKey('knowledge:create') },
      }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['knowledge-articles'] }),
  });
}

export function useUpdateKnowledgeArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      expectedVersion,
      ...input
    }: KnowledgeArticleInput & { id: string; expectedVersion: number }) =>
      api<KnowledgeArticle>(`/knowledge-articles/${id}`, {
        method: 'PATCH',
        body: {
          ...input,
          expectedVersion,
          idempotencyKey: operationKey(`knowledge:update:${id}`),
        },
      }),
    onSuccess: (article) => {
      void qc.invalidateQueries({ queryKey: ['knowledge-articles'] });
      void qc.invalidateQueries({
        queryKey: ['knowledge-article-revisions', article.id],
      });
    },
  });
}

function useKnowledgeVersionMutation(
  operation: 'archive' | 'restore',
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; expectedVersion: number }) =>
      api<KnowledgeArticle>(
        `/knowledge-articles/${input.id}/${operation}`,
        {
          method: 'POST',
          body: {
            expectedVersion: input.expectedVersion,
            idempotencyKey: operationKey(`knowledge:${operation}:${input.id}`),
          },
        },
      ),
    onSuccess: (article) => {
      void qc.invalidateQueries({ queryKey: ['knowledge-articles'] });
      void qc.invalidateQueries({
        queryKey: ['knowledge-article-revisions', article.id],
      });
    },
  });
}

export function useArchiveKnowledgeArticle() {
  return useKnowledgeVersionMutation('archive');
}

export function useRestoreKnowledgeArticle() {
  return useKnowledgeVersionMutation('restore');
}

export function useRestoreKnowledgeRevision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      version: number;
      expectedVersion: number;
    }) =>
      api<KnowledgeArticle>(
        `/knowledge-articles/${input.id}/revisions/${input.version}/restore`,
        {
          method: 'POST',
          body: {
            expectedVersion: input.expectedVersion,
            idempotencyKey: operationKey(
              `knowledge:restore-revision:${input.id}:${input.version}`,
            ),
          },
        },
      ),
    onSuccess: (article) => {
      void qc.invalidateQueries({ queryKey: ['knowledge-articles'] });
      void qc.invalidateQueries({
        queryKey: ['knowledge-article-revisions', article.id],
      });
    },
  });
}

export interface BackupPolicyInput {
  scheduleEnabled: boolean;
  frequency: BackupScheduleFrequency;
  weeklyDay: number | null;
  scheduledHour: number;
  scheduledMinute: number;
  retentionDays: number;
  retentionCount: number;
  capacityWarningPercent: number;
  capacityCriticalPercent: number;
  restoreDrillEnabled: boolean;
  restoreDrillDay: number;
  restoreDrillHour: number;
}

export function useBackupDashboard(enabled = true) {
  return useQuery({
    queryKey: ['system-backups'],
    queryFn: () => api<BackupDashboard>('/system/backups'),
    enabled,
    refetchInterval: enabled ? 10_000 : false,
  });
}

export function useUpdateBackupPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BackupPolicyInput) =>
      api<BackupPolicy>('/system/backups/policy', { method: 'PUT', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['system-backups'] }),
  });
}

export function useQueueBackupRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: 'backup' | 'capacity_check') =>
      api<BackupRun>(
        kind === 'backup'
          ? '/system/backups/runs'
          : '/system/backups/capacity-checks',
        {
          method: 'POST',
          body: { idempotencyKey: `${kind}:${Date.now()}:${Math.random().toString(36).slice(2)}` },
        },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['system-backups'] }),
  });
}

export function useQueueRestoreDrill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sourceBackupRunId: string) =>
      api<BackupRun>(`/system/backups/runs/${sourceBackupRunId}/restore-drills`, {
        method: 'POST',
        body: {
          idempotencyKey: `restore:${sourceBackupRunId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['system-backups'] }),
  });
}

export function useCancelBackupRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<BackupRun>(`/system/backups/runs/${id}/cancel`, { method: 'PATCH' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['system-backups'] }),
  });
}

export function useMembers(enabled = true) {
  return useQuery({
    queryKey: ['members'],
    queryFn: () => api<Member[]>('/members'),
    enabled,
  });
}

export function useManagedMembers(enabled = true) {
  return useQuery({
    queryKey: ['household-members'],
    queryFn: () => api<ManagedMember[]>('/household/members'),
    enabled,
  });
}

export function useGuests(enabled = true) {
  return useQuery({
    queryKey: ['guests'],
    queryFn: () => api<Guest[]>('/guests'),
    enabled,
  });
}

export function useGuestWifiProfiles(enabled = true) {
  return useQuery({
    queryKey: ['guest-wifi-profiles'],
    queryFn: () => api<GuestWifiProfile[]>('/guest-wifi-profiles'),
    enabled,
  });
}

export function useCreateGuestWifiProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; ssid: string; security: 'WPA' | 'nopass'; password?: string | null }) =>
      api<GuestWifiProfile>('/guest-wifi-profiles', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['guest-wifi-profiles'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useUpdateGuestWifiProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; ssid?: string; security?: 'WPA' | 'nopass'; password?: string | null; isActive?: boolean }) =>
      api<GuestWifiProfile>(`/guest-wifi-profiles/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['guest-wifi-profiles'] });
      void qc.invalidateQueries({ queryKey: ['visits'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useCreateGuest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; avatarEmoji?: string; note?: string | null }) =>
      api<Guest>('/guests', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['guests'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useUpdateGuest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; avatarEmoji?: string; note?: string | null; isActive?: boolean }) =>
      api<Guest>(`/guests/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['guests'] });
      void qc.invalidateQueries({ queryKey: ['visits'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useAnonymizeGuest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Guest>(`/guests/${id}/anonymize`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['guests'] });
      void qc.invalidateQueries({ queryKey: ['visits'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useVisits(status?: VisitStatus, enabled = true) {
  return useQuery({
    queryKey: ['visits', status ?? 'all'],
    queryFn: () => api<Visit[]>(`/visits${status ? `?status=${status}` : ''}`),
    enabled,
  });
}

export function useCreateVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      title: string;
      startsAt: string;
      endsAt?: string | null;
      note?: string | null;
      hostMemberId?: string;
      guestWifiProfileId?: string | null;
      guestIds: string[];
    }) => api<Visit>('/visits', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['visits'] });
      void qc.invalidateQueries({ queryKey: ['calendar'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useUpdateVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string;
      title?: string;
      startsAt?: string;
      endsAt?: string | null;
      note?: string | null;
      hostMemberId?: string;
      guestWifiProfileId?: string | null;
      status?: VisitStatus;
      guestIds?: string[];
    }) => api<Visit>(`/visits/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['visits'] });
      void qc.invalidateQueries({ queryKey: ['calendar'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useCreateGuestInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ visitId, ...body }: { visitId: string; guestId: string; expiresInHours?: number; allowsMovieVoting?: boolean; allowsMealRequests?: boolean }) =>
      api<CreatedGuestInvitation>(`/visits/${visitId}/invitations`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['visits'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useRevokeGuestInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ id: string; revoked: true }>(`/guest-invitations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['visits'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useGuestInvitation(token: string | undefined) {
  return useQuery({
    queryKey: ['guest-invitation', token],
    queryFn: () => api<GuestInvitationPreview>(`/guest-invitations/${encodeURIComponent(token ?? '')}`, { auth: false }),
    enabled: Boolean(token),
    retry: false,
  });
}

export function useRespondGuestInvitation(token: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attending: boolean) =>
      api<GuestInvitationPreview>(`/guest-invitations/${encodeURIComponent(token ?? '')}/response`, {
        method: 'POST',
        auth: false,
        body: { attending },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['guest-invitation', token] });
    },
  });
}

export function useGuestMoviePolls(token: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['guest-movie-polls', token],
    queryFn: () => api<GuestMoviePoll[]>(`/guest-invitations/${encodeURIComponent(token ?? '')}/movie-polls`, { auth: false }),
    enabled: Boolean(token) && enabled,
    retry: false,
  });
}

export function useVoteGuestMoviePoll(token: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pollId, optionIds }: { pollId: string; optionIds: string[] }) =>
      api<GuestMoviePoll>(`/guest-invitations/${encodeURIComponent(token ?? '')}/movie-polls/${pollId}/votes`, {
        method: 'POST',
        auth: false,
        body: { optionIds },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['guest-movie-polls', token] }),
  });
}

export function useGuestMealRequests(token: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['guest-meal-requests', token],
    queryFn: () => api<GuestMealRequest[]>(`/guest-invitations/${encodeURIComponent(token ?? '')}/meal-requests`, { auth: false }),
    enabled: Boolean(token) && enabled,
    retry: false,
  });
}

export function useGuestMealOptions(token: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['guest-meal-options', token],
    queryFn: () => api<GuestMealOption[]>(`/guest-invitations/${encodeURIComponent(token ?? '')}/meal-options`, { auth: false }),
    enabled: Boolean(token) && enabled,
    retry: false,
  });
}

export function useClaimGuestMealOption(token: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (menuItemId: string) => api<GuestMealRequest>(`/guest-invitations/${encodeURIComponent(token ?? '')}/meal-options/${menuItemId}/request`, { method: 'POST', auth: false }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['guest-meal-options', token] });
      void qc.invalidateQueries({ queryKey: ['guest-meal-requests', token] });
    },
  });
}

export function useSubmitGuestMealRequest(token: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { mealDate: string; mealType: MealType; dishName: string; note?: string | null }) =>
      api<GuestMealRequest>(`/guest-invitations/${encodeURIComponent(token ?? '')}/meal-requests`, {
        method: 'POST',
        auth: false,
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['guest-meal-requests', token] }),
  });
}

export function useReviewGuestMealRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; status: 'accepted' | 'rejected'; reviewNote?: string | null }) =>
      api<GuestMealRequest>(`/guest-meal-requests/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['visits'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useUpdateManagedMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      avatarEmoji?: string;
      role?: 'owner' | 'admin' | 'member';
      prefersCooking?: boolean;
    }) =>
      api<ManagedMember>(`/household/members/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['household-members'] });
      void qc.invalidateQueries({ queryKey: ['members'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useUpdateManagedMemberStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api<ManagedMember>(`/household/members/${id}/status`, {
        method: 'PATCH',
        body: { enabled },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['household-members'] });
      void qc.invalidateQueries({ queryKey: ['members'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useActivities(
  scope: 'all' | 'members' | 'menus' = 'all',
  enabled = true,
) {
  return useQuery({
    queryKey: ['activities', scope],
    queryFn: () =>
      api<HouseholdActivity[]>(`/activities?scope=${scope}&limit=100`),
    enabled,
  });
}

export function useDishes(enabled = true) {
  return useQuery({
    queryKey: ['dishes'],
    queryFn: () => api<Dish[]>('/dishes'),
    enabled,
  });
}

export function useRecipes(enabled = true) {
  return useQuery({
    queryKey: ['recipes'],
    queryFn: () => api<RecipeDish[]>('/recipes'),
    enabled,
  });
}

export function useRecipe(dishId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['recipes', dishId],
    queryFn: () => api<RecipeDish>(`/recipes/${dishId}`),
    enabled: enabled && Boolean(dishId),
  });
}

export function useIngredients() {
  return useQuery({
    queryKey: ['ingredients'],
    queryFn: () => api<Ingredient[]>('/ingredients'),
  });
}

export function useMenu(date: string, mealType: MealType) {
  return useQuery({
    queryKey: ['menu', date, mealType],
    queryFn: () => api<Menu>(`/menus?date=${date}&mealType=${mealType}`),
  });
}

export function useMenusOfDate(date: string) {
  return useQuery({
    queryKey: ['menus', date],
    queryFn: () => api<Menu[]>(`/menus?date=${date}`),
  });
}

export function useMenuDateCounts(start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: ['menu-dates', start, end],
    queryFn: () =>
      api<MenuDateCount[]>(`/menu-dates?start=${start}&end=${end}`),
    enabled,
  });
}

export function useCalendarEntries(start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: ['calendar', start, end],
    queryFn: () =>
      api<CalendarEntry[]>(`/calendar?start=${start}&end=${end}`),
    enabled,
  });
}

export function useMedia(
  status: HouseholdMediaStatus | 'all' = 'all',
  search = '',
  enabled = true,
) {
  return useQuery({
    queryKey: ['media', status, search],
    queryFn: () => {
      const params = new URLSearchParams({ status });
      if (search.trim()) params.set('search', search.trim());
      return api<HouseholdMedia[]>(`/media?${params.toString()}`);
    },
    enabled,
  });
}

export function useMediaSearch(
  query: string,
  type: MediaType,
  enabled = true,
) {
  return useQuery({
    queryKey: ['media-search', query, type],
    queryFn: () => {
      const params = new URLSearchParams({ query, type });
      return api<MediaSearchResponse>(`/media/search?${params.toString()}`);
    },
    enabled: enabled && Boolean(query.trim()),
    staleTime: 5 * 60_000,
  });
}

export function useMediaSourceConfigs(enabled = true) {
  return useQuery({
    queryKey: ['media-source-configs'],
    queryFn: () => api<MediaSourceConfig[]>('/media/metadata-sources'),
    enabled,
  });
}

export interface UpdateMediaSourceConfigInput {
  provider: MediaSourceConfig['provider'];
  isEnabled: boolean;
  baseUrl: string | null;
  credentialKind: 'token' | 'api_key';
  credential?: string;
  clearCredential?: boolean;
  imageBaseUrl?: string | null;
  userAgent?: string | null;
}

export function useUpdateMediaSourceConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, ...body }: UpdateMediaSourceConfigInput) =>
      api<MediaSourceConfig[]>(`/media/metadata-sources/${provider}`, {
        method: 'PUT',
        body,
      }),
    onSuccess: (configs) => {
      qc.setQueryData(['media-source-configs'], configs);
      void qc.invalidateQueries({ queryKey: ['media-search'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useResetMediaSourceConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: MediaSourceConfig['provider']) =>
      api<MediaSourceConfig[]>(`/media/metadata-sources/${provider}`, {
        method: 'DELETE',
      }),
    onSuccess: (configs) => {
      qc.setQueryData(['media-source-configs'], configs);
      void qc.invalidateQueries({ queryKey: ['media-search'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useMediaConnectors() {
  return useQuery({
    queryKey: ['media-connectors'],
    queryFn: () => api<MediaConnectorSummary[]>('/media/connectors'),
    staleTime: 30_000,
  });
}

export function useMediaConnectorSettings(enabled = true) {
  return useQuery({
    queryKey: ['media-connector-settings'],
    queryFn: () =>
      api<MediaConnectorSettings[]>('/media/connector-settings'),
    enabled,
  });
}

export function useMediaPlaybackUsers(enabled = true) {
  return useQuery({
    queryKey: ['media-playback-users'],
    queryFn: () =>
      api<MediaPlaybackUserDirectory[]>('/media/playback-users'),
    enabled,
  });
}

export function useUpdateMediaPlaybackUserMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      provider,
      externalUserId,
      memberId,
    }: {
      provider: MediaPlaybackUserDirectory['provider'];
      externalUserId: string;
      memberId: string;
    }) =>
      api(`/media/playback-users/${provider}/${encodeURIComponent(externalUserId)}/mapping`, {
        method: 'PUT',
        body: { memberId },
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['media-playback-users'] }),
        qc.invalidateQueries({ queryKey: ['activities'] }),
      ]);
    },
  });
}

export function useDeleteMediaPlaybackUserMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mappingId: string) =>
      api(`/media/playback-user-mappings/${mappingId}`, {
        method: 'DELETE',
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['media-playback-users'] }),
        qc.invalidateQueries({ queryKey: ['activities'] }),
      ]);
    },
  });
}

export interface UpdateMediaConnectorSettingsInput {
  kind: MediaConnectorSettings['kind'];
  name: string;
  isEnabled: boolean;
  baseUrl: string | null;
  credential?: string;
  clearCredential?: boolean;
  isPrimary?: boolean;
}

export function useUpdateMediaConnectorSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, ...body }: UpdateMediaConnectorSettingsInput) =>
      api<MediaConnectorSettings[]>(`/media/connector-settings/${kind}`, {
        method: 'PUT',
        body,
      }),
    onSuccess: (settings) => {
      qc.setQueryData(['media-connector-settings'], settings);
      void qc.invalidateQueries({ queryKey: ['media-connectors'] });
      void qc.invalidateQueries({ queryKey: ['media-library-availability'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useResetMediaConnectorSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: MediaConnectorSettings['kind']) =>
      api<MediaConnectorSettings[]>(`/media/connector-settings/${kind}`, {
        method: 'DELETE',
      }),
    onSuccess: (settings) => {
      qc.setQueryData(['media-connector-settings'], settings);
      void qc.invalidateQueries({ queryKey: ['media-connectors'] });
      void qc.invalidateQueries({ queryKey: ['media-library-availability'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useTestMediaConnectorSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: MediaConnectorSettings['kind']) =>
      api<MediaConnectorSummary>(`/media/connector-settings/${kind}/test`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['media-connectors'] });
    },
  });
}

export function useRotateMoviePilotWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sourceIp: string) =>
      api<MoviePilotWebhookResult>(
        '/media/connector-settings/moviepilot/webhook',
        {
          method: 'POST',
          body: { ...(sourceIp.trim() ? { sourceIp: sourceIp.trim() } : {}) },
        },
      ),
    onSuccess: (result) => {
      qc.setQueryData<MediaConnectorSettings[]>(
        ['media-connector-settings'],
        (settings) =>
          settings?.map((setting) =>
            setting.kind === 'moviepilot'
              ? {
                  ...setting,
                  webhookConfigured: true,
                  webhookSourceIp: result.sourceIp,
                  webhookUpdatedAt: result.updatedAt,
                }
              : setting,
          ),
      );
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useRotatePlaybackWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      provider,
      sourceIp,
    }: {
      provider: 'plex' | 'emby';
      sourceIp: string;
    }) =>
      api<PlaybackWebhookResult>(
        `/media/connector-settings/${provider}/playback-webhook`,
        {
          method: 'POST',
          body: { ...(sourceIp.trim() ? { sourceIp: sourceIp.trim() } : {}) },
        },
      ),
    onSuccess: (result, variables) => {
      qc.setQueryData<MediaConnectorSettings[]>(
        ['media-connector-settings'],
        (settings) =>
          settings?.map((setting) =>
            setting.kind === variables.provider
              ? {
                  ...setting,
                  webhookConfigured: true,
                  webhookSourceIp: result.sourceIp,
                  webhookUpdatedAt: result.updatedAt,
                  playbackServerId: result.serverId,
                }
              : setting,
          ),
      );
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useViewingSessions(enabled = true) {
  return useQuery({
    queryKey: ['viewing-sessions'],
    queryFn: () => api<ViewingSession[]>('/media/viewing-sessions'),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useViewingProgress(enabled = true) {
  return useQuery({
    queryKey: ['viewing-progress'],
    queryFn: () => api<ViewingProgress[]>('/media/viewing-progress'),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useMediaLibraryAvailability(mediaIds: string[]) {
  const normalizedIds = [...mediaIds].sort();
  return useQuery({
    queryKey: ['media-library-availability', normalizedIds.join(',')],
    queryFn: () =>
      api<MediaLibraryAvailability>('/media/library-availability', {
        method: 'POST',
        body: { mediaIds: normalizedIds },
      }),
    enabled: normalizedIds.length > 0,
    staleTime: 60_000,
  });
}

export function useMediaLibrary(
  type: MediaType | 'all' = 'all',
  search = '',
  page = 1,
) {
  return useQuery({
    queryKey: ['media-library', type, search, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '24' });
      if (type !== 'all') params.set('type', type);
      if (search.trim()) params.set('search', search.trim());
      return api<MediaLibraryResponse>(`/media/library?${params.toString()}`);
    },
  });
}

export function useSyncMediaLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<MediaLibrarySyncResponse>('/media/library/sync', {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['media-library'] });
      void qc.invalidateQueries({ queryKey: ['media'] });
      void qc.invalidateQueries({ queryKey: ['media-connectors'] });
      void qc.invalidateQueries({ queryKey: ['media-library-availability'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useAddLibraryItemToWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (libraryItemId: string) =>
      api<{ householdMediaId: string; added: boolean }>(
        `/media/library/${libraryItemId}/add`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['media-library'] });
      void qc.invalidateQueries({ queryKey: ['media'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useMediaRequests(enabled = true) {
  return useQuery({
    queryKey: ['media-requests'],
    queryFn: () => api<MediaRequest[]>('/media/requests'),
    enabled,
  });
}

export function useCreateMediaRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      mediaId,
      season,
    }: {
      mediaId: string;
      season?: number;
    }) =>
      api<MediaRequest>(`/media/${mediaId}/requests`, {
        method: 'POST',
        body: { connectorKey: 'moviepilot', ...(season ? { season } : {}) },
      }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['media-requests'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useRefreshMediaRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<MediaRequest>(`/media/requests/${id}/refresh`, { method: 'POST' }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['media-requests'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useCancelMediaRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<MediaRequest>(`/media/requests/${id}`, { method: 'DELETE' }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['media-requests'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export interface CreateMediaInput {
  type: MediaType;
  title: string;
  originalTitle?: string | null;
  year?: number | null;
  overview?: string | null;
  posterUrl?: string | null;
  status?: HouseholdMediaStatus;
  scheduledFor?: string | null;
  note?: string | null;
  externalRefs?: {
    provider: 'tmdb' | 'imdb' | 'douban' | 'bangumi';
    externalId: string;
  }[];
}

export function useCreateMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMediaInput) =>
      api<HouseholdMedia>('/media', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['media'] });
      void qc.invalidateQueries({ queryKey: ['calendar'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useUpdateMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      status?: HouseholdMediaStatus;
      scheduledFor?: string | null;
      note?: string | null;
    }) => api<HouseholdMedia>(`/media/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['media'] });
      void qc.invalidateQueries({ queryKey: ['calendar'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useAddMediaExternalRefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      externalRefs,
    }: {
      id: string;
      externalRefs: {
        provider: 'tmdb' | 'imdb' | 'douban' | 'bangumi';
        externalId: string;
      }[];
    }) =>
      api<HouseholdMedia>(`/media/${id}/external-refs`, {
        method: 'POST',
        body: { externalRefs },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['media'] });
      void qc.invalidateQueries({ queryKey: ['media-library-availability'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useDeleteMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; removed: true }>(`/media/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['media'] });
      void qc.invalidateQueries({ queryKey: ['calendar'] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export interface CalendarEventInput {
  id?: string;
  date: string;
  startsAt?: string | null;
  endsAt?: string | null;
  title: string;
  note?: string | null;
}

export function useUpsertCalendarEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: CalendarEventInput) =>
      id
        ? api<CalendarEvent>(`/calendar-events/${id}`, {
            method: 'PATCH',
            body,
          })
        : api<CalendarEvent>('/calendar-events', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['calendar'] });
      void qc.invalidateQueries({ queryKey: ['reminder-sources'] });
      void qc.invalidateQueries({ queryKey: ['reminders'] });
    },
  });
}

export function useDeleteCalendarEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; removed: true }>(`/calendar-events/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['calendar'] });
      void qc.invalidateQueries({ queryKey: ['reminder-sources'] });
      void qc.invalidateQueries({ queryKey: ['reminders'] });
    },
  });
}

export function useTasks(start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: ['tasks', start, end],
    queryFn: () => api<TaskOccurrence[]>(`/tasks?start=${start}&end=${end}`),
    enabled,
  });
}

export interface TaskInput {
  id?: string;
  title: string;
  note?: string | null;
  startsOn: string;
  recurrence: TaskRecurrence;
  repeatInterval: number;
  endsOn?: string | null;
  defaultAssigneeId?: string | null;
  rewardPoints?: number;
}

export function useUpsertTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: TaskInput) =>
      id
        ? api(`/tasks/${id}`, { method: 'PATCH', body })
        : api('/tasks', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['calendar'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['reminder-sources'] });
      void qc.invalidateQueries({ queryKey: ['reminders'] });
      void qc.invalidateQueries({ queryKey: ['points-accounts'] });
      void qc.invalidateQueries({ queryKey: ['points-ledger'] });
    },
  });
}

export function useArchiveTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; archived: true }>(`/tasks/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['calendar'] });
      void qc.invalidateQueries({ queryKey: ['reminder-sources'] });
      void qc.invalidateQueries({ queryKey: ['reminders'] });
    },
  });
}

export function useUpdateTaskOccurrence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      taskId: string;
      dueDate: string;
      status?: TaskInstanceStatus;
      assigneeId?: string | null;
    }) =>
      api<TaskOccurrence>(
        `/tasks/${input.taskId}/instances/${input.dueDate}`,
        {
          method: 'PATCH',
          body: { status: input.status, assigneeId: input.assigneeId },
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['calendar'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['reminder-sources'] });
      void qc.invalidateQueries({ queryKey: ['reminders'] });
      void qc.invalidateQueries({ queryKey: ['points-accounts'] });
      void qc.invalidateQueries({ queryKey: ['points-ledger'] });
    },
  });
}

function invalidatePoints(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['points-accounts'] });
  void qc.invalidateQueries({ queryKey: ['points-ledger'] });
  void qc.invalidateQueries({ queryKey: ['rewards'] });
  void qc.invalidateQueries({ queryKey: ['reward-redemptions'] });
  void qc.invalidateQueries({ queryKey: ['activities'] });
  void qc.invalidateQueries({ queryKey: ['notifications'] });
}

export function usePointsAccounts(enabled = true) {
  return useQuery({
    queryKey: ['points-accounts'],
    queryFn: () => api<PointsAccount[]>('/points/accounts'),
    enabled,
  });
}

export function usePointsLedger(memberId?: string, enabled = true) {
  return useQuery({
    queryKey: ['points-ledger', memberId ?? 'all'],
    queryFn: () =>
      api<PointsLedger[]>(
        `/points/ledger?limit=100${memberId ? `&memberId=${memberId}` : ''}`,
      ),
    enabled,
  });
}

export function useAdjustPoints() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      memberId: string;
      delta: number;
      note?: string | null;
      idempotencyKey: string;
    }) => api<PointsLedger>('/points/adjustments', { method: 'POST', body }),
    onSuccess: () => invalidatePoints(qc),
  });
}

export function useReversePointsLedger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string;
      note?: string | null;
      idempotencyKey: string;
    }) => api<PointsLedger>(`/points/ledger/${id}/reverse`, { method: 'POST', body }),
    onSuccess: () => invalidatePoints(qc),
  });
}

export function useRewards(includeInactive = false, enabled = true) {
  return useQuery({
    queryKey: ['rewards', includeInactive],
    queryFn: () =>
      api<Reward[]>(`/rewards${includeInactive ? '?includeInactive=true' : ''}`),
    enabled,
  });
}

export function useUpsertReward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id?: string;
      name?: string;
      description?: string | null;
      cost?: number;
      isActive?: boolean;
    }) =>
      id
        ? api<Reward>(`/rewards/${id}`, { method: 'PATCH', body })
        : api<Reward>('/rewards', { method: 'POST', body }),
    onSuccess: () => invalidatePoints(qc),
  });
}

export function useRedeemReward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rewardId, ...body }: {
      rewardId: string;
      note?: string | null;
      idempotencyKey: string;
    }) =>
      api<RewardRedemption>(`/rewards/${rewardId}/redemptions`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => invalidatePoints(qc),
  });
}

export function useRewardRedemptions(
  status?: RewardRedemptionStatus,
  enabled = true,
) {
  return useQuery({
    queryKey: ['reward-redemptions', status ?? 'all'],
    queryFn: () =>
      api<RewardRedemption[]>(
        `/reward-redemptions${status ? `?status=${status}` : ''}`,
      ),
    enabled,
  });
}

export function useDecideRedemption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string;
      decision: 'approve' | 'reject';
      note?: string | null;
      idempotencyKey: string;
    }) =>
      api<RewardRedemption>(`/reward-redemptions/${id}/decision`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => invalidatePoints(qc),
  });
}

export function useCancelRedemption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string;
      note?: string | null;
      idempotencyKey: string;
    }) =>
      api<RewardRedemption>(`/reward-redemptions/${id}/cancel`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => invalidatePoints(qc),
  });
}

export function useReverseRedemption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string;
      note?: string | null;
      idempotencyKey: string;
    }) =>
      api<RewardRedemption>(`/reward-redemptions/${id}/reverse`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => invalidatePoints(qc),
  });
}

export function useNotifications(includeRead = false, enabled = true) {
  return useQuery({
    queryKey: ['notifications', includeRead],
    queryFn: () =>
      api<AppNotification[]>(
        `/notifications${includeRead ? '?includeRead=true' : ''}`,
      ),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<AppNotification>(`/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ updated: number }>('/notifications/read-all', { method: 'PATCH' }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

function invalidateExternalNotifications(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['notification-channels'] });
  void qc.invalidateQueries({ queryKey: ['notification-deliveries'] });
  void qc.invalidateQueries({ queryKey: ['activities'] });
}

export function useNotificationChannels(enabled = true) {
  return useQuery({
    queryKey: ['notification-channels'],
    queryFn: () => api<NotificationChannel[]>('/notification-channels'),
    enabled,
  });
}

export function useCreateNotificationChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      kind: NotificationChannelKind;
      endpoint: string;
      credential?: string;
      isEnabled?: boolean;
    }) => api<NotificationChannel>('/notification-channels', { method: 'POST', body }),
    onSuccess: () => invalidateExternalNotifications(qc),
  });
}

export function useUpdateNotificationChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string;
      name?: string;
      kind?: NotificationChannelKind;
      endpoint?: string;
      credential?: string;
      clearCredential?: boolean;
      isEnabled?: boolean;
    }) => api<NotificationChannel>(`/notification-channels/${id}`, { method: 'PATCH', body }),
    onSuccess: () => invalidateExternalNotifications(qc),
  });
}

export function useDeleteNotificationChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; deleted: boolean }>(`/notification-channels/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateExternalNotifications(qc),
  });
}

export function useTestNotificationChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ success: true; testedAt: string }>(`/notification-channels/${id}/test`, { method: 'POST' }),
    onSuccess: () => invalidateExternalNotifications(qc),
  });
}

export function useUpdateNotificationPreference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, ...body }: {
      channelId: string;
      isEnabled: boolean;
      modules: NotificationModule[];
    }) => api<NotificationChannel['preference']>(`/notification-channels/${channelId}/preference`, {
      method: 'PUT',
      body,
    }),
    onSuccess: () => invalidateExternalNotifications(qc),
  });
}

export function useNotificationDeliveries(
  status: NotificationDeliveryStatus | 'all' = 'all',
  enabled = true,
) {
  return useQuery({
    queryKey: ['notification-deliveries', status],
    queryFn: () =>
      api<NotificationDelivery[]>(`/notification-deliveries?status=${status}`),
    enabled,
    refetchInterval: 10_000,
  });
}

export function useRetryNotificationDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<NotificationDelivery>(`/notification-deliveries/${id}/retry`, { method: 'POST' }),
    onSuccess: () => invalidateExternalNotifications(qc),
  });
}

export function useAssets(status: 'active' | 'retired' | 'all' = 'all') {
  return useQuery({
    queryKey: ['assets', status],
    queryFn: () => api<HomeAsset[]>(`/assets?status=${status}`),
  });
}

export function useAsset(id: string | null, enabled = true) {
  return useQuery({
    queryKey: ['asset', id],
    queryFn: () => api<HomeAsset>(`/assets/${id}`),
    enabled: enabled && Boolean(id),
  });
}

export interface AssetUpsertInput {
  id?: string;
  name: string;
  category: AssetCategory;
  location?: string | null;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  purchaseDate?: string | null;
  purchasePrice?: number | null;
  warrantyExpiresOn?: string | null;
  status?: 'active' | 'retired';
  note?: string | null;
}

export function useUpsertAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: AssetUpsertInput) =>
      id
        ? api<HomeAsset>(`/assets/${id}`, { method: 'PATCH', body })
        : api<HomeAsset>('/assets', { method: 'POST', body }),
    onSuccess: (asset) => {
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['asset', asset.id] });
      void qc.invalidateQueries({ queryKey: ['reminder-sources'] });
    },
  });
}

export function useAddAssetDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      assetId: string;
      type: AssetDocumentType;
      title: string;
      url?: string;
      localUri?: string;
    }) =>
      input.localUri
        ? uploadAssetDocument(
            input.assetId,
            input.type,
            input.title,
            input.localUri,
          )
        : api<AssetDocument>(`/assets/${input.assetId}/documents`, {
            method: 'POST',
            body: { type: input.type, title: input.title, url: input.url },
          }),
    onSuccess: (_, input) => {
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['asset', input.assetId] });
    },
  });
}

export function useAssetDocumentAccess() {
  return useMutation({
    mutationFn: (documentId: string) =>
      api<{
        url: string;
        external: boolean;
        expiresAt: string | null;
      }>(`/asset-documents/${documentId}/access`),
  });
}

export function useRemoveAssetDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { assetId: string; documentId: string }) =>
      api<{ id: string; removed: true }>(
        `/asset-documents/${input.documentId}`,
        { method: 'DELETE' },
      ),
    onSuccess: (_, input) => {
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['asset', input.assetId] });
    },
  });
}

export function useAddMaintenancePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      assetId: string;
      title: string;
      frequencyDays: number;
      nextDueDate: string;
      note?: string | null;
    }) =>
      api<MaintenancePlan>(`/assets/${input.assetId}/maintenance-plans`, {
        method: 'POST',
        body: {
          title: input.title,
          frequencyDays: input.frequencyDays,
          nextDueDate: input.nextDueDate,
          note: input.note,
        },
      }),
    onSuccess: (_, input) => {
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['asset', input.assetId] });
      void qc.invalidateQueries({ queryKey: ['reminder-sources'] });
    },
  });
}

export function useUpdateMaintenancePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      planId,
      title,
      frequencyDays,
      nextDueDate,
      isEnabled,
      note,
    }: {
      assetId: string;
      planId: string;
      title?: string;
      frequencyDays?: number;
      nextDueDate?: string;
      isEnabled?: boolean;
      note?: string | null;
    }) =>
      api<MaintenancePlan>(`/maintenance-plans/${planId}`, {
        method: 'PATCH',
        body: { title, frequencyDays, nextDueDate, isEnabled, note },
      }),
    onSuccess: (_, input) => {
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['asset', input.assetId] });
      void qc.invalidateQueries({ queryKey: ['reminder-sources'] });
      void qc.invalidateQueries({ queryKey: ['reminders'] });
    },
  });
}

export function useMaintenanceConsumablesPreview(
  planId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: ['maintenance-consumables-preview', planId],
    queryFn: () =>
      api<MaintenanceConsumablesPreview>(
        `/maintenance-plans/${planId}/consumables-preview`,
      ),
    enabled: enabled && Boolean(planId),
  });
}

export function useAddMaintenanceConsumable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      assetId: string;
      planId: string;
      inventoryItemId: string;
      quantity: number;
    }) =>
      api<MaintenanceConsumable>(
        `/maintenance-plans/${input.planId}/consumables`,
        {
          method: 'POST',
          body: {
            inventoryItemId: input.inventoryItemId,
            quantity: input.quantity,
          },
        },
      ),
    onSuccess: (_, input) => {
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['asset', input.assetId] });
      void qc.invalidateQueries({
        queryKey: ['maintenance-consumables-preview', input.planId],
      });
    },
  });
}

export function useUpdateMaintenanceConsumable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      assetId: string;
      planId: string;
      consumableId: string;
      inventoryItemId?: string;
      quantity?: number;
    }) =>
      api<MaintenanceConsumable>(
        `/maintenance-consumables/${input.consumableId}`,
        {
          method: 'PATCH',
          body: {
            inventoryItemId: input.inventoryItemId,
            quantity: input.quantity,
          },
        },
      ),
    onSuccess: (_, input) => {
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['asset', input.assetId] });
      void qc.invalidateQueries({
        queryKey: ['maintenance-consumables-preview', input.planId],
      });
    },
  });
}

export function useRemoveMaintenanceConsumable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      assetId: string;
      planId: string;
      consumableId: string;
    }) =>
      api<{ id: string; removed: true }>(
        `/maintenance-consumables/${input.consumableId}`,
        { method: 'DELETE' },
      ),
    onSuccess: (_, input) => {
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['asset', input.assetId] });
      void qc.invalidateQueries({
        queryKey: ['maintenance-consumables-preview', input.planId],
      });
    },
  });
}

export function useAddMaintenanceConsumablesToShopping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { assetId: string; planId: string; date: string }) =>
      api<MaintenanceShoppingResult>(
        `/maintenance-plans/${input.planId}/shopping-items`,
        { method: 'POST', body: { date: input.date } },
      ),
    onSuccess: (_, input) => {
      void qc.invalidateQueries({ queryKey: ['shopping', input.date] });
      void qc.invalidateQueries({ queryKey: ['asset', input.assetId] });
      void qc.invalidateQueries({
        queryKey: ['maintenance-consumables-preview', input.planId],
      });
    },
  });
}

export function useCompleteMaintenancePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      assetId: string;
      planId: string;
      performedAt?: string;
      cost?: number | null;
      note?: string | null;
      consumeInventory?: boolean;
      idempotencyKey: string;
    }) =>
      api<MaintenanceCompletionResult>(
        `/maintenance-plans/${input.planId}/complete`,
        {
          method: 'POST',
          body: {
            performedAt: input.performedAt,
            cost: input.cost,
            note: input.note,
            consumeInventory: input.consumeInventory,
            idempotencyKey: input.idempotencyKey,
          },
        },
      ),
    onSuccess: (_, input) => {
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['asset', input.assetId] });
      void qc.invalidateQueries({ queryKey: ['reminder-sources'] });
      void qc.invalidateQueries({ queryKey: ['reminders'] });
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void qc.invalidateQueries({ queryKey: ['inventory-transactions'] });
      void qc.invalidateQueries({
        queryKey: ['maintenance-consumables-preview', input.planId],
      });
    },
  });
}

export function useReminderSources(start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: ['reminder-sources', start, end],
    queryFn: () =>
      api<ReminderSource[]>(`/reminder-sources?start=${start}&end=${end}`),
    enabled,
  });
}

export function useReminders(
  status: ReminderStatus | 'all' = 'all',
  enabled = true,
) {
  return useQuery({
    queryKey: ['reminders', status],
    queryFn: () => api<HouseholdReminder[]>(`/reminders?status=${status}`),
    enabled,
    refetchInterval: status === 'scheduled' || status === 'all' ? 15_000 : false,
  });
}

export interface ReminderInput {
  id?: string;
  sourceModule?: ReminderSourceModule;
  sourceId?: string;
  occurrenceDate?: string | null;
  remindAt: string;
  recipientIds: string[];
}

export function useUpsertReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: ReminderInput) =>
      id
        ? api<HouseholdReminder>(`/reminders/${id}`, {
            method: 'PATCH',
            body: { remindAt: body.remindAt, recipientIds: body.recipientIds },
          })
        : api<HouseholdReminder>('/reminders', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reminders'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useCancelReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<HouseholdReminder>(`/reminders/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['reminders'] }),
  });
}

export function usePolls(enabled = true) {
  return useQuery({
    queryKey: ['polls'],
    queryFn: () => api<HouseholdPoll[]>('/polls?status=all'),
    enabled,
  });
}

export interface PollInput {
  id?: string;
  title: string;
  description?: string | null;
  category: PollCategory;
  voteMode?: PollVoteMode;
  maxChoices?: number;
  closesAt?: string | null;
  options?: {
    label?: string;
    description?: string | null;
    mediaId?: string;
  }[];
  sourceModule?: 'media';
  sourceId?: string;
}

export function useUpsertPoll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: PollInput) =>
      id
        ? api<HouseholdPoll>(`/polls/${id}`, { method: 'PATCH', body })
        : api<HouseholdPoll>('/polls', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['polls'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['reminder-sources'] });
      void qc.invalidateQueries({ queryKey: ['reminders'] });
      void qc.invalidateQueries({ queryKey: ['media'] });
    },
  });
}

export function useVotePoll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, optionIds }: { id: string; optionIds: string[] }) =>
      api<HouseholdPoll>(`/polls/${id}/votes`, {
        method: 'POST',
        body: { optionIds },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['polls'] }),
  });
}

export function useSetPollStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'close' | 'reopen' }) =>
      api<HouseholdPoll>(`/polls/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['polls'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['reminder-sources'] });
      void qc.invalidateQueries({ queryKey: ['reminders'] });
      void qc.invalidateQueries({ queryKey: ['media'] });
    },
  });
}

export function useArchivePoll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; archived: true }>(`/polls/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['polls'] });
      void qc.invalidateQueries({ queryKey: ['reminder-sources'] });
      void qc.invalidateQueries({ queryKey: ['reminders'] });
      void qc.invalidateQueries({ queryKey: ['media'] });
    },
  });
}

export function useAddMenuItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      menuId: string;
      items: { dishId: string; note?: string }[];
    }) =>
      api<Menu>(`/menus/${input.menuId}/items`, {
        method: 'POST',
        body: { items: input.items },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['menu'] });
      void qc.invalidateQueries({ queryKey: ['menus'] });
      void qc.invalidateQueries({ queryKey: ['menu-dates'] });
      void qc.invalidateQueries({ queryKey: ['menu-events'] });
      void qc.invalidateQueries({ queryKey: ['calendar'] });
      void qc.invalidateQueries({ queryKey: ['reminder-sources'] });
      void qc.invalidateQueries({ queryKey: ['reminders'] });
    },
  });
}

export function useUpdateMenuItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      status?: MenuItemStatus;
      note?: string;
      assignedToId?: string | null;
      reason?: string;
      recipeVariantId?: string;
    }) =>
      api<MenuItem>(`/menu-items/${input.id}`, {
        method: 'PATCH',
        body: {
          status: input.status,
          note: input.note,
          assignedToId: input.assignedToId,
          reason: input.reason,
          recipeVariantId: input.recipeVariantId,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['menu'] });
      void qc.invalidateQueries({ queryKey: ['menus'] });
      void qc.invalidateQueries({ queryKey: ['menu-dates'] });
      void qc.invalidateQueries({ queryKey: ['menu-events'] });
      void qc.invalidateQueries({ queryKey: ['calendar'] });
      void qc.invalidateQueries({ queryKey: ['reminder-sources'] });
      void qc.invalidateQueries({ queryKey: ['reminders'] });
    },
  });
}

export function useAssignMenuChef() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { menuId: string; chefId: string | null }) =>
      api<Menu>(`/menus/${input.menuId}/chef`, {
        method: 'PATCH',
        body: { chefId: input.chefId },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['menu'] });
      void qc.invalidateQueries({ queryKey: ['menus'] });
      void qc.invalidateQueries({ queryKey: ['menu-events'] });
      void qc.invalidateQueries({ queryKey: ['calendar'] });
    },
  });
}

export function useCompleteMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (menuId: string) =>
      api<Menu>(`/menus/${menuId}/complete`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['menu'] });
      void qc.invalidateQueries({ queryKey: ['menus'] });
      void qc.invalidateQueries({ queryKey: ['menu-events'] });
      void qc.invalidateQueries({ queryKey: ['calendar'] });
      void qc.invalidateQueries({ queryKey: ['reminder-sources'] });
      void qc.invalidateQueries({ queryKey: ['reminders'] });
    },
  });
}

export function useMenuInventoryPreview(menuId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['menu-inventory-preview', menuId],
    queryFn: () =>
      api<MenuInventoryPreview>(`/menus/${menuId}/inventory-preview`),
    enabled,
  });
}

export function useConfirmMenuConsumption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (menuId: string) =>
      api<InventoryActionResult>(`/menus/${menuId}/confirm-consumption`, {
        method: 'POST',
      }),
    onSuccess: (_, menuId) => {
      void qc.invalidateQueries({ queryKey: ['menu-inventory-preview', menuId] });
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void qc.invalidateQueries({ queryKey: ['inventory-transactions'] });
    },
  });
}

export function useMenuEvents(menuId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['menu-events', menuId],
    queryFn: () => api<MenuEvent[]>(`/menus/${menuId}/events`),
    enabled,
  });
}

export function useMenuNotifications() {
  return useQuery({
    queryKey: ['menu-notifications'],
    queryFn: () => api<MenuEvent[]>('/menu-notifications'),
    refetchInterval: 30_000,
  });
}

export function useMarkMenuNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<MenuEvent>(`/menu-notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['menu-notifications'] }),
  });
}

export function useUpdateCookingPreference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefersCooking: boolean) =>
      api<Member>('/members/me/preferences', {
        method: 'PATCH',
        body: { prefersCooking },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['members'] }),
  });
}

export function useUpdatePassword() {
  return useMutation({
    mutationFn: (input: { currentPassword?: string; newPassword: string }) =>
      api<AccountProfile>('/accounts/me/password', {
        method: 'PATCH',
        body: input,
      }),
  });
}

export function useHouseholdInvitations(enabled = true) {
  return useQuery({
    queryKey: ['household-invitations'],
    queryFn: () =>
      api<HouseholdInvitation[]>('/household/invitations'),
    enabled,
  });
}

export function useCreateHouseholdInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      memberName: string;
      avatarEmoji?: string;
      role: 'admin' | 'member';
      expiresInHours?: number;
    }) =>
      api<CreatedHouseholdInvitation>('/household/invitations', {
        method: 'POST',
        body: input,
      }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['household-invitations'] }),
  });
}

export function useRevokeHouseholdInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<HouseholdInvitation>(`/household/invitations/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['household-invitations'] }),
  });
}

export function useShoppingList(date: string) {
  return useQuery({
    queryKey: ['shopping', date],
    queryFn: () => api<ShoppingItem[]>(`/shopping-list?date=${date}`),
  });
}

export function useGenerateShoppingList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (date: string) =>
      api<ShoppingItem[]>('/shopping-list/generate', {
        method: 'POST',
        body: { date },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['shopping'] }),
  });
}

export function useCheckShoppingItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; checked: boolean }) =>
      api<ShoppingItem>(`/shopping-items/${input.id}`, {
        method: 'PATCH',
        body: { checked: input.checked },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['shopping'] }),
  });
}

export function useAddManualShoppingItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      date: string;
      customName: string;
      totalQty: number;
      unit: string;
    }) =>
      api<ShoppingItem>('/shopping-items', { method: 'POST', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['shopping'] }),
  });
}

export function useDeleteShoppingItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; removed: true }>(`/shopping-items/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['shopping'] }),
  });
}

export function useShoppingInventoryPreview(
  shoppingItemId: string | null,
  inventoryItemId: string | null,
  enabled: boolean,
) {
  const query = inventoryItemId
    ? `?inventoryItemId=${encodeURIComponent(inventoryItemId)}`
    : '';
  return useQuery({
    queryKey: ['shopping-inventory-preview', shoppingItemId, inventoryItemId],
    queryFn: () =>
      api<ShoppingInventoryPreview>(
        `/shopping-items/${shoppingItemId}/inventory-preview${query}`,
      ),
    enabled: enabled && Boolean(shoppingItemId),
  });
}

export function useConfirmShoppingReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { shoppingItemId: string; inventoryItemId?: string }) =>
      api<InventoryActionResult>(
        `/shopping-items/${input.shoppingItemId}/confirm-stock`,
        {
          method: 'POST',
          body: { inventoryItemId: input.inventoryItemId },
        },
      ),
    onSuccess: (_, input) => {
      void qc.invalidateQueries({ queryKey: ['shopping'] });
      void qc.invalidateQueries({
        queryKey: ['shopping-inventory-preview', input.shoppingItemId],
      });
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void qc.invalidateQueries({ queryKey: ['inventory-transactions'] });
    },
  });
}

export interface InventoryUpsertInput {
  id?: string;
  ingredientId?: string | null;
  name: string;
  category: InventoryCategory;
  quantity: number;
  unit: string;
  lowStockThreshold: number;
  restockQuantity: number;
  idempotencyKey?: string;
}

export function useInventory() {
  return useQuery({
    queryKey: ['inventory'],
    queryFn: () => api<InventoryItem[]>('/inventory'),
  });
}

export function useUpsertInventoryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, idempotencyKey, ...body }: InventoryUpsertInput) =>
      id
        ? api<InventoryItem>(`/inventory-items/${id}`, {
            method: 'PATCH',
            body: {
              ...body,
              idempotencyKey:
                idempotencyKey ??
                `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            },
          })
        : api<InventoryItem>('/inventory-items', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void qc.invalidateQueries({ queryKey: ['inventory-transactions'] });
    },
  });
}

export function useDeleteInventoryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; removed: true }>(`/inventory-items/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['inventory'] }),
  });
}

export function useInventoryTransactions(limit = 40) {
  return useQuery({
    queryKey: ['inventory-transactions', limit],
    queryFn: () =>
      api<InventoryTransaction[]>(`/inventory-transactions?limit=${limit}`),
  });
}

export function useReverseInventoryTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<InventoryActionResult>(`/inventory-transactions/${id}/reverse`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void qc.invalidateQueries({ queryKey: ['inventory-transactions'] });
      void qc.invalidateQueries({ queryKey: ['shopping'] });
      void qc.invalidateQueries({ queryKey: ['menu-inventory-preview'] });
    },
  });
}

export interface DishUpsertInput {
  id?: string;
  name: string;
  category: string;
  difficulty: number;
  estMinutes?: number;
  note?: string;
  photoUrl?: string;
  recipeSteps: DishRecipeStep[];
  referenceLinks: DishReferenceLink[];
  ingredients: { name: string; quantity: number; unit: string; category?: string }[];
}

export interface RecipeVariantInput {
  id?: string;
  dishId: string;
  name: string;
  isDefault?: boolean;
  note?: string | null;
  estMinutes?: number | null;
  ingredients: {
    ingredientId?: string;
    name?: string;
    category?: string;
    quantity: number;
    unit: string;
  }[];
  steps: { text: string; imageUrl?: string | null }[];
  referenceLinks: { title?: string | null; url: string }[];
}

export function useUpsertRecipeVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dishId, ...body }: RecipeVariantInput) =>
      id
        ? api<DishRecipeVariant>(`/recipe-variants/${id}`, {
            method: 'PATCH',
            body,
          })
        : api<DishRecipeVariant>(`/dishes/${dishId}/recipe-variants`, {
            method: 'POST',
            body,
          }),
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: ['recipes'] });
      void qc.invalidateQueries({ queryKey: ['recipes', input.dishId] });
      void qc.invalidateQueries({ queryKey: ['dishes'] });
    },
  });
}

export function useArchiveRecipeVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; dishId: string }) =>
      api<{ id: string; archived: true }>(`/recipe-variants/${input.id}`, {
        method: 'DELETE',
      }),
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: ['recipes'] });
      void qc.invalidateQueries({ queryKey: ['recipes', input.dishId] });
    },
  });
}

export function useUpsertDishSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      dishId: string;
      memberId?: string;
      preferredRecipeId?: string | null;
      level?: DishSkillLevel;
      note?: string | null;
    }) =>
      api<MemberDishSkill>('/member-dish-skills', {
        method: 'POST',
        body: input,
      }),
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: ['recipes'] });
      void qc.invalidateQueries({ queryKey: ['recipes', input.dishId] });
    },
  });
}

export function useRemoveDishSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { memberId: string; dishId: string }) =>
      api<{ removed: true }>(
        `/members/${input.memberId}/dish-skills/${input.dishId}`,
        { method: 'DELETE' },
      ),
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: ['recipes'] });
      void qc.invalidateQueries({ queryKey: ['recipes', input.dishId] });
    },
  });
}

export function useUpsertDish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: DishUpsertInput) =>
      id
        ? api<Dish>(`/dishes/${id}`, { method: 'PATCH', body })
        : api<Dish>('/dishes', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['dishes'] });
      void qc.invalidateQueries({ queryKey: ['recipes'] });
    },
  });
}

export function useRemoveDish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/dishes/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['dishes'] });
      void qc.invalidateQueries({ queryKey: ['recipes'] });
    },
  });
}
