import {
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CalendarRangeDto {
  @IsISO8601({ strict: true })
  start: string;

  @IsISO8601({ strict: true })
  end: string;
}

export class CreateCalendarEventDto {
  @IsISO8601({ strict: true })
  date: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  endsAt?: string | null;

  @IsString()
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class UpdateCalendarEventDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  date?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  endsAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}
