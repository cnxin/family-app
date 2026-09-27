import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountProfile,
  AgentMemberProfile,
  AgentRoutine,
  AgentSettings,
  MemberProfile,
} from '@family/contracts';
import { api } from '../api';

/** 自己的「经常掌勺」偏好——成员自己就能改，不用管理员。 */
export function useUpdateCookingPreference() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (prefersCooking: boolean) =>
      api<MemberProfile>('/members/me/preferences', {
        method: 'PATCH',
        body: { prefersCooking },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['members'] });
      void client.invalidateQueries({ queryKey: ['household-members'] });
    },
  });
}

/** 改密码会撤销其他设备的会话，当前这台不受影响。 */
export function useUpdatePassword() {
  return useMutation({
    mutationFn: (body: { currentPassword?: string; newPassword: string }) =>
      api<AccountProfile>('/accounts/me/password', { method: 'PATCH', body }),
  });
}

export function useAgentProfile() {
  return useQuery({
    queryKey: ['agent-profile'],
    queryFn: () => api<AgentMemberProfile>('/agent/profile'),
  });
}

/** 个人智能体偏好用乐观锁：要带上读到的 version。 */
export function useUpdateAgentProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      expectedVersion: number;
      assistantName?: string;
      responseStyle?: AgentMemberProfile['responseStyle'];
      memoryEnabled?: boolean;
      memorySuggestionEnabled?: boolean;
      proactiveRoutinesEnabled?: boolean;
    }) => api<AgentMemberProfile>('/agent/profile', { method: 'PATCH', body }),
    onSuccess: (profile) => client.setQueryData(['agent-profile'], profile),
  });
}

export function useAgentSettings(enabled: boolean) {
  return useQuery({
    queryKey: ['agent-settings'],
    queryFn: () => api<AgentSettings>('/agent/settings'),
    enabled,
  });
}

export function useAgentRoutines(enabled: boolean) {
  return useQuery({
    queryKey: ['agent-routines'],
    queryFn: () => api<AgentRoutine[]>('/agent/routines'),
    enabled,
  });
}

/** 夜间摘要推送：一次校验「设置」和「例行任务」两个版本号，所以两边都要先读到。 */
export function useConfigureNightlyDelivery() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      enabled: boolean;
      expectedSettingsVersion: number;
      expectedRoutineVersion: number;
    }) =>
      api<{ enabled: boolean; settingsVersion: number }>(
        '/agent/routines/nightly_digest/delivery',
        { method: 'PUT', body },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['agent-settings'] });
      void client.invalidateQueries({ queryKey: ['agent-routines'] });
    },
  });
}
