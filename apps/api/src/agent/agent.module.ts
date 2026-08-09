import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssetsModule } from '../assets/assets.module';
import { CalendarModule } from '../calendar/calendar.module';
import {
  AgentConversation,
  AgentActionProposal,
  AgentChannelPairing,
  AgentMemberChannel,
  AgentMemberProfile,
  AgentMemoryEvent,
  AgentMemoryItem,
  AgentMessage,
  AgentProposalGroup,
  AgentProposalGroupEvent,
  AgentRun,
  AgentRoutine,
  AgentRoutineItem,
  AgentSetting,
  AgentToolEvent,
  Dish,
  InventoryItem,
  Member,
} from '../entities';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MediaModule } from '../media/media.module';
import { MemoriesModule } from '../memories/memories.module';
import { MenusModule } from '../menus/menus.module';
import { PollsModule } from '../polls/polls.module';
import { RemindersModule } from '../reminders/reminders.module';
import { ShoppingModule } from '../shopping/shopping.module';
import { TasksModule } from '../tasks/tasks.module';
import { TravelModule } from '../travel/travel.module';
import { AgentController } from './agent.controller';
import { AgentChannelInternalController } from './agent-channel-internal.controller';
import { AgentMcpController } from './agent-mcp.controller';
import { FakeAgentRuntime, HermesAgentRuntime } from './agent-runtimes';
import { AgentService } from './agent.service';
import { AgentToolsService } from './agent-tools.service';
import { AgentProposalsService } from './agent-proposals.service';
import { AgentChannelsService } from './agent-channels.service';
import { AgentRetentionService } from './agent-retention.service';
import { AgentMemoryService } from './agent-memory.service';
import { AgentPageContextService } from './agent-page-context.service';
import { AgentRoutineService } from './agent-routine.service';
import { AgentProposalGroupsService } from './agent-proposal-groups.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgentSetting,
      AgentActionProposal,
      AgentChannelPairing,
      AgentMemberChannel,
      AgentMemberProfile,
      AgentMemoryItem,
      AgentMemoryEvent,
      AgentProposalGroup,
      AgentProposalGroupEvent,
      AgentRoutine,
      AgentRoutineItem,
      AgentConversation,
      AgentMessage,
      AgentRun,
      AgentToolEvent,
      Dish,
      InventoryItem,
      Member,
    ]),
    AssetsModule,
    CalendarModule,
    InventoryModule,
    KnowledgeModule,
    TravelModule,
    MediaModule,
    MemoriesModule,
    TasksModule,
    RemindersModule,
    PollsModule,
    MenusModule,
    ShoppingModule,
  ],
  controllers: [
    AgentController,
    AgentMcpController,
    AgentChannelInternalController,
  ],
  providers: [
    AgentService,
    AgentToolsService,
    FakeAgentRuntime,
    HermesAgentRuntime,
    AgentProposalsService,
    AgentChannelsService,
    AgentRetentionService,
    AgentMemoryService,
    AgentPageContextService,
    AgentRoutineService,
    AgentProposalGroupsService,
  ],
})
export class AgentModule {}
