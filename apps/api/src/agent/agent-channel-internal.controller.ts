import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Request, Response } from 'express';
import { Public } from '../auth/jwt.guard';
import { authorizedAgentInternal } from './agent-internal-auth';
import { AgentChannelsService } from './agent-channels.service';

class PairAgentChannelDto {
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  pairingCode: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  externalAccountId: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalDisplayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  externalAccountHint?: string;
}

class ChannelMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  externalThreadRef: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message: string;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  clientRequestId: string;
}

function unauthorized(response: Response) {
  response.status(401).json({
    error: { code: 'UNAUTHORIZED', message: '内部智能体凭据无效' },
  });
}

@Controller('internal/agent/channels')
@Public()
export class AgentChannelInternalController {
  constructor(private readonly channels: AgentChannelsService) {}

  @Post('pair')
  async pair(
    @Req() request: Request,
    @Body() dto: PairAgentChannelDto,
    @Res() response: Response,
  ) {
    if (!authorizedAgentInternal(request)) {
      unauthorized(response);
      return;
    }
    const result = await this.channels.pair(
      dto.pairingCode,
      dto.externalAccountId,
      dto.externalDisplayName,
      dto.externalAccountHint,
    );
    response.json({ data: result });
  }

  @Post(':channelId/messages')
  async message(
    @Req() request: Request,
    @Param('channelId') channelId: string,
    @Body() dto: ChannelMessageDto,
    @Res() response: Response,
  ) {
    if (!authorizedAgentInternal(request)) {
      unauthorized(response);
      return;
    }
    const result = await this.channels.sendChannelMessage(
      channelId,
      dto.externalThreadRef,
      dto.message,
      dto.clientRequestId,
    );
    response.status(202).json({ data: result });
  }

  @Get(':channelId/runs/:runId')
  async run(
    @Req() request: Request,
    @Param('channelId') channelId: string,
    @Param('runId') runId: string,
    @Res() response: Response,
  ) {
    if (!authorizedAgentInternal(request)) {
      unauthorized(response);
      return;
    }
    const result = await this.channels.channelRun(channelId, runId);
    response.json({ data: result });
  }
}
