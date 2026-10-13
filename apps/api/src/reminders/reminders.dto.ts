import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';
import { ReminderSourceModule, ReminderStatus } from '../entities';

export class ReminderSourceRangeDto {
  @IsISO8601({ strict: true })
  start: string;

  @IsISO8601({ strict: true })
  end: string;
}

export class ReminderQueryDto {
  @IsOptional()
  @IsIn(['scheduled', 'sent', 'cancelled', 'all'])
  status?: ReminderStatus | 'all';
}

export class CreateReminderDto {
  @IsIn(['menu', 'task', 'calendar', 'poll', 'maintenance', 'travel'])
  sourceModule: ReminderSourceModule;

  @IsUUID()
  sourceId: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  occurrenceDate?: string | null;

  @IsISO8601({ strict: true })
  remindAt: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  recipientIds: string[];
}

export class UpdateReminderDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  remindAt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  recipientIds?: string[];
}
