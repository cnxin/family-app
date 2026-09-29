import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreatedHouseholdInvitation,
  HouseholdInvitation,
  ManagedMember,
  MemberRole,
} from '@family/contracts';
import { api } from '../api';

/** 管理视角的成员列表：含停用的人和账号摘要。 */
export function useManagedMembers() {
  return useQuery({
    queryKey: ['household-members'],
    queryFn: () => api<ManagedMember[]>('/household/members'),
  });
}

function invalidateMembers(client: ReturnType<typeof useQueryClient>) {
  for (const key of ['household-members', 'members', 'points-accounts']) {
    void client.invalidateQueries({ queryKey: [key] });
  }
}

/**
 * 先把服务端回来的这一行写进管理列表的缓存，再让大家重新拉：光靠失效的话，重新拉取完成之前
 * 再打开这个人的编辑框，拿到的还是改之前的那一行——这时再点保存，会把刚才的修改改回去。
 */
function saveMember(client: ReturnType<typeof useQueryClient>, saved: ManagedMember) {
  client.setQueryData<ManagedMember[]>(['household-members'], (list) =>
    list?.map((one) => (one.id === saved.id ? saved : one)),
  );
  invalidateMembers(client);
}

export function useUpdateManagedMember() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      body: { name?: string; avatarEmoji?: string; role?: MemberRole; prefersCooking?: boolean };
    }) =>
      api<ManagedMember>(`/household/members/${input.id}`, {
        method: 'PATCH',
        body: input.body,
      }),
    onSuccess: (saved) => saveMember(client, saved),
  });
}

/** 停用 / 恢复家庭访问。改角色和停用都会撤销对方的会话。 */
export function useUpdateManagedMemberStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      api<ManagedMember>(`/household/members/${input.id}/status`, {
        method: 'PATCH',
        body: { enabled: input.enabled },
      }),
    onSuccess: (saved) => saveMember(client, saved),
  });
}

export function useHouseholdInvitations() {
  return useQuery({
    queryKey: ['household-invitations'],
    queryFn: () => api<HouseholdInvitation[]>('/household/invitations'),
  });
}

/** 明文邀请码只在这一次响应里出现，服务端只存哈希——所以创建完要立刻给人看到。 */
export function useCreateInvitation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      memberName: string;
      avatarEmoji?: string;
      role?: 'admin' | 'member';
      expiresInHours?: number;
    }) => api<CreatedHouseholdInvitation>('/household/invitations', { method: 'POST', body }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['household-invitations'] }),
  });
}

export function useRevokeInvitation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ revoked: true }>(`/household/invitations/${id}`, { method: 'DELETE' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['household-invitations'] }),
  });
}
