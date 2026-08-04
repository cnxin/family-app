import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
import { AGENT_PROPOSAL_TOOLS, AGENT_READ_TOOLS } from './agent.types';
import { AgentService } from './agent.service';
import { AgentProposalsService } from './agent-proposals.service';
import { AgentChannelsService } from './agent-channels.service';

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

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(AGENT_PROPOSAL_TOOLS.length)
  @IsString({ each: true })
  proposalToolsEnabled?: string[];

  @IsInt()
  @Min(1)
  expectedVersion: number;
}

class ConfirmAgentProposalDto {
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  clientRequestId: string;
}

class RejectAgentProposalDto {
  @IsInt()
  @Min(1)
  expectedVersion: number;
}

class CreateAgentChannelPairingDto {
  @IsUUID()
  memberId: string;

  @IsString()
  @MinLength(2)
  @MaxLength(32)
  platform: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  expiresInMinutes?: number;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  idempotencyKey: string;
}

class RevokeAgentChannelDto {
  @IsInt()
  @Min(1)
  expectedVersion: number;
}

@Controller('agent')
@RequireCapabilities('use_agent')
export class AgentController {
  constructor(
    private readonly service: AgentService,
    private readonly proposals: AgentProposalsService,
    private readonly channels: AgentChannelsService,
  ) {}

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

  @Post('proposals/:id/confirm')
  confirmProposal(
    @Param('id') id: string,
    @Body() dto: ConfirmAgentProposalDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.proposals.confirm(
      id,
      dto.expectedVersion,
      dto.clientRequestId,
      user,
    );
  }

  @Post('proposals/:id/reject')
  rejectProposal(
    @Param('id') id: string,
    @Body() dto: RejectAgentProposalDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.proposals.reject(id, dto.expectedVersion, user);
  }

  @Get('channels')
  channelsList(@CurrentUser() user: JwtUser) {
    return this.channels.listChannels(user);
  }

  @Get('channel-pairings')
  @RequireCapabilities('manage_agent')
  pairings(@CurrentUser() user: JwtUser) {
    return this.channels.listPairings(user);
  }

  @Post('channel-pairings')
  @RequireCapabilities('manage_agent')
  createPairing(
    @Body() dto: CreateAgentChannelPairingDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.channels.createPairing(dto, user);
  }

  @Post('channel-pairings/:id/revoke')
  @RequireCapabilities('manage_agent')
  revokePairing(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.channels.revokePairing(id, user);
  }

  @Post('channels/:id/revoke')
  revokeChannel(
    @Param('id') id: string,
    @Body() dto: RevokeAgentChannelDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.channels.revokeChannel(id, dto.expectedVersion, user);
  }
}
