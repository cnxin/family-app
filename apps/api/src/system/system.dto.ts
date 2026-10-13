import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { BackupScheduleFrequency } from '../entities';

export class UpdateBackupPolicyDto {
  @IsBoolean()
  scheduleEnabled: boolean;

  @IsIn(['daily', 'weekly'])
  frequency: BackupScheduleFrequency;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weeklyDay?: number | null;

  @IsInt()
  @Min(0)
  @Max(23)
  scheduledHour: number;

  @IsInt()
  @Min(0)
  @Max(59)
  scheduledMinute: number;

  @IsInt()
  @Min(1)
  @Max(3650)
  retentionDays: number;

  @IsInt()
  @Min(1)
  @Max(365)
  retentionCount: number;

  @IsInt()
  @Min(1)
  @Max(98)
  capacityWarningPercent: number;

  @IsInt()
  @Min(2)
  @Max(99)
  capacityCriticalPercent: number;

  @IsBoolean()
  restoreDrillEnabled: boolean;

  @IsInt()
  @Min(1)
  @Max(28)
  restoreDrillDay: number;

  @IsInt()
  @Min(0)
  @Max(23)
  restoreDrillHour: number;
}

export class QueueBackupRunDto {
  @Matches(/^[A-Za-z0-9_.:-]{8,180}$/)
  idempotencyKey: string;
}
