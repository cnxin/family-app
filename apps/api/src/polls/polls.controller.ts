import { Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  createPollBody,
  pollListQuery,
  updatePollBody,
  voteBody,
  type CreatePollBody,
  type PollListQuery,
  type UpdatePollBody,
  type VoteBody,
} from '@family/contracts';
import { ZodBody, ZodQuery } from '../common/zod';
import { PollsService } from './polls.service';

@Controller()
export class PollsController {
  constructor(private readonly service: PollsService) {}

  @Get('polls')
  list(@ZodQuery(pollListQuery) query: PollListQuery, @CurrentUser() user: JwtUser) {
    return this.service.list(query, user);
  }

  @Get('polls/:id')
  get(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.get(id, user);
  }

  @Post('polls')
  create(@ZodBody(createPollBody) dto: CreatePollBody, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user);
  }

  @Patch('polls/:id')
  update(
    @Param('id') id: string,
    @ZodBody(updatePollBody) dto: UpdatePollBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post('polls/:id/votes')
  vote(
    @Param('id') id: string,
    @ZodBody(voteBody) dto: VoteBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.vote(id, dto, user);
  }

  @Post('polls/:id/close')
  close(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.close(id, user);
  }

  @Post('polls/:id/reopen')
  reopen(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.reopen(id, user);
  }

  @Delete('polls/:id')
  archive(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.archive(id, user);
  }
}
