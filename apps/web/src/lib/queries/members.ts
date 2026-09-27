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
    onSuccess: () => invalidateMembers(client),
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
    onSuccess: () => invalidateMembers(client),
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
