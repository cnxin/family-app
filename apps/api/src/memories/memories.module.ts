import { Injectable, OnModuleInit, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PluginFacadeRegistry } from '../system/plugin-facades.registry';
import { memoriesFacade } from './memories.facade';
import { FamilyMemory, FamilyMemoryOperation, FamilyMemoryPhoto } from '../entities';
import { MemoriesService } from './memories.service';
import { MemoriesController } from './memories.controller';

/** 把回忆门面注册到内核（J4.1）：小管家读最近回忆走这里。 */
@Injectable()
export class MemoriesFacadeProvider implements OnModuleInit {
  constructor(
    private readonly registry: PluginFacadeRegistry,
    private readonly memories: MemoriesService,
  ) {}

  onModuleInit() {
    this.registry.register('memories', memoriesFacade(this.memories));
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FamilyMemory,
      FamilyMemoryPhoto,
      FamilyMemoryOperation,
    ]),
  ],
  controllers: [MemoriesController],
  providers: [MemoriesService, MemoriesFacadeProvider],
  exports: [MemoriesService],
})
export class MemoriesModule {}
