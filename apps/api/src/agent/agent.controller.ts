import {
  ArrayMaxSize,
  IsArray,
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
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { AGENT_READ_TOOLS } from './agent.types';
import { AgentService } from './agent.service';

class CreateConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}

class SendAgentMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message: string;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  clientRequestId: string;
}

class UpdateAgentSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['fake', 'hermes'])
  runtimeKind?: 'fake' | 'hermes';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  runtimeProfile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  modelAlias?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  retentionDays?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AGENT_READ_TOOLS.length)
  @IsString({ each: true })
  readToolsEnabled?: string[];

  @IsInt()
  @Min(1)
  expectedVersion: number;
}

@Controller('agent')
@RequireCapabilities('use_agent')
export class AgentController {
  constructor(private readonly service: AgentService) {}

  @Get('status')
  status(@CurrentUser() user: JwtUser) {
    return this.service.status(user);
  }

  @Get('settings')
  settings(@CurrentUser() user: JwtUser) {
    return this.service.getSettings(user);
  }

  @Put('settings')
  @RequireCapabilities('manage_agent')
  updateSettings(
    @Body() dto: UpdateAgentSettingsDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updateSettings(dto, user);
  }

  @Get('conversations')
  conversations(@CurrentUser() user: JwtUser) {
    return this.service.listConversations(user);
  }

  @Post('conversations')
  createConversation(
    @Body() dto: CreateConversationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.createConversation(dto.title, user);
  }

  @Get('conversations/:id')
  conversation(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.detail(id, user);
  }

  @Delete('conversations/:id')
  archive(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.archiveConversation(id, user);
  }

  @Post('conversations/:id/messages')
  @HttpCode(202)
  send(
    @Param('id') id: string,
    @Body() dto: SendAgentMessageDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.queueMessage(id, dto.message, dto.clientRequestId, user);
  }

  @Post('runs/:id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.cancel(id, user);
  }
}
