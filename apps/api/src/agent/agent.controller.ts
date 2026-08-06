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
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  AGENT_MEMORY_KEYS,
  AGENT_PROPOSAL_TOOLS,
  AGENT_READ_TOOLS,
  AgentMemoryKey,
} from './agent.types';
import { AgentService } from './agent.service';
import { AgentProposalsService } from './agent-proposals.service';
import { AgentChannelsService } from './agent-channels.service';
import { AgentMemoryService } from './agent-memory.service';

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

class RetryAgentRunDto {
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

class UpdateAgentProfileDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  assistantName?: string;

  @IsOptional()
  @IsIn(['concise', 'balanced', 'detailed'])
  responseStyle?: 'concise' | 'balanced' | 'detailed';

  @IsOptional()
  @IsBoolean()
  memoryEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  memorySuggestionEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  proactiveRoutinesEnabled?: boolean;

  @IsInt()
  @Min(1)
  expectedVersion: number;
}

class ListAgentMemoriesDto {
  @IsOptional()
  @IsIn(['candidate', 'active', 'revoked', 'forgotten', 'expired'])
  status?: 'candidate' | 'active' | 'revoked' | 'forgotten' | 'expired';

  @IsOptional()
  @IsIn(['member_private', 'household'])
  scope?: 'member_private' | 'household';
}

class CreateAgentMemoryCandidateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content: string;

  @IsIn([...AGENT_MEMORY_KEYS])
  memoryKey: AgentMemoryKey;

  @IsOptional()
  @IsIn([...AGENT_MEMORY_KEYS])
  category?: AgentMemoryKey;

  @IsOptional()
  @IsIn(['preference', 'fact', 'episodic_summary', 'routine_context'])
  kind?: 'preference' | 'fact' | 'episodic_summary' | 'routine_context';
}

class AgentMemoryVersionDto {
  @IsInt()
  @Min(1)
  expectedVersion: number;
}

class CorrectAgentMemoryDto extends AgentMemoryVersionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content: string;

  @IsOptional()
  @IsIn([...AGENT_MEMORY_KEYS])
  memoryKey?: AgentMemoryKey;

  @IsOptional()
  @IsIn([...AGENT_MEMORY_KEYS])
  category?: AgentMemoryKey;

  @IsOptional()
  @IsIn(['preference', 'fact', 'episodic_summary', 'routine_context'])
  kind?: 'preference' | 'fact' | 'episodic_summary' | 'routine_context';
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
    private readonly memory: AgentMemoryService,
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

  @Get('profile')
  profile(@CurrentUser() user: JwtUser) {
    return this.service.getProfile(user);
  }

  @Patch('profile')
  updateProfile(
    @Body() dto: UpdateAgentProfileDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.updateProfile(dto, user);
  }

  @Get('memories')
  memories(
    @Query() query: ListAgentMemoriesDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.memory.list(query, user);
  }

  @Post('memories/candidates')
  createMemoryCandidate(
    @Body() dto: CreateAgentMemoryCandidateDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.memory.createCandidate(
      {
        content: dto.content,
        memoryKey: dto.memoryKey,
        category: dto.category,
        kind: dto.kind,
        sourceType: 'user_explicit',
        confidenceSource: 'explicit',
      },
      user,
    );
  }

  @Post('memories/:id/confirm')
  confirmMemory(
    @Param('id') id: string,
    @Body() dto: AgentMemoryVersionDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.memory.confirm(id, dto.expectedVersion, user);
  }

  @Post('memories/:id/share')
  shareMemory(
    @Param('id') id: string,
    @Body() dto: AgentMemoryVersionDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.memory.share(id, dto.expectedVersion, user);
  }

  @Patch('memories/:id')
  correctMemory(
    @Param('id') id: string,
    @Body() dto: CorrectAgentMemoryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.memory.correct(id, dto, dto.expectedVersion, user);
  }

  @Delete('memories')
  clearMemories(@CurrentUser() user: JwtUser) {
    return this.memory.clearAll(user);
  }

  @Delete('memories/:id')
  forgetMemory(
    @Param('id') id: string,
    @Body() dto: AgentMemoryVersionDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.memory.forget(id, dto.expectedVersion, user);
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

  @Post('runs/:id/retry')
  @HttpCode(202)
  retry(
    @Param('id') id: string,
    @Body() dto: RetryAgentRunDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.retry(id, dto.clientRequestId, user);
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
