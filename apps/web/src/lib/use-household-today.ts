import { useEffect, useState } from 'react';
import { addDays, householdToday, startOfHouseholdDay } from '@family/shared';
import { useAuth } from './auth';

/** 家庭日期自动在家庭零点更新；设备时区变化不会改变家庭的今天。 */
export function useHouseholdToday(): string {
  const { session } = useAuth();
  const timezone = session?.householdTimezone ?? 'Asia/Shanghai';
  const [today, setToday] = useState(() => householdToday(timezone));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      const now = new Date();
      const current = householdToday(timezone, now);
      setToday(current);
      const next = startOfHouseholdDay(timezone, addDays(current, 1)).getTime();
      timer = setTimeout(schedule, Math.max(1, next - now.getTime() + 10));
    };
    schedule();
    // 返回前台 / 系统时钟被用户更改时也及时校正。
    const resync = () => { if (document.visibilityState === 'visible') schedule(); };
    document.addEventListener('visibilitychange', resync);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', resync);
    };
  }, [timezone]);
  return today;
}
