import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { Request as ExpressRequest, Response } from 'express';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser, Public } from '../auth/jwt.guard';
import { multipartLimits } from '../common/multipart';
import { MediaConnectorsService } from './media-connectors.service';
import { IntegrationSettingsService } from './integration-settings.service';
import { MediaMetadataService } from './media-metadata.service';
import { MoviePilotWebhookService } from './moviepilot-webhook.service';
import { MediaUserMappingsService } from './media-user-mappings.service';
import { PlaybackWebhookService } from './playback-webhook.service';
import { ViewingHistoryService } from './viewing-history.service';
import { MediaLibraryService } from './media-library.service';
import { MediaSourceSettingsService } from './media-source-settings.service';
import {
  MediaQueryDto,
  MediaSearchDto,
  UpdateMediaSourceSettingsDto,
  UpdateIntegrationSettingsDto,
  RotateMoviePilotWebhookDto,
  RotatePlaybackWebhookDto,
  ViewingHistoryQueryDto,
  MapPlaybackUserDto,
  CreateMediaDto,
  UpdateMediaDto,
  AddMediaExternalRefsDto,
  MediaAvailabilityDto,
  MediaLibraryQueryDto,
  MediaPosterQueryDto,
  SyncMediaLibraryDto,
  MediaRequestQueryDto,
  CreateMediaRequestDto,
} from './media.dto';
import { normalizeText, MediaService } from './media.service';
import { MediaRequestsService } from './media-requests.service';

@Controller('media')
export class MediaController {
  constructor(
    private readonly service: MediaService,
    private readonly requests: MediaRequestsService,
    private readonly metadata: MediaMetadataService,
    private readonly sourceSettings: MediaSourceSettingsService,
    private readonly integrationSettings: IntegrationSettingsService,
    private readonly moviePilotWebhook: MoviePilotWebhookService,
    private readonly playbackWebhook: PlaybackWebhookService,
    private readonly viewingHistory: ViewingHistoryService,
    private readonly userMappings: MediaUserMappingsService,
    private readonly connectorsService: MediaConnectorsService,
    private readonly library: MediaLibraryService,
  ) {}

  @Get('search')
  search(@Query() query: MediaSearchDto, @CurrentUser() user: JwtUser) {
    const normalizedQuery = normalizeText(query.query);
    if (!normalizedQuery) {
      throw new BadRequestException('请输入影视名称');
    }
    return this.metadata.search(
      {
        query: normalizedQuery,
        type: query.type,
        year: query.year,
      },
      user.householdId,
    );
  }

  @Get('metadata-sources')
  @RequireCapabilities('manage_integrations')
  metadataSources(@CurrentUser() user: JwtUser) {
    return this.sourceSettings.list(user);
  }

  @Put('metadata-sources/:provider')
  @RequireCapabilities('manage_integrations')
  async updateMetadataSource(
    @Param('provider') providerValue: string,
    @Body() dto: UpdateMediaSourceSettingsDto,
    @CurrentUser() user: JwtUser,
  ) {
    if (!this.sourceSettings.isProvider(providerValue)) {
      throw new NotFoundException('影视数据源不存在');
    }
    const result = await this.sourceSettings.update(providerValue, dto, user);
    this.metadata.clearHouseholdCache(user.householdId);
    return result;
  }

  @Delete('metadata-sources/:provider')
  @RequireCapabilities('manage_integrations')
  async resetMetadataSource(
    @Param('provider') providerValue: string,
    @CurrentUser() user: JwtUser,
  ) {
    if (!this.sourceSettings.isProvider(providerValue)) {
      throw new NotFoundException('影视数据源不存在');
    }
    const result = await this.sourceSettings.reset(providerValue, user);
    this.metadata.clearHouseholdCache(user.householdId);
    return result;
  }

  @Get()
  list(@Query() query: MediaQueryDto, @CurrentUser() user: JwtUser) {
    return this.service.list(query, user);
  }

  @Get('connectors')
  connectors(
    @CurrentUser() user: JwtUser,
    @Query('refresh') refresh?: string,
  ) {
    return this.service.connectorStatus(user, refresh === 'true');
  }

  @Get('connector-settings')
  @RequireCapabilities('manage_integrations')
  connectorSettings(@CurrentUser() user: JwtUser) {
    return this.integrationSettings.list(user);
  }

  @Put('connector-settings/:kind')
  @RequireCapabilities('manage_integrations')
  async updateConnectorSettings(
    @Param('kind') kindValue: string,
    @Body() dto: UpdateIntegrationSettingsDto,
    @CurrentUser() user: JwtUser,
  ) {
    if (!this.integrationSettings.isKind(kindValue)) {
      throw new NotFoundException('媒体服务不存在');
    }
    const result = await this.integrationSettings.update(kindValue, dto, user);
    this.connectorsService.clearHouseholdCache(user.householdId);
    return result;
  }

  @Delete('connector-settings/:kind')
  @RequireCapabilities('manage_integrations')
  async resetConnectorSettings(
    @Param('kind') kindValue: string,
    @CurrentUser() user: JwtUser,
  ) {
    if (!this.integrationSettings.isKind(kindValue)) {
      throw new NotFoundException('媒体服务不存在');
    }
    const result = await this.integrationSettings.reset(kindValue, user);
    this.connectorsService.clearHouseholdCache(user.householdId);
    return result;
  }

  @Post('connector-settings/:kind/test')
  @RequireCapabilities('manage_integrations')
  testConnectorSettings(
    @Param('kind') kindValue: string,
    @CurrentUser() user: JwtUser,
  ) {
    if (!this.integrationSettings.isKind(kindValue)) {
      throw new NotFoundException('媒体服务不存在');
    }
    return this.connectorsService.test(user.householdId, kindValue);
  }

  @Post('connector-settings/moviepilot/webhook')
  @RequireCapabilities('manage_integrations')
  rotateMoviePilotWebhook(
    @Body() dto: RotateMoviePilotWebhookDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.moviePilotWebhook.rotate(dto.sourceIp, user);
  }

  @Post('connector-settings/:provider/playback-webhook')
  @RequireCapabilities('manage_integrations')
  rotatePlaybackWebhook(
    @Param('provider') providerValue: string,
    @Body() dto: RotatePlaybackWebhookDto,
    @CurrentUser() user: JwtUser,
  ) {
    if (!this.playbackWebhook.isProvider(providerValue)) {
      throw new NotFoundException('媒体服务不存在');
    }
    return this.playbackWebhook.rotate(providerValue, dto.sourceIp, user);
  }

  @Get('playback-users')
  @RequireCapabilities('manage_integrations')
  playbackUsers(@CurrentUser() user: JwtUser) {
    return this.userMappings.list(user);
  }

  @Put('playback-users/:provider/:externalUserId/mapping')
  @RequireCapabilities('manage_integrations')
  mapPlaybackUser(
    @Param('provider') providerValue: string,
    @Param('externalUserId') externalUserId: string,
    @Body() dto: MapPlaybackUserDto,
    @CurrentUser() user: JwtUser,
  ) {
    if (providerValue !== 'plex' && providerValue !== 'emby') {
      throw new NotFoundException('媒体服务不存在');
    }
    return this.userMappings.map(
      providerValue,
      externalUserId,
      dto.memberId,
      user,
    );
  }

  @Delete('playback-user-mappings/:mappingId')
  @RequireCapabilities('manage_integrations')
  unmapPlaybackUser(
    @Param('mappingId', ParseUUIDPipe) mappingId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.userMappings.unmap(mappingId, user);
  }

  @Public()
  @Post('webhooks/moviepilot/:integrationId/:secret')
  @HttpCode(200)
  receiveMoviePilotWebhook(
    @Param('integrationId', ParseUUIDPipe) integrationId: string,
    @Param('secret') secret: string,
    @Req() request: ExpressRequest,
    @Body() body: unknown,
  ) {
    return this.moviePilotWebhook.receive(integrationId, secret, request, body);
  }

  @Public()
  @Post('webhooks/playback/:provider/:integrationId/:secret')
  @HttpCode(200)
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: multipartLimits({
        fields: 12,
        fieldSize: 128 * 1024,
        files: 1,
        fileSize: 2 * 1024 * 1024,
      }),
    }),
  )
  receivePlaybackWebhook(
    @Param('provider') providerValue: string,
    @Param('integrationId', ParseUUIDPipe) integrationId: string,
    @Param('secret') secret: string,
    @Req() request: ExpressRequest,
    @Body() body: unknown,
  ) {
    if (!this.playbackWebhook.isProvider(providerValue)) {
      throw new NotFoundException('播放回调不存在');
    }
    return this.playbackWebhook.receive(
      providerValue,
      integrationId,
      secret,
      request,
      body,
    );
  }

  @Get('viewing-sessions')
  viewingSessions(
    @Query() query: ViewingHistoryQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.viewingHistory.listSessions(user, query.limit ?? 50);
  }

  @Get('viewing-progress')
  viewingProgress(
    @Query() query: ViewingHistoryQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.viewingHistory.listProgress(user, query.limit ?? 100);
  }

  @Post('library-availability')
  libraryAvailability(
    @Body() dto: MediaAvailabilityDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.libraryAvailability(dto.mediaIds, user);
  }

  @Get('library')
  mediaLibrary(
    @Query() query: MediaLibraryQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.library.list(query, user);
  }

  @Public()
  @Get('library/:libraryItemId/poster')
  async mediaLibraryPoster(
    @Param('libraryItemId', ParseUUIDPipe) libraryItemId: string,
    @Query() query: MediaPosterQueryDto,
    @Res() response: Response,
  ) {
    const poster = await this.library.poster(
      libraryItemId,
      query.expires,
      query.signature,
    );
    response.setHeader('Content-Type', poster.contentType);
    response.setHeader('Content-Length', String(poster.body.length));
    response.setHeader('Cache-Control', 'private, max-age=3600');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.status(200).end(poster.body);
  }

  @Post('library/sync')
  @RequireCapabilities('manage_integrations')
  syncMediaLibrary(
    @Body() dto: SyncMediaLibraryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.library.sync(dto.connectorKey, user);
  }

  @Post('library/:libraryItemId/add')
  addLibraryItem(
    @Param('libraryItemId', ParseUUIDPipe) libraryItemId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.library.addToWatchlist(libraryItemId, user);
  }

  @Get('requests')
  mediaRequests(
    @Query() query: MediaRequestQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.requests.list(query, user);
  }

  @Post(':mediaId/requests')
  createMediaRequest(
    @Param('mediaId') mediaId: string,
    @Body() dto: CreateMediaRequestDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.requests.create(mediaId, dto, user);
  }

  @Post('requests/:requestId/refresh')
  refreshMediaRequest(
    @Param('requestId') requestId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.requests.refresh(requestId, user);
  }

  @Delete('requests/:requestId')
  cancelMediaRequest(
    @Param('requestId') requestId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.requests.cancel(requestId, user);
  }

  @Post()
  create(@Body() dto: CreateMediaDto, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMediaDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/external-refs')
  addExternalRefs(
    @Param('id') id: string,
    @Body() dto: AddMediaExternalRefsDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.addExternalRefs(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.remove(id, user);
  }
}
