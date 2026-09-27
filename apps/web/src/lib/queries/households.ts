import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { HouseholdTimezone } from '@family/contracts';
import { api } from '../api';
import { useAuth } from '../auth';
import { attentionKey } from './attention';

/** 改时区只影响「今天」怎么划，所以日期相关的缓存要全部作废。 */
export function useUpdateHouseholdTimezone() {
  const client = useQueryClient();
  const { setHouseholdTimezone } = useAuth();
  return useMutation({
    mutationFn: (timezone: string) =>
      api<HouseholdTimezone>('/households/me', { method: 'PATCH', body: { timezone } }),
    onSuccess: (household) => {
      setHouseholdTimezone(household.timezone);
      void client.invalidateQueries({ queryKey: attentionKey });
      void client.invalidateQueries({ queryKey: ['calendar'] });
      void client.invalidateQueries({ queryKey: ['menus-of-date'] });
      void client.invalidateQueries({ queryKey: ['menu'] });
      void client.invalidateQueries({ queryKey: ['tasks'] });
      void client.invalidateQueries({ queryKey: ['reminders'] });
      void client.invalidateQueries({ queryKey: ['shopping'] });
    },
  });
}
