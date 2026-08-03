import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CalendarModule } from '../calendar/calendar.module';
import {
  AgentConversation,
  AgentMessage,
  AgentRun,
  AgentSetting,
  AgentToolEvent,
  InventoryItem,
  Member,
} from '../entities';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { MediaModule } from '../media/media.module';
import { MemoriesModule } from '../memories/memories.module';
import { TravelModule } from '../travel/travel.module';
import { AgentController } from './agent.controller';
import { AgentMcpController } from './agent-mcp.controller';
import { FakeAgentRuntime, HermesAgentRuntime } from './agent-runtimes';
import { AgentService } from './agent.service';
import { AgentToolsService } from './agent-tools.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgentSetting,
      AgentConversation,
      AgentMessage,
      AgentRun,
      AgentToolEvent,
      InventoryItem,
      Member,
    ]),
    CalendarModule,
    KnowledgeModule,
    TravelModule,
    MediaModule,
    MemoriesModule,
  ],
  controllers: [AgentController, AgentMcpController],
  providers: [
    AgentService,
    AgentToolsService,
    FakeAgentRuntime,
    HermesAgentRuntime,
  ],
})
export class AgentModule {}
