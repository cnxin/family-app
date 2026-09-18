import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreatedGuestInvitation,
  Guest,
  GuestMealRequest,
  GuestWifiProfile,
  GuestWifiSecurity,
  Visit,
} from '@family/contracts';
import { api } from '../api';

export function useGuests() {
  return useQuery({
    queryKey: ['guests'],
    queryFn: () => api<Guest[]>('/guests'),
  });
}

export function useVisits() {
  return useQuery({
    queryKey: ['visits'],
    queryFn: () => api<Visit[]>('/visits'),
  });
}

export function useGuestWifiProfiles() {
  return useQuery({
    queryKey: ['guest-wifi-profiles'],
    queryFn: () => api<GuestWifiProfile[]>('/guest-wifi-profiles'),
  });
}

function invalidateGuests(client: ReturnType<typeof useQueryClient>) {
  for (const key of ['guests', 'visits', 'guest-wifi-profiles', 'calendar', 'notifications']) {
    void client.invalidateQueries({ queryKey: [key] });
  }
}

export function useUpsertGuest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id?: string;
      body: { name?: string; avatarEmoji?: string; note?: string | null; isActive?: boolean };
    }) =>
      input.id
        ? api<Guest>(`/guests/${input.id}`, { method: 'PATCH', body: input.body })
        : api<Guest>('/guests', { method: 'POST', body: input.body }),
    onSuccess: () => invalidateGuests(client),
  });
}

/** 匿名化：抹掉访客资料并作废他手上的邀请，幂等。 */
export function useAnonymizeGuest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Guest>(`/guests/${id}/anonymize`, { method: 'POST' }),
    onSuccess: () => invalidateGuests(client),
  });
}

export function useUpsertGuestWifiProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id?: string;
      body: {
        name?: string;
        ssid?: string;
        security?: GuestWifiSecurity;
        password?: string | null;
        isActive?: boolean;
      };
    }) =>
      input.id
        ? api<GuestWifiProfile>(`/guest-wifi-profiles/${input.id}`, {
            method: 'PATCH',
            body: input.body,
          })
        : api<GuestWifiProfile>('/guest-wifi-profiles', { method: 'POST', body: input.body }),
    onSuccess: () => invalidateGuests(client),
  });
}

export function useUpsertVisit() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id?: string;
      body: {
        title?: string;
        startsAt?: string;
        endsAt?: string | null;
        note?: string | null;
        guestWifiProfileId?: string | null;
        guestIds?: string[];
        status?: Visit['status'];
      };
    }) =>
      input.id
        ? api<Visit>(`/visits/${input.id}`, { method: 'PATCH', body: input.body })
        : api<Visit>('/visits', { method: 'POST', body: input.body }),
    onSuccess: () => invalidateGuests(client),
  });
}

/** 签发邀请链接：明文令牌只在这一次响应里出现，旧的自动作废。 */
export function useCreateGuestInvitation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      visitId: string;
      guestId: string;
      expiresInHours?: number;
      allowsMovieVoting?: boolean;
      allowsMealRequests?: boolean;
    }) =>
      api<CreatedGuestInvitation>(`/visits/${input.visitId}/invitations`, {
        method: 'POST',
        body: {
          guestId: input.guestId,
          ...(input.expiresInHours ? { expiresInHours: input.expiresInHours } : {}),
          ...(input.allowsMovieVoting === undefined
            ? {}
            : { allowsMovieVoting: input.allowsMovieVoting }),
          ...(input.allowsMealRequests === undefined
            ? {}
            : { allowsMealRequests: input.allowsMealRequests }),
        },
      }),
    onSuccess: () => invalidateGuests(client),
  });
}

export function useRevokeGuestInvitation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; revoked: true }>(`/guest-invitations/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateGuests(client),
  });
}

/** 家里人接受或婉拒访客的点菜请求。 */
export function useReviewGuestMealRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; status: 'accepted' | 'rejected'; reviewNote?: string | null }) =>
      api<GuestMealRequest>(`/guest-meal-requests/${input.id}`, {
        method: 'PATCH',
        body: { status: input.status, reviewNote: input.reviewNote ?? null },
      }),
    onSuccess: () => {
      invalidateGuests(client);
      void client.invalidateQueries({ queryKey: ['menu'] });
      void client.invalidateQueries({ queryKey: ['menus-of-date'] });
    },
  });
}
