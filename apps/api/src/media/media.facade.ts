import type { MediaFacade } from '@family/contracts';
import type { MediaService } from './media.module';

/** 观影门面的实现（J4.1，接口见 contracts/plugins/media.facade.ts），MediaModule 启动时注册。 */
export function mediaFacade(media: MediaService): MediaFacade {
  return {
    listWatchlist: (actor) => media.list({ status: 'all' }, actor),
  };
}
