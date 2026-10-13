import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MemberRole } from '../entities';

export class LoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  loginName: string;

  @IsOptional()
  @IsString()
  @MaxLength(72)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  householdSlug?: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  refreshToken: string;
}

export class BootstrapDto {
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  bootstrapSecret: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  householdName: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  householdSlug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  ownerName: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  avatarEmoji?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(64)
  loginName: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}

export class UpdatePreferencesDto {
  @IsBoolean()
  prefersCooking: boolean;
}

export class UpdateManagedMemberDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  avatarEmoji?: string;

  @IsOptional()
  @IsIn(['owner', 'admin', 'member'])
  role?: MemberRole;

  @IsOptional()
  @IsBoolean()
  prefersCooking?: boolean;
}

export class UpdateManagedMemberStatusDto {
  @IsBoolean()
  enabled: boolean;
}

export class UpdatePasswordDto {
  @IsOptional()
  @IsString()
  @MaxLength(72)
  currentPassword?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword: string;
}

export class CreateInvitationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  memberName: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  avatarEmoji?: string;

  @IsOptional()
  @IsIn(['admin', 'member'])
  role?: Exclude<MemberRole, 'owner'>;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  expiresInHours?: number;
}

export class InvitationTokenDto {
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  invitationToken: string;
}

export class RedeemInvitationDto extends InvitationTokenDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  loginName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password: string;
}
