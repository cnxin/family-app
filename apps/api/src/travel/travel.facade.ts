import type { TravelFacade } from '@family/contracts';
import type { TravelService } from './travel.module';

/** 出行门面的实现（J4.1，接口见 contracts/plugins/travel.facade.ts），TravelModule 启动时注册。 */
export function travelFacade(travel: TravelService): TravelFacade {
  return {
    planChecklist: (planId, actor) => travel.detail(planId, actor),
  };
}
