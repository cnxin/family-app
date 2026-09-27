import { z } from 'zod';
import { uuid } from './common';
import { defineEndpoint } from './registry';

/** 用 Intl 试构造，拦掉不存在的 IANA 名。空字符串不算合法。 */
export const ianaTimeZone = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, '不是合法的 IANA 时区');

export const updateHouseholdTimezoneBody = z.object({ timezone: ianaTimeZone }).strict();
export type UpdateHouseholdTimezoneBody = z.infer<typeof updateHouseholdTimezoneBody>;

export const householdTimezoneSchema = z.object({
  id: uuid,
  name: z.string(),
  timezone: z.string().min(1),
});
export type HouseholdTimezone = z.infer<typeof householdTimezoneSchema>;

export const households = {
  updateMine: defineEndpoint({
    method: 'PATCH',
    path: '/households/me',
    summary: '管理员修改家庭时区（只接受 timezone）',
    body: updateHouseholdTimezoneBody,
    response: householdTimezoneSchema,
  }),
};
