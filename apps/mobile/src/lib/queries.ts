import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from './api';
import type {
  AccountProfile,
  AppNotification,
  CalendarEntry,
  CalendarEvent,
  CreatedGuestInvitation,
  CreatedHouseholdInvitation,
  Dish,
  Guest,
  GuestInvitationPreview,
  GuestWifiProfile,
  HouseholdPoll,
  HouseholdReminder,
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
  InventoryItem,
  Member,
  ManagedMember,
  MealType,
  MediaType,
  Menu,
  MenuDateCount,
  MenuEvent,
  MenuItem,
  MenuItemStatus,
  MemberDishSkill,
  PollCategory,
  PollVoteMode,
  RecipeDish,
  ReminderSource,
  ReminderSourceModule,
  ReminderStatus,
  ShoppingItem,
  TaskInstanceStatus,
  TaskOccurrence,
  TaskRecurrence,
  ViewingProgress,
  ViewingSession,
  Visit,
  VisitStatus,
} from './types';

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
    mutationFn: ({ visitId, ...body }: { visitId: string; guestId: string; expiresInHours?: number }) =>
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
    },
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

export interface InventoryUpsertInput {
  id?: string;
  name: string;
  category: InventoryCategory;
  quantity: number;
  unit: string;
  lowStockThreshold: number;
  restockQuantity: number;
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
    mutationFn: ({ id, ...body }: InventoryUpsertInput) =>
      id
        ? api<InventoryItem>(`/inventory-items/${id}`, { method: 'PATCH', body })
        : api<InventoryItem>('/inventory-items', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['inventory'] }),
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
