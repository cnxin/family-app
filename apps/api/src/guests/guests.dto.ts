import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { GuestMealRequestStatus, GuestWifiSecurity, MealType, VisitStatus } from '../entities';

export class CreateGuestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  avatarEmoji?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string | null;
}

export class UpdateGuestDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  avatarEmoji?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateVisitDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsDateString()
  startsAt: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsOptional()
  @IsUUID()
  hostMemberId?: string;

  @IsOptional()
  @IsUUID()
  guestWifiProfileId?: string | null;

  @IsArray()
  @IsUUID('4', { each: true })
  guestIds: string[];
}

export class UpdateVisitDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsOptional()
  @IsUUID()
  hostMemberId?: string;

  @IsOptional()
  @IsUUID()
  guestWifiProfileId?: string | null;

  @IsOptional()
  @IsIn(['scheduled', 'cancelled', 'completed'])
  status?: VisitStatus;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  guestIds?: string[];
}

export class CreateGuestInvitationDto {
  @IsUUID()
  guestId: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 30)
  expiresInHours?: number;

  @IsOptional()
  @IsBoolean()
  allowsMovieVoting?: boolean;

  @IsOptional()
  @IsBoolean()
  allowsMealRequests?: boolean;
}

export class GuestResponseDto {
  @IsBoolean()
  attending: boolean;
}

export class GuestPollVoteDto {
  @IsArray()
  @IsUUID('4', { each: true })
  optionIds: string[];
}

export class GuestMealRequestDto {
  @IsDateString()
  mealDate: string;

  @IsIn(['breakfast', 'lunch', 'dinner'])
  mealType: MealType;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  dishName: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class ReviewGuestMealRequestDto {
  @IsIn(['accepted', 'rejected'])
  status: Extract<GuestMealRequestStatus, 'accepted' | 'rejected'>;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reviewNote?: string | null;
}

export class CreateGuestWifiProfileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  ssid: string;

  @IsIn(['WPA', 'nopass'])
  security: GuestWifiSecurity;

  @IsOptional()
  @IsString()
  @MaxLength(63)
  password?: string | null;
}

export class UpdateGuestWifiProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  ssid?: string;

  @IsOptional()
  @IsIn(['WPA', 'nopass'])
  security?: GuestWifiSecurity;

  @IsOptional()
  @IsString()
  @MaxLength(63)
  password?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
