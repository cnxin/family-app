import { EntityManager } from 'typeorm';
import { JwtUser } from '../auth/jwt.guard';
import { ActivityModule, HouseholdActivityLog } from '../entities';

export interface ActivityLogInput {
  module: ActivityModule;
  action: string;
  summary: string;
  detail?: string | null;
  subjectMemberId?: string | null;
  targetPath?: string | null;
  metadata?: Record<string, unknown>;
}

export function recordActivity(
  manager: EntityManager,
  user: JwtUser,
  input: ActivityLogInput,
) {
  const repository = manager.getRepository(HouseholdActivityLog);
  return repository.save(
    repository.create({
      householdId: user.householdId,
      actorId: user.memberId,
      actorName: user.name,
      subjectMemberId: input.subjectMemberId ?? null,
      module: input.module,
      action: input.action,
      summary: input.summary.slice(0, 180),
      detail: input.detail?.slice(0, 500) || null,
      targetPath: input.targetPath?.slice(0, 300) || null,
      metadata: input.metadata ?? {},
    }),
  );
}
