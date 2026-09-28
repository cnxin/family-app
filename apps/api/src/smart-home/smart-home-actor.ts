import { DataSource, IsNull } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import { Member } from '../entities';

/** 智能家居联动以这个身份做事：标记在 sid 上，E4 据此认出「这次打勾是联动自己打的」，不再触发联动（防自激）。 */
export const SMART_HOME_ACTOR_SID = 'smart-home-linkage';
export const SMART_HOME_ACTOR_NAME = '智能家居联动';

export function isSmartHomeActor(user: JwtUser) {
  return user.sid === SMART_HOME_ACTOR_SID;
}

/** webhook、定时触发都没有登录用户：以最早的在用家庭主人的名义执行，显示名标明是联动做的。 */
export async function smartHomeActor(dataSource: DataSource, householdId: string): Promise<JwtUser | null> {
  const owner = await dataSource.getRepository(Member).findOne({
    where: { householdId, role: 'owner', disabledAt: IsNull() },
    order: { createdAt: 'ASC' },
  });
  if (!owner) return null;
  return {
    sub: '',
    accountId: '',
    memberId: owner.id,
    householdId,
    sid: SMART_HOME_ACTOR_SID,
    name: SMART_HOME_ACTOR_NAME,
    role: 'owner',
  };
}
