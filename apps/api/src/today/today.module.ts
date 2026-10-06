import { Module } from '@nestjs/common';
import { TodayAttentionController } from './today-attention.controller';
import { AttentionRegistry } from './today-attention.rules';
import { TodayAttentionService } from './today-attention.service';

@Module({
  controllers: [TodayAttentionController],
  providers: [
    TodayAttentionService,
    AttentionRegistry,
  ],
  exports: [AttentionRegistry],
})
export class TodayModule {}
