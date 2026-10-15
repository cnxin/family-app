import { MediaConnectorConfig } from '../src/media/connectors.config';

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function config(
  kind: MediaConnectorConfig['kind'],
  credential = 'contract-secret',
): MediaConnectorConfig {
  return {
    key: kind,
    kind,
    name: kind === 'moviepilot' ? 'MoviePilot' : kind === 'plex' ? 'Plex' : 'Emby',
    baseUrl: `http://${kind}.test`,
    credential,
    primary: kind === 'plex',
  };
}

export const references = [
  { provider: 'tmdb' as const, mediaType: 'movie' as const, externalId: '550' },
  { provider: 'imdb' as const, mediaType: 'movie' as const, externalId: 'tt0137523' },
];

export const seriesReferences = [
  { provider: 'tmdb' as const, mediaType: 'series' as const, externalId: '1399' },
];
