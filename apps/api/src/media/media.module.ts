import { Injectable, OnModuleInit, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PluginFacadeRegistry } from '../system/plugin-facades.registry';
import { mediaFacade } from './media.facade';
import {
  HouseholdMedia,
  HouseholdMediaSourceConfig,
  Integration,
  IntegrationEvent,
  IntegrationSecret,
  MediaExternalRef,
  MediaLibraryItem,
  MediaRequest,
  MediaTitle,
  MediaUserMapping,
  Member,
  Notification,
  Poll,
  ViewingParticipant,
  ViewingProgress,
  ViewingSession,
} from '../entities';
import { MediaConnectorsService } from './media-connectors.service';
import { IntegrationSettingsService } from './integration-settings.service';
import { MediaMetadataService } from './media-metadata.service';
import { MoviePilotWebhookService } from './moviepilot-webhook.service';
import { MoviePilotReconciliationService } from './moviepilot-reconciliation.service';
import { MediaUserMappingsService } from './media-user-mappings.service';
import { PlaybackWebhookService } from './playback-webhook.service';
import { ViewingHistoryService } from './viewing-history.service';
import { MediaLibraryService } from './media-library.service';
import { MediaSourceSettingsService } from './media-source-settings.service';
import { MediaService } from './media.service';
import { MediaAvailabilityService } from './media-availability.service';
import { MediaRequestsService } from './media-requests.service';
import { MediaController } from './media.controller';

/** 把观影门面注册到内核（J4.1）：小管家读片单走这里。 */
@Injectable()
export class MediaFacadeProvider implements OnModuleInit {
  constructor(
    private readonly registry: PluginFacadeRegistry,
    private readonly media: MediaService,
  ) {}

  onModuleInit() {
    this.registry.register('media', mediaFacade(this.media));
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      HouseholdMedia,
      HouseholdMediaSourceConfig,
      Integration,
      IntegrationEvent,
      IntegrationSecret,
      MediaTitle,
      MediaExternalRef,
      MediaLibraryItem,
      MediaUserMapping,
      ViewingSession,
      ViewingParticipant,
      ViewingProgress,
      MediaRequest,
      Member,
      Notification,
      Poll,
    ]),
  ],
  controllers: [MediaController],
  providers: [
    MediaService,
    MediaAvailabilityService,
    MediaRequestsService,
    MediaConnectorsService,
    MediaLibraryService,
    IntegrationSettingsService,
    MoviePilotWebhookService,
    MoviePilotReconciliationService,
    PlaybackWebhookService,
    ViewingHistoryService,
    MediaUserMappingsService,
    MediaSourceSettingsService,
    MediaMetadataService,
    MediaFacadeProvider,
  ],
  exports: [MediaService, MediaRequestsService, MediaConnectorsService],
})
export class MediaModule {}
