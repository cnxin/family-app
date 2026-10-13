import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import {
  KnowledgeListQueryDto,
  CreateKnowledgeArticleDto,
  UpdateKnowledgeArticleDto,
  KnowledgeVersionOperationDto,
} from './knowledge.dto';
import { KnowledgeService } from './knowledge.service';

@Controller()
export class KnowledgeController {
  constructor(private readonly service: KnowledgeService) {}

  @Get('knowledge-articles')
  list(@Query() query: KnowledgeListQueryDto, @CurrentUser() user: JwtUser) {
    return this.service.list(query, user);
  }

  @Get('knowledge-articles/:id/revisions')
  revisions(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.listRevisions(id, user);
  }

  @Get('knowledge-articles/:id')
  detail(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.detail(id, user);
  }

  @Post('knowledge-articles')
  create(@Body() dto: CreateKnowledgeArticleDto, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user);
  }

  @Patch('knowledge-articles/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeArticleDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post('knowledge-articles/:id/archive')
  archive(
    @Param('id') id: string,
    @Body() dto: KnowledgeVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.archive(id, dto, user);
  }

  @Post('knowledge-articles/:id/restore')
  restore(
    @Param('id') id: string,
    @Body() dto: KnowledgeVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.restore(id, dto, user);
  }

  @Post('knowledge-articles/:id/revisions/:version/restore')
  restoreRevision(
    @Param('id') id: string,
    @Param('version') version: string,
    @Body() dto: KnowledgeVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.restoreRevision(id, version, dto, user);
  }
}
