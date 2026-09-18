import { z } from 'zod';
import {
  dateOnly,
  idParams,
  isoDateTime,
  memberBriefSchema,
  nullableDateTime,
  removedResponse,
  uuid,
} from './common';
import { defineEndpoint } from './registry';

// 对应 apps/api/src/media/*.ts 与 docs/m4-media-acceptance.md
//
// 这个域 32 个端点的响应全部经 presenter 或手写字面量对象产出，没有一处直接回传实体，
// 所以 relations / eager / save() 那套加载路径规律不影响响应形状——照着 presenter 抄即可。
//
// 外部连接器（Plex / Emby / MoviePilot）与元数据源（TMDB / 豆瓣 / Bangumi）在测试环境里都是空配置。
// 空配置**不改变任何响应的键集**，只改变值：可空字段为 null、数组为空、state 落在
// 'not_configured' / 'needs_credential' / 'disabled' / 'offline' 这几个字面量上；
// 依赖外部服务才能完成的端点（library/sync、playback-webhook、三个 requests 端点、poster 等）
// 在空配置下直接抛 502，根本不产生成功响应。所以每个端点一份 schema 就够，但可空字段要写满。
// 接了真实连接器之后（Phase 3 之后）需要回来复核"已配置"分支的取值范围。

export const MEDIA_TYPES = ['movie', 'series'] as const;
export const mediaType = z.enum(MEDIA_TYPES);
export type MediaType = z.infer<typeof mediaType>;

export const MEDIA_METADATA_SOURCES = ['tmdb', 'douban', 'bangumi'] as const;
export const mediaMetadataSource = z.enum(MEDIA_METADATA_SOURCES);
export type MediaMetadataSource = z.infer<typeof mediaMetadataSource>;

export const MEDIA_EXTERNAL_PROVIDERS = [
  'tmdb',
  'imdb',
  'douban',
  'bangumi',
  'plex',
  'emby',
  'moviepilot',
] as const;
export const mediaExternalProvider = z.enum(MEDIA_EXTERNAL_PROVIDERS);
export type MediaExternalProvider = z.infer<typeof mediaExternalProvider>;

/** 元数据侧的外部站点（不含媒体服务器）。 */
export const mediaMetadataExternalProvider = z.enum(['tmdb', 'douban', 'bangumi', 'imdb']);
export type MediaMetadataExternalProvider = z.infer<typeof mediaMetadataExternalProvider>;

export const HOUSEHOLD_MEDIA_STATUSES = [
  'watchlist',
  'voting',
  'scheduled',
  'watching',
  'completed',
  'dropped',
] as const;
export const householdMediaStatus = z.enum(HOUSEHOLD_MEDIA_STATUSES);
export type HouseholdMediaStatus = z.infer<typeof householdMediaStatus>;

export const MEDIA_REQUEST_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
] as const;
export const mediaRequestStatus = z.enum(MEDIA_REQUEST_STATUSES);
export type MediaRequestStatus = z.infer<typeof mediaRequestStatus>;

export const MEDIA_CONNECTOR_KINDS = ['plex', 'emby', 'moviepilot'] as const;
export const mediaConnectorKind = z.enum(MEDIA_CONNECTOR_KINDS);
export type MediaConnectorKind = z.infer<typeof mediaConnectorKind>;

export const MEDIA_LIBRARY_PROVIDER_KINDS = ['plex', 'emby'] as const;
export const mediaLibraryProviderKind = z.enum(MEDIA_LIBRARY_PROVIDER_KINDS);
export type MediaLibraryProviderKind = z.infer<typeof mediaLibraryProviderKind>;

/** 连接器状态；后四个只在未配置/离线时出现，测试环境里全是这几个。 */
export const MEDIA_CONNECTOR_STATES = [
  'disabled',
  'not_configured',
  'needs_credential',
  'online',
  'offline',
] as const;
export const mediaConnectorState = z.enum(MEDIA_CONNECTOR_STATES);
export type MediaConnectorState = z.infer<typeof mediaConnectorState>;

/** 元数据源状态比连接器少两个字面量。 */
export const MEDIA_SOURCE_STATES = ['not_configured', 'online', 'offline'] as const;
export const mediaSourceState = z.enum(MEDIA_SOURCE_STATES);

export const VIEWING_SESSION_STATUSES = ['active', 'paused', 'stopped', 'completed'] as const;
export const viewingSessionStatus = z.enum(VIEWING_SESSION_STATUSES);
export type ViewingSessionStatus = z.infer<typeof viewingSessionStatus>;

export const MEDIA_SETTINGS_MODES = ['household', 'server_default'] as const;

export const mediaSettingsMode = z.enum(MEDIA_SETTINGS_MODES);
export type MediaSettingsMode = z.infer<typeof mediaSettingsMode>;

export const mediaConnectorRole = z.enum(['library', 'automation']);
export type MediaConnectorRole = z.infer<typeof mediaConnectorRole>;
export const mediaCredentialKind = z.enum(['token', 'api_key']);
export type MediaCredentialKind = z.infer<typeof mediaCredentialKind>;

/** 海报与播放地址可能是相对签名路径，也可能是连接器给的绝对 URL——别用 .url()。 */
const linkUrl = z.string();

// ---- 响应：片单 -------------------------------------------------------------

/** MediaService.present() 里的 mediaTitle.externalRefs（实体行，带 id/connectorKey）。 */
export const mediaExternalRefSchema = z.object({
  id: uuid,
  provider: mediaExternalProvider,
  externalId: z.string(),
  connectorKey: z.string().nullable(),
});
export type MediaExternalRef = z.infer<typeof mediaExternalRefSchema>;

export const mediaTitleSchema = z.object({
  id: uuid,
  type: mediaType,
  title: z.string(),
  originalTitle: z.string().nullable(),
  year: z.number().int().nullable(),
  overview: z.string().nullable(),
  posterUrl: linkUrl.nullable(),
  externalRefs: z.array(mediaExternalRefSchema),
});
export type MediaTitle = z.infer<typeof mediaTitleSchema>;

/** MediaService.present() */
export const householdMediaSchema = z.object({
  id: uuid,
  householdId: uuid,
  status: householdMediaStatus,
  scheduledFor: dateOnly.nullable(),
  note: z.string().nullable(),
  mediaTitle: mediaTitleSchema,
  createdBy: memberBriefSchema,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type HouseholdMedia = z.infer<typeof householdMediaSchema>;

/** MediaRequestsService.present()；season 非空，0 表示整部。 */
export const mediaRequestSchema = z.object({
  id: uuid,
  householdMediaId: uuid,
  connectorKey: z.string(),
  season: z.number().int(),
  status: mediaRequestStatus,
  externalRequestId: z.string().nullable(),
  message: z.string().nullable(),
  requestedBy: memberBriefSchema,
  cancelledBy: memberBriefSchema.nullable(),
  canCancel: z.boolean(),
  lastSyncedAt: nullableDateTime,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type MediaRequest = z.infer<typeof mediaRequestSchema>;

// ---- 响应：连接器与元数据源 --------------------------------------------------

/** MediaConnectorsService 的 publicStatus() 与在线分支，字段集相同。 */
export const mediaConnectorSummarySchema = z.object({
  key: z.string(),
  kind: mediaConnectorKind,
  name: z.string(),
  role: mediaConnectorRole,
  primary: z.boolean(),
  state: mediaConnectorState,
  available: z.boolean(),
  message: z.string(),
  checkedAt: nullableDateTime,
});
export type MediaConnectorSummary = z.infer<typeof mediaConnectorSummarySchema>;

/** IntegrationSettingsService.list()；恒 3 条（plex、emby、moviepilot）。 */
export const mediaConnectorSettingsSchema = z.object({
  kind: mediaConnectorKind,
  name: z.string(),
  role: mediaConnectorRole,
  mode: mediaSettingsMode,
  isEnabled: z.boolean(),
  baseUrl: z.string().nullable(),
  credentialConfigured: z.boolean(),
  credentialHint: z.string().nullable(),
  isPrimary: z.boolean(),
  configured: z.boolean(),
  capabilities: z.array(z.string()),
  webhookConfigured: z.boolean(),
  webhookSourceIp: z.string().nullable(),
  webhookUpdatedAt: nullableDateTime,
  playbackServerId: z.string().nullable(),
  updatedAt: nullableDateTime,
});
export type MediaConnectorSettings = z.infer<typeof mediaConnectorSettingsSchema>;

/** MediaSourceSettingsService.list()；恒 3 条（tmdb、douban、bangumi）。 */
export const mediaSourceConfigSchema = z.object({
  provider: mediaMetadataSource,
  name: z.string(),
  mode: mediaSettingsMode,
  isEnabled: z.boolean(),
  baseUrl: z.string().nullable(),
  credentialKind: mediaCredentialKind,
  credentialConfigured: z.boolean(),
  credentialHint: z.string().nullable(),
  configured: z.boolean(),
  /** 只可能是 {}、{imageBaseUrl}（tmdb）或 {userAgent}（bangumi） */
  settings: z.object({
    imageBaseUrl: z.string().optional(),
    userAgent: z.string().optional(),
  }),
  updatedAt: nullableDateTime,
});
export type MediaSourceConfig = z.infer<typeof mediaSourceConfigSchema>;

export const moviePilotWebhookResultSchema = z.object({
  callbackPath: z.string(),
  sourceIp: z.string(),
  updatedAt: isoDateTime,
});
export type MoviePilotWebhookResult = z.infer<typeof moviePilotWebhookResultSchema>;

export const playbackWebhookResultSchema = moviePilotWebhookResultSchema.extend({
  serverId: z.string(),
});
export type PlaybackWebhookResult = z.infer<typeof playbackWebhookResultSchema>;

// ---- 响应：播放用户映射 ------------------------------------------------------

/** media-user-mappings 的 publicMember()，比 memberBriefSchema 多 disabledAt。 */
export const mediaMappedMemberSchema = memberBriefSchema.extend({
  disabledAt: nullableDateTime,
});

/** MediaUserMappingsService.list()；恒 2 条（plex、emby）。 */
export const mediaPlaybackUserDirectorySchema = z.object({
  connectorKey: z.string(),
  provider: mediaLibraryProviderKind,
  name: z.string(),
  state: mediaConnectorState,
  message: z.string(),
  serverId: z.string().nullable(),
  users: z.array(
    z.object({
      serverId: z.string().nullable(),
      externalUserId: z.string(),
      name: z.string(),
      isDisabled: z.boolean(),
      isStale: z.boolean(),
      mapping: z
        .object({ id: uuid, member: mediaMappedMemberSchema })
        .nullable(),
    }),
  ),
});
export type MediaPlaybackUserDirectory = z.infer<typeof mediaPlaybackUserDirectorySchema>;

export const mediaUserMappingSchema = z.object({
  id: uuid,
  member: mediaMappedMemberSchema,
});

// ---- 响应：观影历史 ----------------------------------------------------------

/** viewing-history 的 publicMember()：fallback 分支 avatarEmoji 为 null。 */
const viewingMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarEmoji: z.string().nullable(),
});

/** ViewingHistoryService.listSessions()；percentage 是 [0,100] 浮点。 */
export const viewingSessionSchema = z.object({
  id: uuid,
  provider: mediaLibraryProviderKind,
  connectorName: z.string(),
  mediaLibraryItemId: uuid.nullable(),
  mediaTitleId: uuid.nullable(),
  libraryItemId: z.string(),
  contentItemId: z.string(),
  mediaType,
  title: z.string(),
  deviceName: z.string().nullable(),
  status: viewingSessionStatus,
  positionMs: z.number().int(),
  durationMs: z.number().int().nullable(),
  percentage: z.number(),
  startedAt: isoDateTime,
  endedAt: nullableDateTime,
  lastEventAt: isoDateTime,
  posterUrl: linkUrl.nullable(),
  playbackUrl: linkUrl.nullable(),
  participants: z.array(
    z.object({
      id: uuid,
      member: viewingMemberSchema,
      joinedAt: isoDateTime,
      lastSeenAt: isoDateTime,
    }),
  ),
});
export type ViewingSession = z.infer<typeof viewingSessionSchema>;

/** ViewingHistoryService.listProgress()；member 走显式 relations，必有。 */
export const viewingProgressSchema = z.object({
  id: uuid,
  provider: mediaLibraryProviderKind,
  mediaLibraryItemId: uuid.nullable(),
  mediaTitleId: uuid.nullable(),
  contentItemId: z.string(),
  title: z.string(),
  positionMs: z.number().int(),
  durationMs: z.number().int().nullable(),
  percentage: z.number(),
  completed: z.boolean(),
  lastWatchedAt: isoDateTime,
  posterUrl: linkUrl.nullable(),
  playbackUrl: linkUrl.nullable(),
  member: memberBriefSchema,
});
export type ViewingProgress = z.infer<typeof viewingProgressSchema>;

// ---- 响应：媒体库 ------------------------------------------------------------

export const mediaLibraryMatchSchema = z.object({
  connectorKey: z.string(),
  provider: mediaLibraryProviderKind,
  name: z.string(),
  primary: z.boolean(),
  libraryItemId: z.string(),
  playbackUrl: linkUrl.nullable(),
  seasons: z.array(
    z.object({
      season: z.number().int(),
      /** 媒体服务器报的集数，不是"应有总数" */
      episodeCount: z.number().int().nullable(),
    }),
  ),
});
export type MediaLibraryMatch = z.infer<typeof mediaLibraryMatchSchema>;

/** householdMediaId → 匹配项；mediaIds 为空时整体是 `{}`。 */
export const mediaLibraryAvailabilitySchema = z.record(
  z.string(),
  z.array(mediaLibraryMatchSchema),
);
export type MediaLibraryAvailability = z.infer<typeof mediaLibraryAvailabilitySchema>;

/** MediaLibraryService.present()：externalRefs 是原样透传的 jsonb，没有 id/connectorKey。 */
export const mediaLibraryItemSchema = z.object({
  id: uuid,
  connectorKey: z.string(),
  provider: mediaLibraryProviderKind,
  connectorName: z.string(),
  libraryItemId: z.string(),
  type: mediaType,
  title: z.string(),
  originalTitle: z.string().nullable(),
  year: z.number().int().nullable(),
  overview: z.string().nullable(),
  posterUrl: linkUrl.nullable(),
  externalRefs: z.array(
    z.object({
      provider: mediaExternalProvider,
      mediaType,
      externalId: z.string(),
    }),
  ),
  playbackUrl: linkUrl.nullable(),
  householdMediaId: uuid.nullable(),
  lastSeenAt: isoDateTime,
});
export type MediaLibraryItem = z.infer<typeof mediaLibraryItemSchema>;

export const mediaLibraryResponseSchema = z.object({
  items: z.array(mediaLibraryItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  pages: z.number().int(),
  lastSyncedAt: nullableDateTime,
  connectors: z.array(
    z.object({
      connectorKey: mediaLibraryProviderKind,
      name: z.string(),
      provider: mediaLibraryProviderKind,
      lastSyncedAt: nullableDateTime,
    }),
  ),
});
export type MediaLibraryResponse = z.infer<typeof mediaLibraryResponseSchema>;

export const mediaLibrarySyncResponseSchema = z.object({
  results: z.array(
    z.object({
      connectorKey: z.string(),
      name: z.string(),
      provider: mediaLibraryProviderKind,
      itemCount: z.number().int(),
      matchedCount: z.number().int(),
      syncedAt: isoDateTime,
    }),
  ),
});
export type MediaLibrarySyncResponse = z.infer<typeof mediaLibrarySyncResponseSchema>;

export const addLibraryItemResultSchema = z.object({
  householdMediaId: uuid,
  added: z.boolean(),
});

// ---- 响应：搜索 --------------------------------------------------------------

/** 搜索结果里的外部引用没有 connectorKey（三个 provider 都不填）。 */
export const mediaSearchResultSchema = z.object({
  key: z.string(),
  type: mediaType,
  title: z.string(),
  originalTitle: z.string().nullable(),
  year: z.number().int().nullable(),
  overview: z.string().nullable(),
  posterUrl: linkUrl.nullable(),
  sources: z.array(mediaMetadataSource),
  externalRefs: z.array(
    z.object({
      provider: mediaExternalProvider,
      mediaType,
      externalId: z.string(),
      connectorKey: z.string().optional(),
    }),
  ),
  metadata: z.record(z.string(), z.unknown()),
});
export type MediaSearchResult = z.infer<typeof mediaSearchResultSchema>;

export const mediaSourceSearchStatusSchema = z.object({
  provider: mediaMetadataSource,
  name: z.string(),
  state: mediaSourceState,
  resultCount: z.number().int(),
  message: z.string(),
});
export type MediaSourceSearchStatus = z.infer<typeof mediaSourceSearchStatusSchema>;

export const mediaSearchResponseSchema = z.object({
  query: z.string(),
  /** 最多 30 条；未配置时为空数组 */
  results: z.array(mediaSearchResultSchema),
  /** 恒 3 条（douban、tmdb、bangumi 顺序） */
  sources: z.array(mediaSourceSearchStatusSchema),
});
export type MediaSearchResponse = z.infer<typeof mediaSearchResponseSchema>;

// ---- 响应：webhook 接收 ------------------------------------------------------

export const moviePilotWebhookAckSchema = z.object({
  accepted: z.boolean(),
  ignored: z.boolean(),
  duplicate: z.boolean(),
  matched: z.boolean(),
});

/** 只有"处理完成"那条分支带 viewingSessionId，前两条分支整个键缺席。 */
export const playbackWebhookAckSchema = moviePilotWebhookAckSchema.extend({
  viewingSessionId: uuid.nullable().optional(),
});

// ---- 请求 -------------------------------------------------------------------

export const mediaListQuery = z.object({
  status: z.enum(['all', ...HOUSEHOLD_MEDIA_STATUSES]).optional(),
  search: z.string().max(120).optional(),
});

/** 写入用的外部引用只允许元数据侧四个 provider。 */
export const mediaExternalRefInput = z.object({
  provider: z.enum(['tmdb', 'imdb', 'douban', 'bangumi']),
  externalId: z.string().max(180),
});

export const createMediaBody = z.object({
  type: mediaType,
  title: z.string().max(180),
  originalTitle: z.string().max(180).nullish(),
  year: z.number().int().min(1878).max(2199).nullish(),
  overview: z.string().max(5000).nullish(),
  posterUrl: z.string().url().max(2000).nullish(),
  status: householdMediaStatus.optional(),
  scheduledFor: dateOnly.nullish(),
  note: z.string().max(1000).nullish(),
  externalRefs: z.array(mediaExternalRefInput).max(5).optional(),
});
export const updateMediaBody = z.object({
  status: householdMediaStatus.optional(),
  scheduledFor: dateOnly.nullish(),
  note: z.string().max(1000).nullish(),
});
export const addMediaExternalRefsBody = z.object({
  externalRefs: z.array(mediaExternalRefInput).min(1).max(5),
});

export const mediaSearchQuery = z.object({
  query: z.string().min(1).max(120),
  type: mediaType.optional(),
  year: z.coerce.number().int().min(1878).max(2199).optional(),
});

export const mediaAvailabilityBody = z.object({
  mediaIds: z.array(uuid).max(100),
});

export const mediaLibraryQuery = z.object({
  connectorKey: mediaLibraryProviderKind.optional(),
  type: mediaType.optional(),
  search: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(12).max(60).optional(),
});
export const mediaPosterQuery = z.object({
  expires: z.coerce.number().int().min(1),
  signature: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const syncMediaLibraryBody = z.object({
  connectorKey: mediaLibraryProviderKind.optional(),
});

export const updateIntegrationSettingsBody = z.object({
  name: z.string().max(120).optional(),
  isEnabled: z.boolean().optional(),
  baseUrl: z.string().max(2000).nullish(),
  credential: z.string().max(4096).optional(),
  clearCredential: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
});
export const updateMediaSourceSettingsBody = z.object({
  isEnabled: z.boolean().optional(),
  baseUrl: z.string().max(2000).nullish(),
  credentialKind: mediaCredentialKind.nullish(),
  credential: z.string().max(4096).optional(),
  clearCredential: z.boolean().optional(),
  imageBaseUrl: z.string().max(2000).nullish(),
  userAgent: z.string().max(300).nullish(),
});
export const rotateWebhookBody = z.object({
  sourceIp: z.string().max(64).optional(),
});

export const mapPlaybackUserBody = z.object({ memberId: uuid });
export const viewingHistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export const mediaRequestQuery = z.object({ mediaId: uuid.optional() });
export const createMediaRequestBody = z.object({
  connectorKey: z.literal('moviepilot').optional(),
  season: z.number().int().min(1).max(999).optional(),
});

export const connectorKindParams = z.object({ kind: mediaConnectorKind });
export const metadataProviderParams = z.object({ provider: mediaMetadataSource });
export const playbackProviderParams = z.object({ provider: mediaLibraryProviderKind });

// ---- 端点 -------------------------------------------------------------------

export const media = {
  list: defineEndpoint({
    method: 'GET',
    path: '/media',
    summary: '家庭片单（最多 100 条，按更新时间倒序）',
    query: mediaListQuery,
    response: z.array(householdMediaSchema),
  }),
  create: defineEndpoint({
    method: 'POST',
    path: '/media',
    summary: '加入片单（按 类型+片名+年份 去重合并作品）',
    body: createMediaBody,
    response: householdMediaSchema,
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: '/media/:id',
    summary: '改状态、排期或备注（状态流转受限）',
    params: idParams,
    body: updateMediaBody,
    response: householdMediaSchema,
  }),
  remove: defineEndpoint({
    method: 'DELETE',
    path: '/media/:id',
    summary: '移出片单',
    params: idParams,
    response: removedResponse,
  }),
  addExternalRefs: defineEndpoint({
    method: 'POST',
    path: '/media/:id/external-refs',
    summary: '给作品补外部站点引用',
    params: idParams,
    body: addMediaExternalRefsBody,
    response: householdMediaSchema,
  }),
  search: defineEndpoint({
    method: 'GET',
    path: '/media/search',
    summary: '跨元数据源搜索（TMDB / 豆瓣 / Bangumi，合并去重后最多 30 条）',
    query: mediaSearchQuery,
    response: mediaSearchResponseSchema,
  }),
  connectors: defineEndpoint({
    method: 'GET',
    path: '/media/connectors',
    summary: '连接器状态（恒 3 条）',
    response: z.array(mediaConnectorSummarySchema),
  }),
  connectorSettings: defineEndpoint({
    method: 'GET',
    path: '/media/connector-settings',
    summary: '连接器配置（恒 3 条；凭据只回传提示，不回传明文）',
    response: z.array(mediaConnectorSettingsSchema),
  }),
  updateConnectorSettings: defineEndpoint({
    method: 'PUT',
    path: '/media/connector-settings/:kind',
    summary: '改某个连接器的配置，回传整份列表',
    params: connectorKindParams,
    body: updateIntegrationSettingsBody,
    response: z.array(mediaConnectorSettingsSchema),
  }),
  resetConnectorSettings: defineEndpoint({
    method: 'DELETE',
    path: '/media/connector-settings/:kind',
    summary: '恢复服务器默认配置，回传整份列表',
    params: connectorKindParams,
    response: z.array(mediaConnectorSettingsSchema),
  }),
  testConnectorSettings: defineEndpoint({
    method: 'POST',
    path: '/media/connector-settings/:kind/test',
    summary: '强制刷新并返回该连接器的状态',
    params: connectorKindParams,
    response: mediaConnectorSummarySchema,
  }),
  rotateMoviePilotWebhook: defineEndpoint({
    method: 'POST',
    path: '/media/connector-settings/moviepilot/webhook',
    summary: '轮换 MoviePilot 回调密钥（明文回调路径只此一次）',
    body: rotateWebhookBody,
    response: moviePilotWebhookResultSchema,
  }),
  rotatePlaybackWebhook: defineEndpoint({
    method: 'POST',
    path: '/media/connector-settings/:provider/playback-webhook',
    summary: '轮换 Plex/Emby 播放回调密钥（要求该媒体服务在线）',
    params: playbackProviderParams,
    body: rotateWebhookBody,
    response: playbackWebhookResultSchema,
  }),
  metadataSources: defineEndpoint({
    method: 'GET',
    path: '/media/metadata-sources',
    summary: '元数据源配置（恒 3 条）',
    response: z.array(mediaSourceConfigSchema),
  }),
  updateMetadataSource: defineEndpoint({
    method: 'PUT',
    path: '/media/metadata-sources/:provider',
    summary: '改某个元数据源的配置，回传整份列表',
    params: metadataProviderParams,
    body: updateMediaSourceSettingsBody,
    response: z.array(mediaSourceConfigSchema),
  }),
  resetMetadataSource: defineEndpoint({
    method: 'DELETE',
    path: '/media/metadata-sources/:provider',
    summary: '恢复服务器默认元数据源配置，回传整份列表',
    params: metadataProviderParams,
    response: z.array(mediaSourceConfigSchema),
  }),
  library: defineEndpoint({
    method: 'GET',
    path: '/media/library',
    summary: '本地媒体库快照（分页；每页 12～60）',
    query: mediaLibraryQuery,
    response: mediaLibraryResponseSchema,
  }),
  libraryAvailability: defineEndpoint({
    method: 'POST',
    path: '/media/library-availability',
    summary: '查一批片单条目在媒体库里的可用性（mediaIds 为空时返回 {}）',
    body: mediaAvailabilityBody,
    response: mediaLibraryAvailabilitySchema,
  }),
  syncLibrary: defineEndpoint({
    method: 'POST',
    path: '/media/library/sync',
    summary: '从 Plex/Emby 拉取媒体库并与作品匹配（无可用媒体库时 502）',
    body: syncMediaLibraryBody,
    response: mediaLibrarySyncResponseSchema,
  }),
  addLibraryItem: defineEndpoint({
    method: 'POST',
    path: '/media/library/:libraryItemId/add',
    summary: '把媒体库条目加入片单（已在片单则 added=false）',
    params: z.object({ libraryItemId: uuid }),
    response: addLibraryItemResultSchema,
  }),
  libraryPoster: defineEndpoint({
    method: 'GET',
    path: '/media/library/:libraryItemId/poster',
    summary: '媒体库海报（公开，签名 URL 24 小时有效；二进制流，无 JSON 响应）',
    params: z.object({ libraryItemId: uuid }),
    query: mediaPosterQuery,
    response: z.undefined(),
  }),
  playbackUsers: defineEndpoint({
    method: 'GET',
    path: '/media/playback-users',
    summary: '媒体服务器用户目录与成员映射（恒 2 条：plex、emby）',
    response: z.array(mediaPlaybackUserDirectorySchema),
  }),
  mapPlaybackUser: defineEndpoint({
    method: 'PUT',
    path: '/media/playback-users/:provider/:externalUserId/mapping',
    summary: '把媒体服务器用户映射到家庭成员',
    params: playbackProviderParams.extend({ externalUserId: z.string() }),
    body: mapPlaybackUserBody,
    response: mediaUserMappingSchema,
  }),
  unmapPlaybackUser: defineEndpoint({
    method: 'DELETE',
    path: '/media/playback-user-mappings/:mappingId',
    summary: '解除播放用户映射',
    params: z.object({ mappingId: uuid }),
    response: z.object({ deleted: z.boolean() }),
  }),
  viewingSessions: defineEndpoint({
    method: 'GET',
    path: '/media/viewing-sessions',
    summary: '观影会话（含参与成员）',
    query: viewingHistoryQuery,
    response: z.array(viewingSessionSchema),
  }),
  viewingProgress: defineEndpoint({
    method: 'GET',
    path: '/media/viewing-progress',
    summary: '按成员的观看进度',
    query: viewingHistoryQuery,
    response: z.array(viewingProgressSchema),
  }),
  requests: defineEndpoint({
    method: 'GET',
    path: '/media/requests',
    summary: '求片记录',
    query: mediaRequestQuery,
    response: z.array(mediaRequestSchema),
  }),
  createRequest: defineEndpoint({
    method: 'POST',
    path: '/media/:mediaId/requests',
    summary: '向 MoviePilot 发起订阅（未配置时 502）',
    params: z.object({ mediaId: uuid }),
    body: createMediaRequestBody,
    response: mediaRequestSchema,
  }),
  refreshRequest: defineEndpoint({
    method: 'POST',
    path: '/media/requests/:requestId/refresh',
    summary: '同步 MoviePilot 订阅状态',
    params: z.object({ requestId: uuid }),
    response: mediaRequestSchema,
  }),
  cancelRequest: defineEndpoint({
    method: 'DELETE',
    path: '/media/requests/:requestId',
    summary: '取消订阅（申请人或管理员）',
    params: z.object({ requestId: uuid }),
    response: mediaRequestSchema,
  }),
  moviePilotWebhook: defineEndpoint({
    method: 'POST',
    path: '/media/webhooks/moviepilot/:integrationId/:secret',
    summary: 'MoviePilot 入库回调（公开，校验密钥与来源 IP；恒 200）',
    params: z.object({ integrationId: uuid, secret: z.string() }),
    response: moviePilotWebhookAckSchema,
  }),
  playbackWebhook: defineEndpoint({
    method: 'POST',
    path: '/media/webhooks/playback/:provider/:integrationId/:secret',
    summary: 'Plex/Emby 播放回调（公开，multipart 或 JSON；恒 200）',
    params: playbackProviderParams.extend({
      integrationId: uuid,
      secret: z.string(),
    }),
    response: playbackWebhookAckSchema,
  }),
};
