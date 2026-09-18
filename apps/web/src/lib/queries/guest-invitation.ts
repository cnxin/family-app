import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  GuestInvitationPreview,
  GuestMealOption,
  GuestMealRequest,
  GuestMoviePoll,
  MealType,
} from '@family/contracts';
import { api } from '../api';

/**
 * 公开邀请页这一组全部 `auth: false`：访客没有家庭账号，令牌本身就是凭证。
 * 带上家里人的令牌反而会让 401 触发续期、续期失败再把人踢到登录页——
 * 而这个页面恰恰是给没登录的人看的。
 */
function publicApi<T>(path: string, options: { method?: string; body?: unknown } = {}) {
  return api<T>(path, { ...options, auth: false });
}

/** 令牌失效（过期/撤销/来访取消）后端回 404，重试没有意义，直接把错误交给页面。 */
export function useGuestInvitation(token: string | undefined) {
  return useQuery({
    queryKey: ['guest-invitation', token],
    queryFn: () => publicApi<GuestInvitationPreview>(`/guest-invitations/${token}`),
    enabled: Boolean(token),
    retry: false,
  });
}

export function useRespondGuestInvitation(token: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (attending: boolean) =>
      publicApi<GuestInvitationPreview>(`/guest-invitations/${token}/response`, {
        method: 'POST',
        body: { attending },
      }),
    onSuccess: (data) => client.setQueryData(['guest-invitation', token], data),
  });
}

export function useGuestMoviePolls(token: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['guest-movie-polls', token],
    queryFn: () => publicApi<GuestMoviePoll[]>(`/guest-invitations/${token}/movie-polls`),
    enabled: Boolean(token) && enabled,
    retry: false,
  });
}

export function useVoteGuestMoviePoll(token: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { pollId: string; optionIds: string[] }) =>
      publicApi<GuestMoviePoll>(
        `/guest-invitations/${token}/movie-polls/${input.pollId}/votes`,
        { method: 'POST', body: { optionIds: input.optionIds } },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['guest-movie-polls', token] });
    },
  });
}

export function useGuestMealOptions(token: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['guest-meal-options', token],
    queryFn: () => publicApi<GuestMealOption[]>(`/guest-invitations/${token}/meal-options`),
    enabled: Boolean(token) && enabled,
    retry: false,
  });
}

export function useGuestMealRequests(token: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['guest-meal-requests', token],
    queryFn: () => publicApi<GuestMealRequest[]>(`/guest-invitations/${token}/meal-requests`),
    enabled: Boolean(token) && enabled,
    retry: false,
  });
}

function invalidateMeals(client: ReturnType<typeof useQueryClient>, token: string | undefined) {
  void client.invalidateQueries({ queryKey: ['guest-meal-options', token] });
  void client.invalidateQueries({ queryKey: ['guest-meal-requests', token] });
}

/** 从菜单里选一道（幂等：再点一次拿回同一条请求）。 */
export function useClaimGuestMealOption(token: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (menuItemId: string) =>
      publicApi<GuestMealRequest>(
        `/guest-invitations/${token}/meal-options/${menuItemId}/request`,
        { method: 'POST' },
      ),
    onSuccess: () => invalidateMeals(client, token),
  });
}

/** 菜单外自由点菜：同一天同一餐再提交就是覆盖。 */
export function useSubmitGuestMealRequest(token: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      mealDate: string;
      mealType: MealType;
      dishName: string;
      note?: string | null;
    }) =>
      publicApi<GuestMealRequest>(`/guest-invitations/${token}/meal-requests`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => invalidateMeals(client, token),
  });
}
