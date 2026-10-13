import { Injectable, OnModuleInit, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PluginFacadeRegistry } from '../system/plugin-facades.registry';
import { knowledgeFacade } from './knowledge.facade';
import { KnowledgeArticle, KnowledgeArticleRevision } from '../entities';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';

/** 把知识库门面注册到内核（J4.1）：小管家搜知识走这里。 */
@Injectable()
export class KnowledgeFacadeProvider implements OnModuleInit {
  constructor(
    private readonly registry: PluginFacadeRegistry,
    private readonly knowledge: KnowledgeService,
  ) {}

  onModuleInit() {
    this.registry.register('knowledge', knowledgeFacade(this.knowledge));
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeArticle, KnowledgeArticleRevision]),
  ],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, KnowledgeFacadeProvider],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
