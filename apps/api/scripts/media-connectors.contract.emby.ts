import { EmbyLibraryProvider } from '../src/media/connectors.emby';
import {
  assert,
  json,
  config,
  references,
  seriesReferences,
} from './media-connectors.contract.helpers';

export async function testEmby() {
  const requests: URL[] = [];
  const provider = new EmbyLibraryProvider(
    config('emby'),
    (async (input, init) => {
      const url = new URL(String(input));
      requests.push(url);
      assert(
        new Headers(init?.headers).get('X-Emby-Token') === 'contract-secret',
        'Emby API Key 只通过请求头发送',
      );
      if (url.pathname === '/System/Info') {
        return json({ Id: 'emby-server-id', Version: '4.9.1' });
      }
      if (url.pathname === '/Items') {
        if (url.searchParams.has('AnyProviderIdEquals')) {
          assert(
            url.searchParams.get('AnyProviderIdEquals')?.includes('Tmdb.'),
            '使用 TMDB ProviderId 查询 Emby',
          );
          if (url.searchParams.get('AnyProviderIdEquals')?.includes('Tmdb.1399')) {
            return json({
              TotalRecordCount: 1,
              Items: [
                {
                  Id: 'emby-series-7',
                  Type: 'Series',
                  Name: 'Game of Thrones',
                  ProviderIds: { Tmdb: '1399' },
                },
              ],
            });
          }
        }
        return json({
          TotalRecordCount: 1,
          Items: [
            {
              Id: 'emby-item-7',
              Type: 'Movie',
              Name: 'Fight Club',
              ProductionYear: 1999,
              ProviderIds: { Tmdb: '550', Imdb: 'tt0137523' },
              ImageTags: { Primary: 'emby-poster-tag' },
            },
          ],
        });
      }
      if (url.pathname === '/Users') {
        return json([
          { Id: 'emby-user-1', Name: '爸爸 Emby', Policy: { IsDisabled: false } },
          { Id: 'emby-user-2', Name: '妈妈 Emby', Policy: { IsDisabled: true } },
        ]);
      }
      if (url.pathname === '/Items/emby-item-7/Images/Primary') {
        return new Response('emby-poster', {
          headers: { 'Content-Type': 'image/png' },
        });
      }
      if (url.pathname === '/Shows/emby-series-7/Seasons') {
        return json({
          Items: [
            { IndexNumber: 1, ChildCount: 12 },
            { IndexNumber: 2, ChildCount: 10 },
          ],
        });
      }
      return json({}, 404);
    }) as typeof fetch,
  );
  const health = await provider.health();
  const users = await provider.listUsers();
  const library = await provider.listItems();
  const matches = await provider.findByExternalRefs(references);
  const seriesMatches = await provider.findByExternalRefs(seriesReferences, {
    seasons: [2],
  });
  const poster = await provider.getPoster('emby-item-7', library[0].metadata);
  assert(health.available && health.message === 'Emby 4.9.1', '读取 Emby 版本');
  assert(
    users.serverId === 'emby-server-id' &&
      users.users.length === 2 &&
      users.users[1].isDisabled,
    '读取 Emby 稳定服务器标识和用户状态',
  );
  assert(
    matches.length === 1 &&
      matches[0].playbackUrl ===
        'http://emby.test/web/index.html#!/item?id=emby-item-7&serverId=emby-server-id',
    '匹配 Emby 条目并生成无密钥播放链接',
  );
  assert(
    seriesMatches[0]?.seasons[0]?.season === 2 &&
      seriesMatches[0]?.seasons[0]?.episodeCount === 10,
    'Emby 只返回请求季的已发现集数',
  );
  assert(
    library.length === 1 && library[0].externalRefs.length === 2,
    '分页读取 Emby 媒体库及外部编号',
  );
  assert(
    poster?.contentType === 'image/png' &&
      poster.body.toString() === 'emby-poster' &&
      !requests.some((url) => url.search.includes('contract-secret')),
    '通过请求头安全读取 Emby 海报',
  );
}
