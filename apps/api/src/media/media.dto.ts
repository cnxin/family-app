import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { HouseholdMediaStatus, MediaExternalProvider, MediaType } from '../entities';
import { UpdateIntegrationSettingsInput } from './integration-settings.service';
import { MediaLibraryQuery } from './media-library.service';
import { UpdateMediaSourceSettingsInput } from './media-source-settings.service';

const MEDIA_STATUSES: HouseholdMediaStatus[] = [
  'watchlist',
  'voting',
  'scheduled',
  'watching',
  'completed',
  'dropped',
];

export class MediaQueryDto {
  @IsOptional()
  @IsIn(['all', ...MEDIA_STATUSES])
  status?: HouseholdMediaStatus | 'all';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class MediaSearchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  query: string;

  @IsOptional()
  @IsIn(['movie', 'series'])
  type?: MediaType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1878)
  @Max(2199)
  year?: number;
}

export class UpdateMediaSourceSettingsDto
  implements UpdateMediaSourceSettingsInput
{
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  baseUrl?: string | null;

  @IsOptional()
  @IsIn(['token', 'api_key'])
  credentialKind?: 'token' | 'api_key' | null;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  credential?: string;

  @IsOptional()
  @IsBoolean()
  clearCredential?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageBaseUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  userAgent?: string | null;
}

export class UpdateIntegrationSettingsDto
  implements UpdateIntegrationSettingsInput
{
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  baseUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  credential?: string;

  @IsOptional()
  @IsBoolean()
  clearCredential?: boolean;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class RotateMoviePilotWebhookDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceIp?: string;
}

export class RotatePlaybackWebhookDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceIp?: string;
}

export class ViewingHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class MapPlaybackUserDto {
  @IsUUID('4')
  memberId: string;
}

export class MediaExternalRefDto {
  @IsIn(['tmdb', 'imdb', 'douban', 'bangumi'])
  provider: Extract<
    MediaExternalProvider,
    'tmdb' | 'imdb' | 'douban' | 'bangumi'
  >;

  @IsString()
  @MaxLength(180)
  externalId: string;
}

export class CreateMediaDto {
  @IsIn(['movie', 'series'])
  type: MediaType;

  @IsString()
  @MaxLength(180)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  originalTitle?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1878)
  @Max(2199)
  year?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  overview?: string | null;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  posterUrl?: string | null;

  @IsOptional()
  @IsIn(MEDIA_STATUSES)
  status?: HouseholdMediaStatus;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  scheduledFor?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => MediaExternalRefDto)
  externalRefs?: MediaExternalRefDto[];
}

export class UpdateMediaDto {
  @IsOptional()
  @IsIn(MEDIA_STATUSES)
  status?: HouseholdMediaStatus;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  scheduledFor?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class AddMediaExternalRefsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => MediaExternalRefDto)
  externalRefs: MediaExternalRefDto[];
}

export class MediaAvailabilityDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  mediaIds: string[];
}

export class MediaLibraryQueryDto implements MediaLibraryQuery {
  @IsOptional()
  @IsIn(['plex', 'emby'])
  connectorKey?: string;

  @IsOptional()
  @IsIn(['movie', 'series'])
  type?: MediaType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(12)
  @Max(60)
  pageSize?: number;
}

export class MediaPosterQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expires: number;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  signature: string;
}

export class SyncMediaLibraryDto {
  @IsOptional()
  @IsIn(['plex', 'emby'])
  connectorKey?: string;
}

export class MediaRequestQueryDto {
  @IsOptional()
  @IsUUID('4')
  mediaId?: string;
}

export class CreateMediaRequestDto {
  @IsOptional()
  @IsIn(['moviepilot'])
  connectorKey?: 'moviepilot';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  season?: number;
}
